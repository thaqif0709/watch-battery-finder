// Second-hand test: watch the dial for a few seconds and tell ticking (quartz) from sweeping (mechanical).
// Works on tiny grayscale frames of the circle area; a jumping hand shows up as a burst of changed
// pixels once a second, a sweeping hand changes a little all the time.

const SIZE = 80;
const PIXEL_DIFF = 28;
const MIN_CHANGED = 3;

export async function recordSecondHand(video, { seconds = 8, onProgress } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const frames = [];
  const start = performance.now();

  await new Promise((resolve) => {
    const step = () => {
      const t = (performance.now() - start) / 1000;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        // Same area as the on-screen guide circle (the middle 60%).
        const side = Math.min(w, h) * 0.6;
        ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
        const gray = new Uint8Array(SIZE * SIZE);
        for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 3 + data[i * 4 + 1] * 6 + data[i * 4 + 2]) / 10;
        frames.push({ t, gray });
      }
      onProgress?.(Math.min(1, t / seconds));
      if (t >= seconds) return resolve();
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };
    step();
  });
  return analyzeFrames(frames);
}

function changed(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > PIXEL_DIFF) n++;
  return n;
}

export function analyzeFrames(frames) {
  const series = [];
  for (let i = 1; i < frames.length; i++) {
    const t = frames[i].t;
    let j = i - 1;
    while (j > 0 && t - frames[j].t < 0.5) j--;
    series.push({ t, short: changed(frames[i].gray, frames[i - 1].gray), long: t - frames[j].t >= 0.45 ? changed(frames[i].gray, frames[j].gray) : null });
  }
  return classify(series, SIZE * SIZE);
}

// series: [{ t (s), short: changed px vs previous frame, long: changed px vs ~0.5 s earlier }]
export function classify(series, totalPixels) {
  const out = (pattern, label, extra = {}) => ({ pattern, label, series: series.map((s) => s.short), ...extra });
  if (series.length < 20) return out('unclear', 'Not enough frames. Try again with the camera running.');
  const fps = series.length / (series[series.length - 1].t - series[0].t);
  const shortVals = series.map((s) => s.short).sort((a, b) => a - b);
  if (shortVals[Math.floor(shortVals.length / 2)] > totalPixels * 0.02) return out('shaky', 'Too much movement. Rest the phone on something and try again.', { fps });

  // Bursts of change = hand jumps. Ignore whole-picture changes (auto-exposure flicker).
  const events = [];
  for (const s of series) {
    if (s.short < MIN_CHANGED || s.short > totalPixels * 0.15) continue;
    const last = events[events.length - 1];
    if (last && s.t - last.end < 0.25) last.end = s.t;
    else events.push({ start: s.t, end: s.t });
  }
  const activeFrac = series.filter((s) => s.short >= MIN_CHANGED).length / series.length;
  const intervals = events.slice(1).map((e, i) => e.start - events[i].start);
  const medInterval = intervals.length ? [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)] : null;
  const regular = intervals.length >= 2 && intervals.filter((x) => Math.abs(x - medInterval) < 0.25).length >= intervals.length * 0.6;
  const extra = { fps: Math.round(fps), events: events.length, interval: medInterval && Math.round(medInterval * 100) / 100 };

  if (regular && activeFrac < 0.4) {
    if (medInterval > 0.8 && medInterval < 1.25) return out('tick_1s', 'Ticks once a second: quartz.', extra);
    if (medInterval > 1.6 && medInterval < 2.5) return out('tick_2s', 'Jumps every 2 seconds: quartz with a nearly flat battery.', extra);
  }
  const longs = series.filter((s) => s.long != null);
  const movingFrac = longs.length ? longs.filter((s) => s.long >= MIN_CHANGED).length / longs.length : 0;
  // A ticking hand only differs from 0.5 s earlier about half the time; a sweeping one always does.
  if (movingFrac > 0.75) return out('sweep', 'Sweeps smoothly: mechanical (automatic or hand-wound).', extra);
  if (movingFrac < 0.1 && events.length < 2) return out('stopped', 'Hands aren\'t moving: the watch is stopped (flat battery, or an automatic that needs winding).', extra);
  return out('unclear', 'Couldn\'t tell. Make sure the second hand is inside the circle and try again.', extra);
}

export function drawSpark(canvas, values) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(10, ...values);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#1f6feb';
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - 4 - (v / max) * (h - 8);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}
