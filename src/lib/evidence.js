// Weighing web evidence: who said which battery, can we verify they actually said it, and how much
// do we trust them. The answer is the battery the most trustworthy independent sources agree on.

import { normalizeBattery, findBatteryMentions, getBattery, describeBattery } from '../data/batteries.js';

const TRUST = [
  // Movement / battery manufacturers and their official docs.
  [3, 'manufacturer', /(^|\.)(renata\.com|energizer\.com|maxell\.(com|co\.jp|eu)|sii\.co\.jp|seiko-instruments\.\w+|seikowatches\.com|seiko-watch\.co\.jp|seiko\.co\.jp|citizenwatch\.com|citizen\.co\.jp|citizenwatch-global\.com|miyotamovement\.com|casio\.com|ronda\.ch|eta\.ch|isaswiss\.com|sellita\.ch|swatchgroup\.com)$/],
  // Movement databases and trade suppliers who sell by movement number.
  [2, 'trade / movement database', /(^|\.)(calibercorner\.com|esslinger\.com|ofrei\.com|cousinsuk\.com|julesborel\.com|perrinwatchparts\.com|boley\.de|flume\.de|sternkreuz\.\w+|ranfft\.de|watch-wiki\.org|cas-ker\.com)$/],
  // Marketplaces: listings are often copy-pasted and wrong.
  [0.5, 'marketplace', /(^|\.)(ebay\.[\w.]+|amazon\.[\w.]+|aliexpress\.[\w.]+|temu\.com|shopee\.[\w.]+|lazada\.[\w.]+|etsy\.com|walmart\.com)$/],
];

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function trustFor(domain) {
  for (const [weight, kind, re] of TRUST) if (re.test(domain)) return { weight, kind };
  return { weight: 1, kind: /forum|reddit|watchuseek|watchrecon|thewatchforum|rolexforums|tz/.test(domain) ? 'forum' : 'website' };
}

const squash = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

// An AI claim only counts if its quote really appears in the page and really contains the battery
// and the movement/model name. This is what stops the AI from inventing sources.
export function verifyClaim(claim, sourceText, needles) {
  const quote = squash(claim.quote ?? '');
  if (quote.length < 6 || !squash(sourceText).includes(quote)) return null;
  const n = normalizeBattery(claim.battery);
  if (!n) return null;
  const mentioned = findBatteryMentions(claim.quote).some((m) => m.battery.size === n.battery.size);
  if (!mentioned) return null;
  if (needles.length && !needles.some((re) => re && new RegExp(re.source, 'i').test(claim.quote))) return null;
  return n.battery;
}

// Fallback when the AI isn't available: battery names that appear right after the movement name
// (like a row in a chart "2035 ... SR626SW"). Weaker, so it counts half.
// On a page that is *about* the movement (its title/URL names it), a spec line like
// "Battery Cell Number SR626SW / 377" counts even if it's far from the movement name.
const SPEC_LINE = /battery(?:\s+(?:cell|type|size|number|no\.?|model))*\s*[:\-–|]?\s*([^\n]{0,40})/gi;

export function regexClaims(sourceText, needles, reach = 120, pageAbout = false) {
  const found = new Map();
  if (pageAbout) {
    for (const m of sourceText.matchAll(SPEC_LINE)) {
      const mention = findBatteryMentions(m[0])[0];
      if (mention && !found.has(mention.battery.size)) found.set(mention.battery.size, { battery: mention.battery, quote: m[0].trim(), kind: 'spec' });
      if (found.size) return [...found.values()];
    }
  }
  for (const re of needles) {
    if (!re) continue;
    for (const m of sourceText.matchAll(new RegExp(re.source, 'gi'))) {
      const after = sourceText.slice(m.index, m.index + m[0].length + reach);
      const cut = after.split(/\n/)[0];
      const mention = findBatteryMentions(cut)[0];
      if (mention && !found.has(mention.battery.size)) found.set(mention.battery.size, { battery: mention.battery, quote: cut.trim(), kind: 'near' });
    }
  }
  return [...found.values()];
}

// claims: [{ code, url, title, quote, method: 'ai_quote' | 'spec' | 'regex' | 'ai_memory' | 'photo' }]
export function scoreClaims(claims) {
  const groups = new Map();
  for (const c of claims) {
    const b = getBattery(c.code);
    if (!b) continue;
    const domain = c.url ? domainOf(c.url) : c.method;
    const trust = c.url ? trustFor(domain) : { weight: c.method === 'photo' ? 3 : 0.5, kind: c.method === 'photo' ? 'seen in photo' : 'AI memory (unverified)' };
    // A battery merely printed near the movement name counts half; a spec-sheet line or a verified AI quote counts fully.
    const weight = trust.weight * (c.method === 'regex' ? 0.5 : 1);
    const g = groups.get(b.size) ?? { size: b.size, variants: new Map(), byDomain: new Map() };
    g.variants.set(b.code, (g.variants.get(b.code) ?? 0) + weight);
    const prev = g.byDomain.get(domain);
    if (!prev || prev.weight < weight) g.byDomain.set(domain, { domain, url: c.url ?? null, title: c.title ?? null, quote: c.quote ?? null, kind: trust.kind, method: c.method, weight });
    groups.set(b.size, g);
  }
  const total = [...groups.values()].reduce((sum, g) => sum + groupScore(g), 0);
  const candidates = [...groups.values()]
    .map((g) => {
      const score = groupScore(g);
      // Most votes decide SW vs W; ties go to the low-drain SW version, which is what most analog watches want.
      const code = [...g.variants.entries()].sort((a, b) => b[1] - a[1] || (a[0].endsWith('SW') ? -1 : 1))[0][0];
      const sources = [...g.byDomain.values()].sort((a, b) => b.weight - a.weight);
      return { battery: describeBattery(getBattery(code)), score: round(score), share: round(total ? score / total : 0), sources };
    })
    .sort((a, b) => b.score - a.score);
  return { candidates, confidence: confidenceOf(candidates) };
}

function groupScore(g) {
  return [...g.byDomain.values()].reduce((s, d) => s + d.weight, 0);
}

function confidenceOf(candidates) {
  const top = candidates[0];
  if (!top) return 'none';
  const webSources = top.sources.filter((s) => s.url).length;
  const hasStrong = top.sources.some((s) => s.weight >= 2);
  if (top.score >= 4 && top.share >= 0.75 && hasStrong && webSources >= 2) return 'high';
  if (top.score >= 2 && top.share >= 0.6 && webSources >= 1) return 'medium';
  return 'low';
}

const round = (x) => Math.round(x * 100) / 100;
