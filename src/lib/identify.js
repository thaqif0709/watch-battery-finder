// The whole pipeline: photos -> what's written on the watch -> movement -> battery.
// Order of trust: what you confirmed after opening > a battery visible in a photo > web evidence > AI memory.

import { readWatchPhotos, extractBatteryClaims } from './gemini.js';
import { webSearch, fetchPageText, snippetsAround, caliberCornerPages } from './search.js';
import { scoreClaims, verifyClaim, regexClaims, domainOf, trustFor } from './evidence.js';
import { calibreFromCasebackCodes, movementMaker, makerFromBrand, needleRegex, normalizeCalibre, calibreVariants, compact } from './normalize.js';
import { normalizeBattery, describeBattery, getBattery, findBatteryMentions } from '../data/batteries.js';
import { MECHANICAL_MOVEMENTS } from '../data/movements.js';

const MECHANICAL = ['automatic', 'manual_wind'];
const RECHARGEABLE = ['solar', 'kinetic'];

export const TYPE_LABELS = {
  quartz: 'Quartz (battery)',
  automatic: 'Automatic (self-winding, no battery)',
  manual_wind: 'Hand-wound mechanical (no battery)',
  solar: 'Solar (rechargeable cell)',
  kinetic: 'Kinetic / Auto-quartz (rechargeable capacitor)',
  spring_drive: 'Spring Drive (no battery)',
  smartwatch: 'Smartwatch (built-in rechargeable)',
  unknown: 'Not sure yet',
};

