import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify } from '../src/lib/identify.js';

const env = { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'missing-model,test-model', SEARCH_PROVIDER: 'duckduckgo' };

const PAGES = {
  'https://www.renata.com/chart': '<table><tr><td>Seiko 7N43</td><td>Renata 395 (SR927SW)</td></tr><tr><td>Seiko 7N42</td><td>371</td></tr></table>',
  'https://calibercorner.com/7n43': '<p>Caliber 7N43 battery: SR927SW. Battery life 3 years.</p>',
  'https://www.ebay.com/itm/1': '<p>Seiko 7N43 replacement SR621SW cheap!</p>',
  'https://unrelated.example/': '<p>Nothing about this movement here.</p>',
};

function fakeFetch(vision, claims) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push(url);
    if (url.includes('missing-model')) return new Response('{"error":{"message":"models/missing-model is not found"}}', { status: 404 });
    if (url.includes(':generateContent')) {
      const body = JSON.parse(init.body);
      const isVision = body.contents[0].parts.some((p) => p.inlineData);
      const payload = isVision ? vision : { claims };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
    }
    if (url.includes('duckduckgo')) {
      const links = Object.keys(PAGES).map((u) => `<a class="result__a" href="${u}">T ${u}</a><a class="result__snippet" href="#">s</a>`).join('');
      return new Response(links, { headers: { 'content-type': 'text/html' } });
    }
    if (PAGES[url]) return new Response(PAGES[url], { headers: { 'content-type': 'text/html' } });
    return new Response('nope', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

function memoryRepo(seed = {}) {
  const cache = new Map();
  return {
    findWatch: async () => seed.watch ?? null,
    findMovement: async () => seed.movement ?? null,
    cacheGet: async (k) => cache.get(k) ?? null,
    cachePut: async (k, v) => cache.set(k, v),
    cache,
  };
}

const seikoVision = {
  brand: 'Seiko', model_name: null, reference_number: 'SGEF01', caseback_codes: ['7N43-0AA0', '9X1234'],
  calibre: null, movement_type: 'quartz', type_evidence: ['dial says QUARTZ'], display: 'analog', features: ['date'],
  readability: 'good', battery_from_knowledge: 'SR621SW',
};
const images = [{ label: 'dial', data: 'AAAA' }, { label: 'caseback', data: 'BBBB' }];

test('quartz watch: caseback -> movement -> web evidence -> battery, with invented quotes rejected', async () => {
  const claims = [
    { source: 'S1', battery: '395', quote: 'Seiko 7N43 | Renata 395 (SR927SW)' },
    { source: 'S2', battery: 'SR927SW', quote: 'Caliber 7N43 battery: SR927SW.' },
    { source: 'S3', battery: 'SR621SW', quote: 'Seiko 7N43 replacement SR621SW' },
    { source: 'S2', battery: '371', quote: 'The 7N43 uses a 371' }, // not on the page -> rejected
  ];
  const f = fakeFetch(seikoVision, claims);
  const repo = memoryRepo();
  const r = await identify({ images, hints: {} }, { env, repo, fetchImpl: f });
  assert.equal(r.watch.calibre, '7N43');
  assert.equal(r.watch.maker, 'seiko');
  assert.equal(r.movement.type, 'quartz');
  assert.equal(r.battery.status, 'suggested');
  assert.equal(r.battery.primary.code, 'SR927SW');
  assert.equal(r.battery.confidence, 'high');
  assert.deepEqual(r.battery.sources.map((s) => s.domain), ['renata.com', 'calibercorner.com']);
  assert.equal(r.battery.alternatives[0].battery.code, 'SR621SW');
  assert.ok(r.trace.some((t) => /1 rejected/.test(t)), r.trace.join('\n'));
  assert.equal(repo.cache.size, 1);

  // Second time: served from cache, no search calls.
  const f2 = fakeFetch(seikoVision, []);
  const r2 = await identify({ images, hints: {} }, { env, repo, fetchImpl: f2 });
  assert.equal(r2.battery.primary.code, 'SR927SW');
  assert.ok(!f2.calls.some((u) => u.includes('duckduckgo')));
});

test('a movement you confirmed before wins without searching', async () => {
  const f = fakeFetch(seikoVision, []);
  const repo = memoryRepo({ movement: { calibre: '7N43', battery: 'SR927SW', confirmations: 3 } });
  const r = await identify({ images, hints: {} }, { env, repo, fetchImpl: f });
  assert.equal(r.battery.status, 'confirmed');
  assert.equal(r.battery.primary.code, 'SR927SW');
  assert.ok(!f.calls.some((u) => u.includes('duckduckgo')));
});

test('solar watch warns instead of suggesting a normal cell', async () => {
  const f = fakeFetch({ ...seikoVision, brand: 'Citizen', caseback_codes: ['E168-S081234'], movement_type: 'solar', type_evidence: ['Eco-Drive on dial'] }, []);
  const r = await identify({ images, hints: { tick: { pattern: 'tick_1s' } } }, { env, repo: memoryRepo(), fetchImpl: f });
  assert.equal(r.movement.type, 'solar');
  assert.equal(r.battery.status, 'rechargeable');
});

test('automatic watch shows movement details', async () => {
  const f = fakeFetch({ ...seikoVision, caseback_codes: ['7S26-02J0'], movement_type: 'automatic', type_evidence: ['dial says AUTOMATIC'] }, []);
  const r = await identify({ images, hints: {} }, { env, repo: memoryRepo(), fetchImpl: f });
  assert.equal(r.battery.status, 'not_applicable');
  assert.equal(r.movement.details.jewels, 21);
});

test('second hand ticking overrides an unsure photo', async () => {
  const f = fakeFetch({ ...seikoVision, movement_type: 'unknown' }, []);
  const r = await identify({ images, hints: { tick: { pattern: 'tick_2s' } } }, { env, repo: memoryRepo(), fetchImpl: f });
  assert.equal(r.movement.type, 'quartz');
  assert.ok(r.warnings.some((w) => /nearly flat/.test(w)));
});

test('typed text without photos or AI key still works via pattern matching', async () => {
  const f = fakeFetch(null, []);
  const r = await identify({ hints: { text: 'Seiko 7N43-0AA0' } }, { env: { SEARCH_PROVIDER: 'duckduckgo' }, repo: memoryRepo(), fetchImpl: f });
  assert.equal(r.watch.calibre, '7N43');
  assert.equal(r.battery.primary.code, 'SR927SW');
  assert.ok(r.battery.sources.every((s) => ['regex', 'spec'].includes(s.method)));
});

test('nothing found -> unknown, open it', async () => {
  const f = fakeFetch({ ...seikoVision, brand: 'NoName', caseback_codes: [], reference_number: null, battery_from_knowledge: null }, []);
  const r = await identify({ images, hints: {} }, { env, repo: memoryRepo(), fetchImpl: f });
  assert.equal(r.battery.status, 'unknown');
});
