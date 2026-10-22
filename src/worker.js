import { identify, summarize } from './lib/identify.js';
import { repo as makeRepo } from './lib/db.js';
import { ensureSchema } from './lib/schema.js';
import { pickProvider } from './lib/search.js';
import { BATTERIES, describeBattery, normalizeBattery } from './data/batteries.js';
import { movementMaker, makerFromBrand } from './lib/normalize.js';

const MAX_BODY = 12 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    try {
      if (url.pathname === '/api/health') return json(health(env));
      if (env.APP_PASSCODE && request.headers.get('x-passcode') !== env.APP_PASSCODE) return json({ error: 'Wrong or missing passcode (set it in Settings).' }, 401);
      return await route(request, env, url);
    } catch (e) {
      console.error(e);
      return json({ error: e.message || String(e) }, e.status && e.status < 600 ? e.status : 500);
    }
  },
};

function health(env) {
  return {
    ok: true,
    ai: Boolean(env.GEMINI_API_KEY),
    database: Boolean(env.DB),
    search: pickProvider(env),
    passcode_required: Boolean(env.APP_PASSCODE),
  };
}

async function route(request, env, url) {
  if (env.DB) await ensureSchema(env.DB);
  const repo = env.DB ? makeRepo(env.DB) : null;
  const method = request.method;
  const path = url.pathname;
  const id = Number(path.split('/')[3]);

  if (path === '/api/identify' && method === 'POST') {
    const body = await readJson(request);
    const result = await identify(body, { env, repo });
    if (repo) {
      result.lookup_id = await repo.saveLookup({
        owner: body.hints?.owner || null,
        battery: result.battery?.primary?.code ?? null,
        summary: summarize(result),
        result,
        thumbnail: typeof body.thumbnail === 'string' && body.thumbnail.length < 60_000 ? body.thumbnail : null,
      });
    }
    return json(result);
  }

  if (path === '/api/batteries' && method === 'GET') {
    const q = url.searchParams.get('q');
    if (q) {
      const n = normalizeBattery(q);
      return json({ match: n ? { ...describeBattery(n.battery), assumed_suffix: n.assumedSuffix, alkaline_input: n.alkalineInput } : null });
    }
    return json({ batteries: BATTERIES.map(describeBattery) });
  }

  if (!repo) return json({ error: 'Database not configured (D1 binding "DB").' }, 503);

  if (path === '/api/lookups' && method === 'GET') {
    return json({ lookups: await repo.listLookups(url.searchParams.get('status')) });
  }
  if (path.startsWith('/api/lookups/') && id) {
    if (method === 'GET') {
      const row = await repo.getLookup(id);
      return row ? json(row) : json({ error: 'Not found' }, 404);
    }
    if (method === 'PATCH') {
      const body = await readJson(request);
      const battery = body.battery ? normalizeBattery(body.battery)?.battery.code ?? body.battery : undefined;
      await repo.updateLookup(id, { owner: body.owner, status: body.status, battery });
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await repo.deleteLookup(id);
      return json({ ok: true });
    }
  }

  if (path === '/api/shopping' && method === 'GET') {
    const pending = await repo.listLookups('pending', 500);
    const counts = new Map();
    for (const l of pending) {
      const key = l.battery || 'Unknown (open to check)';
      const entry = counts.get(key) ?? { battery: key, details: l.battery ? describeBattery(normalizeBattery(l.battery)?.battery) : null, count: 0, watches: [] };
      entry.count++;
      entry.watches.push({ id: l.id, owner: l.owner, summary: l.summary });
      counts.set(key, entry);
    }
    return json({ items: [...counts.values()].sort((a, b) => b.count - a.count) });
  }

  if (path === '/api/confirm' && method === 'POST') {
    const body = await readJson(request);
    const n = body.battery ? normalizeBattery(body.battery) : null;
    if (body.battery && !n && !body.allow_unknown_battery) {
      return json({ error: `"${body.battery}" isn't a battery name I know. Check the spelling (e.g. SR626SW or 377).` }, 400);
    }
    const out = await repo.confirm({
      ...body,
      battery: n ? n.battery.code : body.battery || null,
      maker: body.calibre ? movementMaker(body.calibre, body.brand) : makerFromBrand(body.brand),
      case_mm: Number(body.case_mm) || null,
    });
    return json({ ok: true, ...out });
  }

  if (path === '/api/watches' && method === 'GET') {
    return json({ watches: await repo.listWatches(url.searchParams.get('q')) });
  }
  if (path.startsWith('/api/watches/') && id && method === 'DELETE') {
    await repo.deleteWatch(id);
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw Object.assign(new Error('Photos too large; the app shrinks them, so this should not happen.'), { status: 413 });
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error('Body must be JSON.'), { status: 400 });
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
