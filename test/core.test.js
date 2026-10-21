import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBattery, findBatteryMentions, describeBattery, getBattery } from '../src/data/batteries.js';
import { normalizeCalibre, calibreVariants, calibreFromCasebackCodes, movementMaker, needleRegex } from '../src/lib/normalize.js';
import { verifyClaim, regexClaims, scoreClaims, trustFor } from '../src/lib/evidence.js';
import { parseDuckDuckGo, htmlToText, snippetsAround, parseCaliberCornerSearch } from '../src/lib/search.js';
import { parseTypedHint } from '../src/lib/identify.js';

test('battery names normalise to one canonical cell', () => {
  for (const s of ['377', 'SR626SW', 'sr 626 sw', 'Renata 377', 'V377', 'D377', 'Energizer 377 battery', 'SR66', 'AG4']) {
    assert.equal(normalizeBattery(s)?.battery.code, 'SR626SW', s);
  }
  assert.equal(normalizeBattery('376').battery.code, 'SR626W');
  assert.equal(normalizeBattery('371').battery.code, 'SR920SW');
  assert.equal(normalizeBattery('395').battery.code, 'SR927SW');
  assert.equal(normalizeBattery('399').battery.code, 'SR927W');
  assert.equal(normalizeBattery('cr2016').battery.code, 'CR2016');
  assert.ok(normalizeBattery('AG4').alkalineInput);
  const bare = normalizeBattery('SR920');
  assert.equal(bare.battery.code, 'SR920SW');
  assert.ok(bare.assumedSuffix);
  assert.equal(normalizeBattery('SR999SW'), null);
  assert.equal(normalizeBattery('hello'), null);
});

test('battery sizes come from the IEC code', () => {
  const b = describeBattery(getBattery('SR626SW'));
  assert.equal(b.diameter_mm, 6.8);
  assert.equal(b.height_mm, 2.6);
  assert.deepEqual(b.same_size, ['SR626W']);
  assert.equal(getBattery('CR2025').d, 20);
  assert.equal(getBattery('CR2025').h, 2.5);
});

test('bare numbers only count as batteries in battery context', () => {
  assert.deepEqual(findBatteryMentions('Price $377 shipped').map((m) => m.code), []);
  assert.deepEqual(findBatteryMentions('uses a Renata 377 cell').map((m) => m.code), ['SR626SW']);
  assert.deepEqual(findBatteryMentions('battery: 371 (SR920SW)').map((m) => m.code), ['SR920SW', 'SR920SW']);
  assert.deepEqual(findBatteryMentions('CR2016 lithium').map((m) => m.code), ['CR2016']);
});

test('calibre normalisation', () => {
  assert.equal(normalizeCalibre('ETA 955.112'), '955112');
  assert.equal(normalizeCalibre('Cal. 7N43'), '7N43');
  assert.equal(normalizeCalibre('Seiko NH35A'), 'NH35A');
  assert.equal(normalizeCalibre('Miyota 2035'), '2035');
  assert.deepEqual(calibreVariants('VX42E'), ['VX42E', 'VX42']);
  assert.deepEqual(calibreVariants('2035'), ['2035']);
});

test('caseback codes give the movement for Seiko, Citizen and Casio', () => {
  assert.equal(calibreFromCasebackCodes('Seiko', ['123456', '7N43-0AA0']).calibre, '7N43');
  assert.equal(calibreFromCasebackCodes('Pulsar', ['VX42-X020']).calibre, 'VX42');
  assert.equal(calibreFromCasebackCodes('SEIKO', ['7546-6010']).calibre, '7546');
  assert.equal(calibreFromCasebackCodes('Citizen', ['GN-4W-S', 'E168-S081234']).calibre, 'E168');
  assert.equal(calibreFromCasebackCodes('Casio', ['DW-5600E', '3229']).calibre, '3229');
  assert.equal(calibreFromCasebackCodes('Fossil', ['FS4656']), null);
  assert.equal(movementMaker('Miyota 2035', 'Fossil'), 'miyota');
  assert.equal(movementMaker('7N43', 'Seiko'), 'seiko');
});

test('needle regex tolerates separators and suffixes but not longer numbers', () => {
  const re = needleRegex('955.112');
  assert.ok('ETA 955.112 uses'.match(re));
  assert.ok('ETA 955112 uses'.match(needleRegex('955.112')));
  assert.ok('VX42E battery'.match(needleRegex('VX42')));
  assert.equal('model 120355 x'.match(needleRegex('2035')), null);
});

test('AI claims are only accepted when the quote is really on the page', () => {
  const page = 'Movement chart | Miyota 2035 | SR626SW (377) | Miyota 2115 | SR626SW';
  const needles = [needleRegex('2035')];
  assert.equal(verifyClaim({ battery: '377', quote: 'Miyota 2035 | SR626SW (377)' }, page, needles)?.code, 'SR626SW');
  assert.equal(verifyClaim({ battery: '371', quote: 'Miyota 2035 uses 371' }, page, needles), null, 'invented quote');
  assert.equal(verifyClaim({ battery: '371', quote: 'Miyota 2035 | SR626SW (377)' }, page, needles), null, 'battery not in quote');
  assert.equal(verifyClaim({ battery: '377', quote: 'Miyota 2115 | SR626SW' }, page, needles), null, 'different movement');
});

test('regex fallback reads chart rows', () => {
  const text = 'Miyota 2035 SR626SW\nRonda 715 SR920SW';
  const found = regexClaims(text, [needleRegex('715')]);
  assert.deepEqual(found.map((f) => f.battery.code), ['SR920SW']);
});

