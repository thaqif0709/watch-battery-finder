// Tap-to-measure: two points across the watch case, two across the ring/coin of known size.
// case mm = ref mm × (case px / ref px). Works because the photo was taken flat (spirit level).

export function caseSize(casePts, refPts, refMm) {
  if (casePts.length < 2 || refPts.length < 2 || !(refMm > 0)) return null;
  const d = (p) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const refPx = d(refPts);
  if (refPx < 5) return null;
  return Math.round((refMm * d(casePts)) / refPx * 10) / 10;
}

export function openMeasure(dialog, imageDataUrl, refMm) {
  const canvas = dialog.querySelector('#measure-canvas');
  const out = dialog.querySelector('#measure-out');
  const help = dialog.querySelector('#measure-help');
  const okBtn = dialog.querySelector('#measure-ok');
  const refInput = dialog.querySelector('#measure-ref-mm');
  const segButtons = [...dialog.querySelectorAll('.seg button')];
  const ctx = canvas.getContext('2d');
  const pts = { case: [], ref: [] };
  const colors = { case: '#1f6feb', ref: '#e8710a' };
  let target = 'case';
  let drag = null;
  let pointerPos = null;
  refInput.value = refMm || '';

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      dialog.showModal();
      draw();
    };
    img.src = imageDataUrl;

    const scale = () => canvas.width / canvas.getBoundingClientRect().width;
    const toImg = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
    };

    function setTarget(t) {
      target = t;
      segButtons.forEach((b) => b.classList.toggle('active', b.dataset.target === t));
      help.textContent = t === 'case' ? 'Tap the left and right edge of the watch case (drag dots to adjust).' : 'Tap the left and right OUTER edge of the ring / coin.';
    }

    function draw() {
      ctx.drawImage(img, 0, 0);
      const s = scale();
      for (const key of ['case', 'ref']) {
        const p = pts[key];
        ctx.strokeStyle = colors[key];
        ctx.fillStyle = colors[key];
        ctx.lineWidth = 3 * s;
        if (p.length === 2) {
          ctx.beginPath();
          ctx.moveTo(p[0].x, p[0].y);
          ctx.lineTo(p[1].x, p[1].y);
          ctx.stroke();
        }
        for (const q of p) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, 9 * s, 0, Math.PI * 2);
          ctx.globalAlpha = 0.35;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2 * s;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(q.x, q.y, 1.5 * s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Magnifier while dragging, so fingers don't hide the edge.
      if (drag && pointerPos) {
        const r = 70 * s;
        const zoom = 3;
        const cx = pointerPos.x < canvas.width / 2 ? canvas.width - r - 10 * s : r + 10 * s;
        const cy = r + 10 * s;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, pointerPos.x - r / zoom, pointerPos.y - r / zoom, (2 * r) / zoom, (2 * r) / zoom, cx - r, cy - r, 2 * r, 2 * r);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 * s;
        ctx.beginPath();
        ctx.moveTo(cx - 12 * s, cy);
        ctx.lineTo(cx + 12 * s, cy);
        ctx.moveTo(cx, cy - 12 * s);
        ctx.lineTo(cx, cy + 12 * s);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      const mm = caseSize(pts.case, pts.ref, Number(refInput.value));
      out.textContent = mm ? `Case ≈ ${mm} mm` : pts.case.length === 2 && pts.ref.length === 2 ? 'Enter the ring/coin diameter above' : '–';
      okBtn.disabled = !mm;
    }

    const onDown = (e) => {
      const p = toImg(e);
      const hit = 24 * scale();
      for (const key of ['case', 'ref']) {
        const i = pts[key].findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < hit);
        if (i >= 0) {
          drag = { key, i };
          setTarget(key);
          break;
        }
      }
      if (!drag) {
        if (pts[target].length >= 2) pts[target] = [];
        pts[target].push(p);
        drag = { key: target, i: pts[target].length - 1 };
        if (target === 'case' && pts.case.length === 2 && pts.ref.length < 2) setTarget('ref');
      }
      pointerPos = p;
      canvas.setPointerCapture(e.pointerId);
      draw();
    };
    const onMove = (e) => {
      if (!drag) return;
      const p = toImg(e);
      pts[drag.key][drag.i] = p;
      pointerPos = p;
      draw();
    };
    const onUp = () => {
      drag = null;
      pointerPos = null;
      draw();
    };
    const finish = (value) => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      refInput.removeEventListener('input', draw);
      dialog.close();
      resolve(value);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    refInput.addEventListener('input', draw);
    segButtons.forEach((b) => (b.onclick = () => setTarget(b.dataset.target)));
    dialog.querySelector('#measure-cancel').onclick = () => finish(null);
    okBtn.onclick = () => finish({ caseMm: caseSize(pts.case, pts.ref, Number(refInput.value)), refMm: Number(refInput.value) });
    dialog.oncancel = (e) => {
      e.preventDefault();
      finish(null);
    };
    setTarget('case');
  });
}
