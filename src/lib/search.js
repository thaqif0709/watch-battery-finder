import { calibreVariants } from './normalize.js';

// Web search + page fetching. Several free-ish providers; "auto" uses whichever key is configured,
// falling back to DuckDuckGo's HTML page, which needs no key but can be flaky.

// DuckDuckGo answers bot-looking requests with a 202 challenge page, so look like a normal browser.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

export function pickProvider(env) {
  const p = String(env.SEARCH_PROVIDER || 'auto').toLowerCase();
  if (p !== 'auto') return p;
  if (env.TAVILY_API_KEY) return 'tavily';
  if (env.BRAVE_API_KEY) return 'brave';
  if (env.GOOGLE_CSE_KEY && env.GOOGLE_CSE_CX) return 'google_cse';
  return 'duckduckgo';
}

export async function webSearch(env, query, fetchImpl = fetch) {
  const provider = pickProvider(env);
  const fn = { tavily, brave, google_cse: googleCse, duckduckgo }[provider];
  if (!fn) throw new Error(`Unknown SEARCH_PROVIDER "${provider}"`);
  const results = await fn(env, query, fetchImpl);
  return { provider, results: results.filter((r) => /^https?:\/\//.test(r.url)) };
}

async function tavily(env, query, fetchImpl) {
  const res = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 8, search_depth: 'basic' }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
}

async function brave(env, query, fetchImpl) {
  const res = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?count=10&q=${encodeURIComponent(query)}`, {
    headers: { accept: 'application/json', 'x-subscription-token': env.BRAVE_API_KEY },
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = await res.json();
  return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: stripTags(r.description ?? '') }));
}

async function googleCse(env, query, fetchImpl) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_CSE_KEY}&cx=${env.GOOGLE_CSE_CX}&num=10&q=${encodeURIComponent(query)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Google CSE HTTP ${res.status}`);
  const data = await res.json();
  return (data.items ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? '' }));
}

async function duckduckgo(env, query, fetchImpl) {
  const res = await fetchImpl('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA,
      accept: 'text/html',
      'accept-language': 'en-US,en;q=0.9',
      referer: 'https://html.duckduckgo.com/',
    },
    body: `q=${encodeURIComponent(query)}`,
  });
  if (res.status === 202) throw new Error('DuckDuckGo blocked the request (bot check). Add a TAVILY_API_KEY for reliable search');
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  return parseDuckDuckGo(await res.text());
}

// Caliber Corner is a movement database built from manufacturers' technical sheets, and its own
// site search needs no API key. Used for every calibre, alongside the general web search.
export async function caliberCornerPages(calibre, fetchImpl = fetch) {
  const variants = calibreVariants(calibre).map((v) => v.toLowerCase());
  if (!variants.length || variants[0].length < 3) return [];
  const res = await fetchImpl(`https://calibercorner.com/?s=${encodeURIComponent(variants[variants.length - 1])}`, { headers: { 'user-agent': UA, accept: 'text/html' } });
  if (!res.ok) throw new Error(`Caliber Corner HTTP ${res.status}`);
  return parseCaliberCornerSearch(await res.text(), variants);
}

export function parseCaliberCornerSearch(html, variants) {
  const out = new Map();
  for (const m of html.matchAll(/href="(https:\/\/calibercorner\.com\/([a-z0-9-]+)\/)[^"]*"/g)) {
    const slug = m[2];
    // Only pages about this calibre ("miyota-caliber-2035"; "vx42e" for VX42), not lists that merely mention it.
    const exact = variants.some((v) => new RegExp(`(^|-)${v}($|-)`).test(slug));
    const suffixed = variants.some((v) => new RegExp(`(^|-)${v}[a-z]($|-)`).test(slug));
    if ((exact || suffixed) && !out.has(m[1])) out.set(m[1], { title: slug.replace(/-/g, ' '), url: m[1], snippet: '', exact });
  }
  return [...out.values()].sort((a, b) => b.exact - a.exact).slice(0, 2).map(({ exact, ...r }) => r);
}

export function parseDuckDuckGo(html) {
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="result__a"|$)/g;
  for (const m of html.matchAll(re)) {
    let url = decodeEntities(m[1]);
    const redirect = url.match(/[?&]uddg=([^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    const snip = m[3].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ title: stripTags(m[2]), url, snippet: snip ? stripTags(snip[1]) : '' });
  }
  return out;
}

export async function fetchPageText(url, fetchImpl = fetch, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html,text/plain' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/(html|plain)|xhtml/.test(type)) return null;
    const html = (await res.text()).slice(0, 2_000_000);
    return /text\/plain/.test(type) ? html : htmlToText(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(td|th)>/gi, ' | ')
      .replace(/<(br|\/p|\/tr|\/li|\/h\d|\/div|\/dt|\/dd)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(middot|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip|deg|times);/g, (_, n) => ({ middot: '·', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '–', mdash: '—', hellip: '…', deg: '°', times: '×' })[n])
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Cuts the page down to the bits around mentions of the movement / model, so the AI sees
// a few short windows instead of a whole page.
export function snippetsAround(text, regexes, radius = 300, maxLen = 2500) {
  const ranges = [];
  for (const re of regexes) {
    if (!re) continue;
    for (const m of text.matchAll(re)) ranges.push([Math.max(0, m.index - radius), Math.min(text.length, m.index + m[0].length + radius)]);
  }
  if (!ranges.length) return '';
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r);
  }
  // Windows that actually talk about a battery go first, so menus and comments don't crowd out the spec line.
  const pieces = merged.map(([a, b]) => text.slice(a, b).replace(/\n+/g, ' / '));
  const rank = (p) => (/\b(SR|CR)\s?\d{3,4}|\b3\d\d\b/i.test(p) ? 2 : 0) + (/batter|cell/i.test(p) ? 1 : 0);
  const ordered = pieces.map((p, i) => ({ p, i, r: rank(p) })).sort((x, y) => y.r - x.r || x.i - y.i);
  let out = '';
  for (const { p } of ordered) {
    if (out.length + p.length > maxLen) continue;
    out += (out ? ' … ' : '') + p;
  }
  return out;
}