test('scoring: independent trusted sources beat a marketplace and AI memory', () => {
  const { candidates, confidence } = scoreClaims([
    { code: 'SR626SW', url: 'https://www.renata.com/x', method: 'ai_quote', quote: 'a' },
    { code: '377', url: 'https://calibercorner.com/y', method: 'ai_quote', quote: 'b' },
    { code: 'SR626SW', url: 'https://www.watchuseek.com/z', method: 'ai_quote', quote: 'c' },
    { code: 'SR621SW', url: 'https://www.ebay.com/itm/1', method: 'ai_quote', quote: 'd' },
    { code: 'SR621SW', method: 'ai_memory' },
  ]);
  assert.equal(candidates[0].battery.code, 'SR626SW');
  assert.equal(candidates[0].score, 6);
  assert.equal(confidence, 'high');
  assert.equal(candidates[1].battery.code, 'SR621SW');
});

test('scoring: same domain counts once, W/SW merge by size', () => {
  const { candidates, confidence } = scoreClaims([
    { code: 'SR927W', url: 'https://forum.example.com/a', method: 'ai_quote' },
    { code: 'SR927SW', url: 'https://forum.example.com/b', method: 'ai_quote' },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].score, 1);
  assert.equal(confidence, 'low');
});

test('trust levels', () => {
  assert.equal(trustFor('renata.com').weight, 3);
  assert.equal(trustFor('ebay.co.uk').weight, 0.5);
  assert.equal(trustFor('random-blog.net').weight, 1);
});

test('duckduckgo html parsing', () => {
  const html = `<div><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.renata.com%2Fen%2Fchart&amp;rut=abc">Renata <b>chart</b></a>
    <a class="result__snippet" href="x">The <b>2035</b> uses 377</a></div>
    <div><a class="result__a" href="https://example.com/page">Example</a><a class="result__snippet" href="y">snippet two</a></div>`;
  const r = parseDuckDuckGo(html);
  assert.equal(r.length, 2);
  assert.equal(r[0].url, 'https://www.renata.com/en/chart');
  assert.equal(r[0].title, 'Renata chart');
  assert.equal(r[0].snippet, 'The 2035 uses 377');
  assert.equal(r[1].url, 'https://example.com/page');
});

test('html to text keeps table rows readable and snippets focus on the movement', () => {
  const text = htmlToText('<html><head><title>x</title></head><body><script>var a=1</script><table><tr><td>Miyota 2035</td><td>SR626SW</td></tr><tr><td>Ronda 715</td><td>SR920SW</td></tr></table>&amp; more</body></html>');
  assert.match(text, /Miyota 2035 \| SR626SW/);
  assert.doesNotMatch(text, /var a/);
  const snip = snippetsAround('x'.repeat(1000) + ' Ronda 715 SR920SW ' + 'y'.repeat(1000), [needleRegex('715')], 20);
  assert.ok(snip.includes('Ronda 715 SR920SW'));
  assert.ok(snip.length < 100);
});

test('typed hints', () => {
  const a = parseTypedHint('Seiko 7N43-0AA0');
  assert.equal(a.brand, 'Seiko');
  assert.deepEqual(a.caseback_codes, ['7N43-0AA0']);
  const b = parseTypedHint('Miyota 2035');
  assert.equal(b.calibre, '2035');
  const c = parseTypedHint('Casio module 3229');
  assert.equal(c.calibre, '3229');
  assert.equal(c.brand, 'Casio');
  assert.equal(parseTypedHint('old battery says 377 renata').battery_text, '377');
});

test('spec-sheet lines on a page about the movement', () => {
  const text = 'Caliber Number | Ronda 715 | / Battery Cell Number | 371 | / Claimed Battery Life | 60 months … There is also a 715Li that uses a CR 2016';
  const found = regexClaims(text, [needleRegex('715')], 120, true);
  assert.deepEqual(found.map((f) => [f.battery.code, f.kind]), [['SR920SW', 'spec']]);
  // Not "about" the movement: only mentions right after the name count.
  assert.deepEqual(regexClaims('Ronda 715 | 26mm | Battery 371', [needleRegex('715')]).map((f) => f.kind), ['near']);
});

test('snippets put battery talk first', () => {
  const text = `menu 2035 ${'x'.repeat(800)} comments about 2035 ${'y'.repeat(800)} Caliber 2035 Battery Cell Number SR626SW`;
  const snip = snippetsAround(text, [needleRegex('2035')], 60, 150);
  assert.match(snip, /SR626SW/);
});

test('caliber corner search results: exact calibre pages only, entity-encoded links', () => {
  const html = `<a href="https://calibercorner.com/miyota-caliber-2035/?highlight=2035&#038;_rt=abc">x</a>
    <a href="https://calibercorner.com/miyota-caliber-2035g/?highlight=2035">x</a>
    <a href="https://calibercorner.com/list-of-rolex-watch-movements/?highlight=2035">x</a>
    <a href="https://calibercorner.com/seiko-epson-caliber-vx42e/?highlight=vx42">x</a>`;
  assert.deepEqual(parseCaliberCornerSearch(html, ['2035']).map((r) => r.url), ['https://calibercorner.com/miyota-caliber-2035/', 'https://calibercorner.com/miyota-caliber-2035g/']);
  assert.deepEqual(parseCaliberCornerSearch(html, ['vx42']).map((r) => r.url), ['https://calibercorner.com/seiko-epson-caliber-vx42e/']);
});

test('html entities common on watch sites', () => {
  assert.equal(htmlToText('A &middot; B &rsquo; C'), "A · B ' C");
});
