import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../public/tick.js';

const FPS = 30;
const PIXELS = 80 * 80;
// Build a synthetic 8 s recording: `short` = changed pixels vs previous frame, `long` = vs 0.5 s earlier.
function series(fn) {
  const out = [];
  for (let i = 1; i < FPS * 8; i++) {
    const t = i / FPS;
    out.push({ t, ...fn(t, i) });
  }
  return out;
}
const noise = (i) => (i * 7919) % 3; // 0..2 changed pixels of sensor noise

test('quartz ticking once per second', () => {
  const s = series((t, i) => {
    const jump = Math.abs(t - Math.round(t)) < 0.5 / FPS && Math.round(t) > 0;
    const sinceTick = t - Math.floor(t);
    return { short: jump ? 40 : noise(i), long: t >= 0.5 ? (sinceTick < 0.5 ? 40 : noise(i)) : null };
  });
  assert.equal(classify(s, PIXELS).pattern, 'tick_1s');
});

test('quartz end-of-life 2 second jumps', () => {
  const s = series((t, i) => {
    const jump = Math.abs(t / 2 - Math.round(t / 2)) < 0.25 / FPS && Math.round(t) > 0;
    return { short: jump ? 40 : noise(i), long: t >= 0.5 ? noise(i) : null };
  });
  assert.equal(classify(s, PIXELS).pattern, 'tick_2s');
});

test('mechanical sweep', () => {
  const s = series((t, i) => ({ short: noise(i), long: t >= 0.5 ? 25 + noise(i) : null }));
  assert.equal(classify(s, PIXELS).pattern, 'sweep');
});

test('stopped watch', () => {
  const s = series((t, i) => ({ short: noise(i), long: t >= 0.5 ? noise(i) : null }));
  assert.equal(classify(s, PIXELS).pattern, 'stopped');
});

test('shaky hands', () => {
  const s = series(() => ({ short: 900, long: 900 }));
  assert.equal(classify(s, PIXELS).pattern, 'shaky');
});