export async function identify(input, { env, repo, fetchImpl = fetch }) {
  const trace = [];
  const warnings = [];
  const hints = input.hints ?? {};
  const images = (input.images ?? []).filter((i) => i && i.data);

  // 1. Read the photos (or the typed text, if there are no photos).
  let vision;
  if (images.length) {
    const { model, json } = await readWatchPhotos(env, images, hints.text, fetchImpl);
    vision = json;
    trace.push(`Read ${images.length} photo(s) with ${model}.`);
  } else if (hints.text) {
    vision = parseTypedHint(hints.text);
    trace.push('No photos: used the text you typed.');
  } else {
    throw Object.assign(new Error('Send at least one photo, or type what is written on the watch.'), { status: 400 });
  }
  if (vision.readability && vision.readability !== 'good' && vision.retake_tip) warnings.push(`Photo tip: ${vision.retake_tip}`);

  // 2. Work out the movement (calibre).
  const brand = vision.brand || null;
  const codes = (vision.caseback_codes ?? []).filter(Boolean);
  let calibre = vision.calibre || vision.module_number || null;
  let calibreSource = calibre ? (images.length ? 'printed on the watch' : 'typed by you') : null;
  const derived = calibreFromCasebackCodes(brand, [...codes, vision.module_number].filter(Boolean));
  if (!calibre && derived) {
    calibre = derived.calibre;
    calibreSource = `from caseback code ${derived.from}`;
  }
  if (!calibre && vision.likely_calibre_from_knowledge) {
    calibre = vision.likely_calibre_from_knowledge;
    calibreSource = 'AI guess (not visible on the watch)';
  }
  const maker = movementMaker(calibre, brand);
  if (calibre) trace.push(`Movement ${calibre} (${calibreSource}).`);

  // 3. Movement type: photo clues, then second-hand test, then what we know about the calibre.
  let type = vision.movement_type || 'unknown';
  const typeEvidence = [...(vision.type_evidence ?? [])];
  const tick = hints.tick?.pattern;
  if (tick === 'tick_1s' || tick === 'tick_2s') {
    typeEvidence.push(tick === 'tick_2s' ? 'Second hand jumps every 2 s (low-battery warning on many quartz watches)' : 'Second hand ticks once per second');
    if (!RECHARGEABLE.includes(type)) {
      if (MECHANICAL.includes(type)) warnings.push('The photo suggests mechanical but the second hand ticks like a quartz. Double-check.');
      type = 'quartz';
    }
    if (tick === 'tick_2s') warnings.push('2-second jumps usually mean the battery is nearly flat.');
  } else if (tick === 'sweep') {
    typeEvidence.push('Second hand sweeps smoothly');
    if (type === 'quartz') {
      warnings.push('The photo says quartz but the hand sweeps. Could be a high-frequency quartz (e.g. Bulova Precisionist) or Spring Drive.');
    } else if (type === 'unknown') type = 'automatic';
  } else if (tick === 'stopped') {
    typeEvidence.push('Second hand not moving (typical for a flat battery; an automatic may just need winding)');
  }
  const mech = findMechanical(calibre);
  if (mech && !RECHARGEABLE.includes(type)) {
    type = mech.movement_type;
    typeEvidence.push(`${mech.calibre} is a known ${mech.movement_type} movement`);
  }

  const result = {
    watch: {
      brand,
      model: vision.model_name || null,
      reference: vision.reference_number || null,
      caseback_codes: codes,
      calibre,
      calibre_source: calibreSource,
      maker,
      display: vision.display || 'unknown',
      features: vision.features ?? [],
      case_shape: vision.case_shape || null,
      case_mm: num(hints.case_mm),
    },
    movement: { type, label: TYPE_LABELS[type] ?? type, evidence: typeEvidence, details: null },
    battery: null,
    warnings,
    notes: vision.notes || null,
    trace,
  };

  // 4. Mechanical: no battery, show movement details instead.
  if (MECHANICAL.includes(type) || type === 'spring_drive') {
    result.battery = { status: 'not_applicable', message: 'No battery: this watch is powered by a mainspring.' };
    if (mech) result.movement.details = { ...pickSpecs(mech), source: 'Built-in reference table (general specs, verify for your exact variant)' };
    return result;
  }
  if (type === 'smartwatch') {
    result.battery = { status: 'not_applicable', message: 'Smartwatches have a built-in rechargeable battery; replacement is a repair, not a coin cell.' };
    return result;
  }
  if (RECHARGEABLE.includes(type)) {
    result.battery = {
      status: 'rechargeable',
      message:
        type === 'solar'
          ? 'Solar watch: it has a rechargeable cell, not a normal battery. First try charging it in bright light for a day. Do NOT fit a regular SR cell: the solar panel would try to charge it.'
          : 'Kinetic / auto-quartz: it stores power in a rechargeable capacitor. Wear or shake it to charge; if it no longer holds charge the capacitor needs replacing (specific part, not an SR cell).',
    };
    return result;
  }

  // 5. Quartz (or unknown): find the battery.
  const claims = [];
  if (vision.battery_text) {
    const n = normalizeBattery(vision.battery_text);
    if (n) {
      claims.push({ code: n.battery.code, method: 'photo', quote: `Battery code on the watch/photo or typed: "${vision.battery_text}"` });
      trace.push(`Battery code given directly: ${vision.battery_text}.`);
    }
  }

  const known = repo ? await repo.findWatch({ reference: result.watch.reference, casebackCodes: codes }) : null;
  if (known?.battery) {
    trace.push(`Matched a watch you confirmed before (#${known.id}).`);
    result.battery = confirmed(known.battery, `You confirmed this watch before (${[known.brand, known.model, known.reference].filter(Boolean).join(' ')}${known.owner ? `, ${known.owner}'s` : ''}).`);
    if (!result.watch.calibre && known.calibre) result.watch.calibre = known.calibre;
    return result;
  }
  const movementRow = repo && calibre ? await repo.findMovement(maker, calibre) : null;
  if (movementRow) {
    trace.push(`Movement ${movementRow.calibre} is in your database (${movementRow.confirmations}× confirmed).`);
    result.battery = confirmed(movementRow.battery, `Movement ${movementRow.calibre} confirmed ${movementRow.confirmations}× by you after opening.`);
    if (calibreSource?.startsWith('AI guess')) {
      result.battery.status = 'reference';
      result.battery.message += ' But the movement itself was only guessed by the AI, so check it.';
    }
    return result;
  }

  let web = null;
  try {
    web = await gatherWebEvidence({ env, repo, fetchImpl, brand, maker, calibre, calibreGuessed: calibreSource?.startsWith('AI guess'), reference: result.watch.reference, model: result.watch.model });
    claims.push(...web.claims);
    trace.push(...web.trace);
  } catch (e) {
    trace.push(`Web search failed: ${e.message}`);
  }
  if (vision.battery_from_knowledge) {
    const n = normalizeBattery(vision.battery_from_knowledge);
    if (n) claims.push({ code: n.battery.code, method: 'ai_memory', quote: 'What the AI remembers (not checked against any source)' });
  }

  const scored = scoreClaims(claims);
  const top = scored.candidates[0];
  if (!top) {
    result.battery = { status: 'unknown', message: 'Unknown: no reliable source found. Open it, and save what you find so next time is instant.', search: web?.summary ?? null };
    return result;
  }
  const fromPhoto = top.sources.some((s) => s.method === 'photo');
  const onlyMemory = top.sources.every((s) => s.method === 'ai_memory');
  result.battery = {
    status: fromPhoto ? 'seen' : onlyMemory ? 'guess' : 'suggested',
    confidence: fromPhoto ? 'high' : onlyMemory ? 'low' : scored.confidence,
    primary: top.battery,
    sources: top.sources,
    alternatives: scored.candidates.slice(1, 4),
    message: fromPhoto
      ? 'Battery code read straight off a photo.'
      : onlyMemory
        ? 'Only the AI\'s memory suggests this; no web source confirmed it. Consider opening it.'
        : `${sourceCount(top.sources)} ${{ high: 'Trustworthy sources agree.', medium: 'Worth a quick check when you open it.', low: 'Weak or conflicting evidence. Consider opening it.' }[scored.confidence]}`,
    search: web?.summary ?? null,
  };
  if (type === 'unknown' && !onlyMemory && result.battery.confidence !== 'low') {
    result.movement.type = 'quartz';
    result.movement.label = TYPE_LABELS.quartz;
    result.movement.evidence.push('A battery is documented for this movement');
  }
  if (result.battery.primary?.drain === 'low' && result.watch.features.some((f) => /light|alarm|chrono/i.test(f))) {
    warnings.push(`This watch has ${result.watch.features.join(', ')}. If the old cell says "W" (high drain), use ${result.battery.primary.same_size.join('/') || 'the W version'}, or a multi-drain cell.`);
  }
  return result;
}

function sourceCount(sources) {
  const n = sources.filter((s) => s.url).length;
  return n === 1 ? '1 source.' : `${n} independent sources.`;
}

function confirmed(code, message) {
  const b = getBattery(code);
  return { status: 'confirmed', confidence: 'high', primary: b ? describeBattery(b) : { code, names: [code] }, sources: [], alternatives: [], message };
}

export async function gatherWebEvidence({ env, repo, fetchImpl, brand, maker, calibre, calibreGuessed, reference, model }) {
  const trace = [];
  const queries = [];
  const needles = [];
  const makerLabel = { miyota: 'Miyota', ronda: 'Ronda', eta: 'ETA', isa: 'ISA', sellita: 'Sellita', seiko: 'Seiko', citizen: 'Citizen', casio: 'Casio module' }[maker] ?? brand ?? '';
  if (calibre) {
    queries.push(`${makerLabel} ${calibre} movement battery`.trim());
    needles.push(needleRegex(calibre));
  }
  if (reference && compact(reference).length >= 4) {
    queries.push(`${brand ?? ''} ${reference} watch battery`.trim());
    needles.push(needleRegex(reference));
  } else if (!calibre && model && brand) {
    queries.push(`${brand} ${model} watch battery size`);
    needles.push(needleRegex(model));
  }
  const usable = needles.filter(Boolean);
  if (!queries.length || !usable.length) {
    return { claims: [], trace: ['Not enough text on the watch to search the web.'], summary: null };
  }

  const cacheKey = `v1:${queries.join(' || ').toLowerCase()}`;
  const cached = repo ? await repo.cacheGet(cacheKey) : null;
  if (cached) return { ...cached, trace: [`Web evidence from cache (${queries.join('; ')}).`] };

  const seen = new Set();
  const results = [];
  let provider = null;
  let searchFailed = false;
  if (calibre) {
    try {
      const direct = await caliberCornerPages(calibre, fetchImpl);
      for (const item of direct) {
        seen.add(item.url);
        results.push(item);
      }
      trace.push(`Caliber Corner movement database: ${direct.length ? direct.map((d) => d.url).join(', ') : 'no page for this calibre'}.`);
    } catch (e) {
      trace.push(`Caliber Corner lookup failed: ${e.message}`);
    }
  }
  for (const q of queries.slice(0, 2)) {
    try {
      const r = await webSearch(env, q, fetchImpl);
      provider = r.provider;
      for (const item of r.results) {
        const key = item.url.replace(/[#?].*$/, '');
        if (!seen.has(key)) {
          seen.add(key);
          results.push(item);
        }
      }
      trace.push(`Searched "${q}" via ${r.provider}: ${r.results.length} results.`);
    } catch (e) {
      searchFailed = true;
      trace.push(`Search "${q}" failed: ${e.message}`);
    }
  }

  const top = results.slice(0, 8);
  const pages = await Promise.all(top.map((r) => fetchPageText(r.url, fetchImpl)));
  const sources = [];
  top.forEach((r, i) => {
    const page = pages[i] ?? '';
    // A page about this movement: keep its spec section too, not just windows around the name.
    const about = usable.some((re) => new RegExp(re.source, 'i').test(`${r.title} ${r.url.replace(/[-_/]/g, ' ')}`));
    const spec = about ? snippetsAround(page, [/battery/gi], 120, 1200) : '';
    const text = [snippetsAround(page, usable), spec].filter(Boolean).join(' … ') || snippetsAround(`${r.title} — ${r.snippet}`, usable, 400);
    if (text) sources.push({ id: `S${sources.length + 1}`, url: r.url, title: r.title, domain: domainOf(r.url), text, about });
  });
  trace.push(`${sources.length} of ${top.length} pages mention ${calibre ?? reference ?? model}.`);

  const claims = [];
  let aiOk = false;
  if (sources.length && env.GEMINI_API_KEY) {
    try {
      const subject = [brand, model, reference, calibre && `movement ${calibre}`].filter(Boolean).join(' / ');
      const { json } = await extractBatteryClaims(env, subject, sources, fetchImpl);
      aiOk = true;
      let rejected = 0;
      for (const c of json.claims ?? []) {
        const src = sources.find((s) => s.id === c.source);
        // On a page about this movement a spec line ("Battery: SR626SW") needn't repeat the movement name.
        const b = src && verifyClaim(c, src.text, src.about ? [] : usable);
        if (b) claims.push({ code: b.code, url: src.url, title: src.title, quote: c.quote, method: 'ai_quote' });
        else rejected++;
      }
      trace.push(`AI read the pages: ${claims.length} verified claim(s)${rejected ? `, ${rejected} rejected (quote not found on the page)` : ''}.`);
    } catch (e) {
      trace.push(`AI page reading failed (${e.message}); falling back to pattern matching.`);
    }
  }
  if (!aiOk) {
    for (const s of sources) {
      for (const r of regexClaims(s.text, usable, 120, s.about)) claims.push({ code: r.battery.code, url: s.url, title: s.title, quote: r.quote, method: r.kind === 'spec' ? 'spec' : 'regex' });
    }
    trace.push(`Pattern matching found ${claims.length} mention(s).`);
  }
  if (calibreGuessed) trace.push('Note: the movement was guessed by the AI, so this evidence is about the guessed movement.');

  const summary = {
    provider,
    queries,
    checked: sources.map((s) => ({ domain: s.domain, url: s.url, title: s.title, trust: trustFor(s.domain).kind })),
  };
  const out = { claims, summary, trace };
  // Don't remember half-failed searches; next time the search may get through.
  if (repo && results.length && !searchFailed) await repo.cachePut(cacheKey, { claims, summary });
  return out;
}

function findMechanical(calibre) {
  if (!calibre) return null;
  const variants = calibreVariants(calibre);
  return MECHANICAL_MOVEMENTS.find((m) => [m.calibre, ...m.aliases].some((a) => variants.includes(normalizeCalibre(a)))) ?? null;
}

function pickSpecs(m) {
  return {
    calibre: m.calibre,
    maker: m.maker,
    jewels: m.jewels ?? null,
    beats_per_hour: m.bph ?? null,
    power_reserve_hours: m.power_reserve_h ?? null,
    hacking: m.hacking ?? null,
    hand_winding: m.hand_winding ?? null,
    complications: m.complications ?? null,
  };
}

// Typed text like "Seiko 7N43-0AA0" or "Casio module 3229" or "Miyota 2035".
export function parseTypedHint(text) {
  const t = String(text).trim();
  const words = t.split(/\s+/);
  const brand = words.find((w) => makerFromBrand(w)) ?? (/^[A-Za-z][A-Za-z-]+$/.test(words[0]) && words.length > 1 ? words[0] : null);
  const codes = words.filter((w) => /\d/.test(w) && compact(w).length >= 3);
  const explicit = t.match(/(?:cal(?:ibre|iber)?\.?|movement|module|miyota|ronda|eta|isa|sellita)\s*([A-Z0-9][A-Z0-9.\-]{2,})/i);
  const battery = findBatteryMentions(t)[0];
  const calibre = explicit ? explicit[1] : null;
  return {
    brand,
    caseback_codes: codes,
    calibre,
    reference_number: codes.find((c) => !calibre || !compact(c).includes(compact(calibre))) ?? null,
    movement_type: 'unknown',
    type_evidence: [],
    display: 'unknown',
    battery_text: battery ? battery.raw : null,
    readability: 'good',
  };
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

export function summarize(result) {
  const w = result.watch;
  const name = [w.brand, w.model || w.reference].filter(Boolean).join(' ') || 'Unknown watch';
  const b = result.battery;
  const bat = b?.primary ? `${b.primary.code}${b.status === 'confirmed' || b.status === 'seen' ? '' : '?'}` : b?.status === 'unknown' ? 'battery unknown' : TYPE_LABELS[result.movement.type];
  return `${name}${w.calibre ? ` · ${w.calibre}` : ''} · ${bat}`;
}
