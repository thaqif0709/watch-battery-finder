import { Camera, watchLevel, toJpeg } from './camera.js';
import { recordSecondHand, drawSpark } from './tick.js';
import { openMeasure } from './measure.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- settings (per device) ----------
const store = {
  get(key, fallback = '') {
    try {
      return localStorage.getItem(`wbf:${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`wbf:${key}`, value);
    } catch {}
  },
};

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-passcode': store.get('passcode') },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) {
    if (res.status === 401) toast('Passcode needed. Set it in Settings.');
    throw new Error(data.error || `Server error (${res.status})`);
  }
  return data;
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    prompt('Copy this:', text);
  }
}

// ---------- navigation ----------
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === (view === 'result' ? 'scan' : view)));
  if (view === 'list') loadList();
  if (view === 'db') loadWatches();
  if (view === 'settings') loadSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => show(b.dataset.view)));

// ---------- scan state ----------
const state = { shot: 'dial', shots: [], tick: null, caseMm: null, refMm: null, current: null };
const TIPS = {
  dial: 'Watch flat on the table, dial up. Fill the circle. Put your ring next to it if you want the case size.',
  caseback: 'Flip the watch over. Get close and angle a light from the side so engravings show; use zoom or "Phone cam" for sharper text.',
  extra: 'Anything else that helps: a side view, the old battery, the movement if it\'s already open.',
};

const camera = new Camera($('#video'));
const level = watchLevel(onLevel);
let cameraOn = false;

function setShot(kind) {
  state.shot = kind;
  document.querySelectorAll('.shot-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.shot === kind));
  $('#shot-tip').textContent = TIPS[kind];
}
document.querySelectorAll('.shot-tabs .tab').forEach((t) => (t.onclick = () => setShot(t.dataset.shot)));
setShot('dial');

$('#start-camera').onclick = async () => {
  try {
    await camera.start();
    cameraOn = true;
    $('#camera-off').hidden = true;
    $('#level-text').textContent = 'Checking level…';
    $('#capture').disabled = false;
    $('#tick-btn').disabled = false;
    const zr = camera.zoomRange();
    if (zr && zr.max > zr.min) {
      const z = $('#zoom');
      Object.assign(z, { min: zr.min, max: Math.min(zr.max, 10), step: zr.step, value: zr.min });
      z.oninput = () => camera.setZoom(Number(z.value));
      $('#zoom-wrap').hidden = false;
    }
    const ok = await level.start();
    if (!ok) $('#level-text').textContent = 'No tilt sensor: hold as flat as you can';
    else setTimeout(() => !level.isActive() && ($('#level-text').textContent = 'No tilt sensor: hold as flat as you can'), 1500);
  } catch (e) {
    $('#scan-error').textContent = e.message;
  }
};

function onLevel({ beta, gamma, tilt }) {
  const tol = Number(store.get('tilt', '3')) || 3;
  const isLevel = tilt <= tol;
  const clamp = (v) => Math.max(-20, Math.min(20, v));
  $('#bubble').style.transform = `translate(${clamp(gamma) * 1.1}px, ${clamp(beta) * 1.1}px)`;
  $('.camera').classList.toggle('level', isLevel);
  $('#capture').classList.toggle('level', isLevel);
  $('#level-text').textContent = isLevel ? `Level ✓ (${tilt.toFixed(1)}°)` : `Tilt ${tilt.toFixed(0)}°: hold flatter`;
  state.lastTilt = tilt;
}

$('#capture').onclick = async () => {
  try {
    await addShot(camera.capture(), { tilt: state.lastTilt });
  } catch (e) {
    $('#scan-error').textContent = e.message;
  }
};
for (const id of ['#upload', '#native-cam']) {
  $(id).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await addShot(file, {});
  };
}

async function addShot(source, meta) {
  const img = await toJpeg(source, 1600, 0.88);
  const thumb = await toJpeg(img.canvas, 160, 0.7);
  const kind = state.shot;
  if (kind !== 'extra') state.shots = state.shots.filter((s) => s.kind !== kind);
  state.shots.push({ kind, img, thumb, ...meta });
  if (kind === 'dial') {
    state.caseMm = null;
    $('#size-result').textContent = '';
  }
  renderShots();
  if (meta.tilt != null && meta.tilt > (Number(store.get('tilt', '3')) || 3) * 2) toast('Photo taken at an angle; the case size will be less accurate.');
  if (kind === 'dial' && !state.shots.some((s) => s.kind === 'caseback')) setShot('caseback');
  else if (kind === 'caseback') toast('Got it. Tap "Identify watch" when ready.');
}

function renderShots() {
  const labels = { dial: 'Dial', caseback: 'Back', extra: 'Extra' };
  $('#shots').innerHTML = state.shots
    .map((s, i) => `<div class="shot"><img src="${s.thumb.dataUrl}" alt="${labels[s.kind]} photo"><span>${labels[s.kind]}</span><button data-i="${i}" aria-label="Remove">×</button></div>`)
    .join('');
  $('#shots').querySelectorAll('button').forEach((b) => (b.onclick = () => {
    state.shots.splice(Number(b.dataset.i), 1);
    renderShots();
  }));
  document.querySelectorAll('.shot-tabs .tab').forEach((t) => t.classList.toggle('done', state.shots.some((s) => s.kind === t.dataset.shot)));
  $('#measure-btn').disabled = !state.shots.some((s) => s.kind === 'dial');
  updateIdentifyButton();
}

function updateIdentifyButton() {
  $('#identify').disabled = !state.shots.length && !$('#hint').value.trim();
}
$('#hint').oninput = updateIdentifyButton;

// ---------- second-hand test ----------
$('#tick-btn').onclick = async () => {
  if (!cameraOn) return;
  const btn = $('#tick-btn');
  btn.disabled = true;
  $('#tick-result').textContent = 'Recording… keep still';
  try {
    const r = await recordSecondHand($('#video'), { seconds: 8, onProgress: (p) => (btn.textContent = `${Math.round(p * 100)}%`) });
    state.tick = r;
    $('#tick-result').textContent = r.label;
    const chart = $('#tick-chart');
    chart.hidden = false;
    drawSpark(chart, r.series);
  } catch (e) {
    $('#tick-result').textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Record 8 s';
  }
};

// ---------- measure ----------
$('#measure-btn').onclick = async () => {
  const dial = state.shots.find((s) => s.kind === 'dial');
  if (!dial) return;
  const r = await openMeasure($('#measure-dialog'), dial.img.dataUrl, Number(store.get('refMm')) || null);
  if (r) {
    state.caseMm = r.caseMm;
    if (r.refMm) store.set('refMm', String(r.refMm));
    $('#size-result').textContent = `Case ≈ ${r.caseMm} mm`;
  }
};

// ---------- identify ----------
$('#identify').onclick = async () => {
  const btn = $('#identify');
  $('#scan-error').textContent = '';
  btn.disabled = true;
  const steps = ['Reading the photos…', 'Working out the movement…', 'Checking your database…', 'Searching the web for the battery…', 'Cross-checking sources…'];
  let i = 0;
  btn.innerHTML = `<span class="spinner"></span> ${steps[0]}`;
  const timer = setInterval(() => (btn.innerHTML = `<span class="spinner"></span> ${steps[Math.min(++i, steps.length - 1)]}`), 3500);
  try {
    const labels = { dial: 'dial (front)', caseback: 'caseback (back)', extra: 'extra photo' };
    const order = { dial: 0, caseback: 1, extra: 2 };
    const shots = [...state.shots].sort((a, b) => order[a.kind] - order[b.kind]);
    const body = {
      images: shots.map((s) => ({ label: labels[s.kind], mime: 'image/jpeg', data: s.img.base64 })),
      thumbnail: shots[0]?.thumb.dataUrl ?? null,
      hints: {
        text: $('#hint').value.trim() || null,
        owner: $('#owner').value.trim() || null,
        case_mm: state.caseMm,
        tick: state.tick ? { pattern: state.tick.pattern } : null,
      },
    };
    const result = await api('/api/identify', { method: 'POST', body });
    state.current = { result, thumbnail: body.thumbnail, owner: body.hints.owner };
    renderResult();
    show('result');
  } catch (e) {
    $('#scan-error').textContent = e.message;
  } finally {
    clearInterval(timer);
    btn.textContent = 'Identify watch';
    updateIdentifyButton();
  }
};

function resetScan() {
  state.shots = [];
  state.tick = null;
  state.caseMm = null;
  state.current = null;
  $('#hint').value = '';
  $('#owner').value = '';
  $('#tick-result').textContent = '';
  $('#size-result').textContent = '';
  $('#tick-chart').hidden = true;
  renderShots();
  setShot('dial');
  show('scan');
}

// ---------- result ----------
const STATUS = {
  confirmed: ['ok', '✅ Confirmed by you'],
  seen: ['ok', '✅ Read off the watch'],
  reference: ['info', '📘 From your database (movement guessed)'],
  suggested: ['info', '🔎 Suggested from the web'],
  guess: ['warn', '⚠️ AI guess only'],
  unknown: ['warn', '❓ Unknown'],
  rechargeable: ['warn', '♻️ Rechargeable, not a normal battery'],
  not_applicable: ['ok', 'No battery needed'],
};
const CONF = { high: ['ok', 'High confidence'], medium: ['info', 'Medium confidence'], low: ['warn', 'Low confidence'] };
const TYPE_BADGE = { quartz: 'info', automatic: 'ok', manual_wind: 'ok', solar: 'warn', kinetic: 'warn', spring_drive: 'ok', smartwatch: 'warn', unknown: 'warn' };

function renderResult() {
  const { result: r } = state.current;
  const w = r.watch;
  const b = r.battery ?? {};
  const name = [w.brand, w.model].filter(Boolean).join(' ') || 'Unknown watch';
  const [stCls, stText] = STATUS[b.status] ?? ['', b.status];
  const kv = (pairs) => `<dl class="kv">${pairs.filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(', ') : v)}</dd>`).join('')}</dl>`;

  let batteryHtml = '';
  if (b.primary) {
    const p = b.primary;
    const conf = CONF[b.confidence];
    batteryHtml = `
      <div class="battery-box ${esc(b.status)}">
        <span class="badge ${stCls}">${stText}</span> ${conf && b.status !== 'confirmed' && b.status !== 'seen' ? `<span class="badge ${conf[0]}">${conf[1]}</span>` : ''}
        <div class="battery-code">${esc(p.code)}</div>
        <div class="battery-names">${esc((p.names ?? []).slice(1).join(' · '))}${p.diameter_mm ? ` · ${p.diameter_mm} × ${p.height_mm} mm · ${esc(p.chemistry)} ${p.volts} V` : ''}</div>
        ${p.same_size?.length ? `<p class="muted">Same size: ${esc(p.same_size.join(', '))} (${p.drain === 'low' ? 'high-drain version' : 'low-drain version'})</p>` : ''}
        <p>${esc(b.message)}</p>
        ${b.sources?.length ? `<ul class="sources">${b.sources.map(sourceHtml).join('')}</ul>` : ''}
        ${b.alternatives?.length ? `<p class="muted">Also mentioned: ${b.alternatives.map((a) => `${esc(a.battery.code)} (${a.sources.map((s) => esc(s.domain)).join(', ')})`).join('; ')}</p>` : ''}
      </div>`;
  } else {
    batteryHtml = `<div class="battery-box ${esc(b.status)}"><span class="badge ${stCls}">${stText}</span><p>${esc(b.message ?? '')}</p></div>`;
  }

  const d = r.movement.details;
  const detailsHtml = d
    ? `<div class="card"><h3>Movement ${esc(d.calibre)}</h3>${kv([
        ['Jewels', d.jewels],
        ['Beat rate', d.beats_per_hour && `${d.beats_per_hour.toLocaleString()} bph (${d.beats_per_hour / 7200} Hz)`],
        ['Power reserve', d.power_reserve_hours && `~${d.power_reserve_hours} h`],
        ['Hacking seconds', d.hacking == null ? null : d.hacking ? 'Yes' : 'No'],
        ['Hand winding', d.hand_winding == null ? null : d.hand_winding ? 'Yes' : 'No'],
        ['Functions', d.complications],
      ])}<p class="muted">${esc(d.source)}</p></div>`
    : '';

  const search = b.search;
  $('#result').innerHTML = `
    <div class="card">
      <h3>${esc(name)}</h3>
      <span class="badge ${TYPE_BADGE[r.movement.type] ?? ''}">${esc(r.movement.label)}</span>
      ${kv([
        ['Reference', w.reference],
        ['Movement', w.calibre && `${w.calibre}${w.calibre_source ? ` (${w.calibre_source})` : ''}`],
        ['Codes read', w.caseback_codes],
        ['Display', w.display !== 'unknown' ? w.display : null],
        ['Features', w.features],
        ['Case size', w.case_mm && `≈ ${w.case_mm} mm`],
        ['Why this type', r.movement.evidence],
      ])}
    </div>
    ${r.warnings?.length ? `<ul class="warnings">${r.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${batteryHtml}
    ${detailsHtml}
    ${r.notes ? `<p class="muted">${esc(r.notes)}</p>` : ''}
    <div class="actions">
      ${b.primary ? `<button class="btn" id="r-copy">Copy "${esc(b.primary.code)}"</button>` : ''}
      <button class="btn primary" id="r-confirm">Opened it: save what I found</button>
      <button class="btn" id="r-new">Scan another</button>
    </div>
    <details class="trace"><summary>How I got this</summary><ul>
      ${(r.trace ?? []).map((t) => `<li>${esc(t)}</li>`).join('')}
      ${search ? `<li>Pages checked: ${search.checked.map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.domain)}</a>`).join(', ') || 'none'}</li>` : ''}
    </ul></details>`;

  $('#r-copy') && ($('#r-copy').onclick = () => copy(b.primary.code));
  $('#r-confirm').onclick = () => openConfirm(state.current);
  $('#r-new').onclick = resetScan;
}

function sourceHtml(s) {
  const label = s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.domain)}</a>` : `<strong>${esc(s.kind)}</strong>`;
  return `<li>${label} <span class="badge">${esc(s.kind)}</span>${s.method === 'regex' ? ' <span class="badge">pattern match</span>' : s.method === 'spec' ? ' <span class="badge">spec sheet</span>' : ''}${s.quote ? `<q>${esc(s.quote)}</q>` : ''}</li>`;
}

// ---------- confirm after opening ----------
function openConfirm(current) {
  const r = current.result;
  const f = $('#confirm-form');
  const w = r.watch;
  const values = {
    battery: r.battery?.primary?.code ?? '',
    calibre: w.calibre && !String(w.calibre_source ?? '').startsWith('AI guess') ? w.calibre : '',
    brand: w.brand ?? '',
    model: w.model ?? '',
    reference: w.reference ?? '',
    caseback_code: w.caseback_codes?.find((c) => /-/.test(c)) ?? w.caseback_codes?.[0] ?? '',
    movement_type: ['quartz', 'solar', 'kinetic', 'automatic', 'manual_wind'].includes(r.movement.type) ? r.movement.type : 'quartz',
    case_mm: w.case_mm ?? '',
    owner: current.owner ?? '',
    notes: '',
  };
  for (const [k, v] of Object.entries(values)) f.elements[k].value = v;
  $('#confirm-error').textContent = '';
  $('#confirm-battery-hint').textContent = '';
  const dlg = $('#confirm-dialog');
  dlg.showModal();
  f.elements.battery.focus();

  f.onsubmit = async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    try {
      const out = await api('/api/confirm', { method: 'POST', body: { ...data, lookup_id: r.lookup_id, thumbnail: current.thumbnail } });
      dlg.close();
      const m = out.movement;
      toast(m ? (m.changed ? `Saved. Movement ${m.calibre} changed from ${m.previous} to ${m.battery}.` : `Saved. Movement ${m.calibre} confirmed ${m.confirmations}×.`) : 'Saved to your database.', 3500);
      if (r.lookup_id && state.current?.result === r) resetScan();
      else show('list');
    } catch (err) {
      $('#confirm-error').textContent = err.message;
    }
  };
}

let batteryTimer;
async function batteryHint(input, out) {
  clearTimeout(batteryTimer);
  const q = input.value.trim();
  if (!q) return (out.innerHTML = '');
  batteryTimer = setTimeout(async () => {
    try {
      const { match: m } = await api(`/api/batteries?q=${encodeURIComponent(q)}`);
      out.innerHTML = m
        ? `= <strong>${esc(m.code)}</strong> (${esc(m.names.slice(1).join(', '))}) · ${m.diameter_mm} × ${m.height_mm} mm${m.assumed_suffix ? ' · assumed SW (low drain)' : ''}${m.alkaline_input ? ' · that\'s the alkaline name; buy the silver oxide one for watches' : ''}${m.same_size.length ? ` · same size: ${esc(m.same_size.join(', '))}` : ''}`
        : 'Not a battery name I know.';
    } catch (e) {
      out.textContent = e.message;
    }
  }, 250);
}
$('#confirm-form').elements.battery.oninput = (e) => batteryHint(e.target, $('#confirm-battery-hint'));
$('#battery-q').oninput = (e) => batteryHint(e.target, $('#battery-a'));

// ---------- to-open list ----------
async function loadList() {
  try {
    const [{ items }, { lookups }] = await Promise.all([api('/api/shopping'), api('/api/lookups')]);
    state.shopping = items;
    $('#shopping').innerHTML = items.length
      ? items.map((it) => `<div class="row"><div class="count">${it.count}×</div><div class="main"><div class="title">${esc(it.battery)}${it.details ? ` <span class="sub">${esc(it.details.names.slice(1).join(' · '))}</span>` : ''}</div><div class="sub">${it.watches.map((w) => esc(w.owner || w.summary)).join(', ')}</div></div></div>`).join('')
      : '<p class="empty">Nothing to buy. Scan some watches first.</p>';
    const row = (l) => `
      <div class="row" data-id="${l.id}">
        ${l.thumbnail ? `<img src="${esc(l.thumbnail)}" alt="">` : '<div class="ph"></div>'}
        <div class="main"><div class="title">${esc(l.summary)}</div><div class="sub">${esc(l.owner || 'no owner')} · ${esc(l.created_at.slice(0, 10))}</div></div>
        <div class="btns">
          <button class="icon-btn" data-act="open">View</button>
          ${l.status === 'pending' ? '<button class="icon-btn" data-act="done" title="Done without saving">✓</button>' : ''}
          <button class="icon-btn" data-act="del" title="Delete">🗑</button>
        </div>
      </div>`;
    const pending = lookups.filter((l) => l.status === 'pending');
    $('#pending').innerHTML = pending.length ? pending.map(row).join('') : '<p class="empty">No watches waiting.</p>';
    const done = lookups.filter((l) => l.status !== 'pending');
    $('#done').innerHTML = done.length ? done.map(row).join('') : '<p class="empty">Nothing yet.</p>';
    for (const el of document.querySelectorAll('#pending .row, #done .row')) {
      el.querySelectorAll('button').forEach((b) => (b.onclick = () => lookupAction(Number(el.dataset.id), b.dataset.act)));
    }
  } catch (e) {
    $('#shopping').innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

async function lookupAction(id, act) {
  if (act === 'open') {
    const l = await api(`/api/lookups/${id}`);
    state.current = { result: { ...l.result, lookup_id: id }, thumbnail: l.thumbnail, owner: l.owner };
    renderResult();
    show('result');
    return;
  }
  if (act === 'done') await api(`/api/lookups/${id}`, { method: 'PATCH', body: { status: 'done' } });
  if (act === 'del' && confirm('Delete this lookup?')) await api(`/api/lookups/${id}`, { method: 'DELETE' });
  loadList();
}

$('#copy-shopping').onclick = () => {
  const items = state.shopping ?? [];
  if (!items.length) return toast('List is empty');
  copy(items.map((it) => `${it.count}× ${it.battery}${it.details ? ` (${it.details.names.slice(1).join('/')})` : ''}`).join('\n'));
};

// ---------- database ----------
let dbTimer;
$('#db-q').oninput = () => {
  clearTimeout(dbTimer);
  dbTimer = setTimeout(loadWatches, 250);
};
async function loadWatches() {
  try {
    const q = $('#db-q').value.trim();
    const { watches } = await api(`/api/watches${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    $('#watches').innerHTML = watches.length
      ? watches.map((w) => `
        <div class="row" data-id="${w.id}">
          ${w.thumbnail ? `<img src="${esc(w.thumbnail)}" alt="">` : '<div class="ph"></div>'}
          <div class="main">
            <div class="title">${esc([w.brand, w.model, w.reference].filter(Boolean).join(' ') || 'Watch')} → ${esc(w.battery || '—')}</div>
            <div class="sub">${esc([w.calibre && `Movement ${w.calibre}`, w.caseback_code, w.case_mm && `${w.case_mm} mm`, w.owner, w.notes].filter(Boolean).join(' · '))}</div>
          </div>
          <div class="btns"><button class="icon-btn" data-act="del">🗑</button></div>
        </div>`).join('')
      : `<p class="empty">${q ? 'No matches.' : 'Nothing confirmed yet. After you open a watch, tap "Opened it: save what I found".'}</p>`;
    for (const el of document.querySelectorAll('#watches .row')) {
      el.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm('Delete this confirmed watch? (The movement stays in the database.)')) return;
        await api(`/api/watches/${el.dataset.id}`, { method: 'DELETE' });
        loadWatches();
      };
    }
  } catch (e) {
    $('#watches').innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

// ---------- settings ----------
async function loadSettings() {
  $('#set-passcode').value = store.get('passcode');
  $('#set-ref-name').value = store.get('refName');
  $('#set-ref-mm').value = store.get('refMm');
  $('#set-tilt').value = store.get('tilt');
  try {
    const h = await api('/api/health');
    $('#health').textContent = [
      `Photo reading (Gemini): ${h.ai ? 'ready' : 'NOT SET (GEMINI_API_KEY)'}`,
      `Database: ${h.database ? 'ready' : 'NOT SET (D1)'}`,
      `Web search: ${h.search}`,
      `Passcode: ${h.passcode_required ? 'required' : 'not required (anyone with the link can use it)'}`,
    ].join('\n');
  } catch (e) {
    $('#health').textContent = e.message;
  }
}
$('#save-settings').onclick = () => {
  store.set('passcode', $('#set-passcode').value);
  store.set('refName', $('#set-ref-name').value);
  store.set('refMm', $('#set-ref-mm').value);
  store.set('tilt', $('#set-tilt').value);
  toast('Saved');
  checkHealth();
};

async function checkHealth() {
  try {
    const h = await api('/api/health');
    $('#status-dot').className = `dot ${h.ai && h.database ? 'ok' : 'bad'}`;
    $('#status-dot').title = h.ai && h.database ? 'Server ready' : 'Server not fully configured (see Settings)';
  } catch {
    $('#status-dot').className = 'dot bad';
  }
}
checkHealth();
renderShots();
