// Watch cell cross-reference. The IEC code encodes the size: SR626 = 6.8 mm across, 2.6 mm tall.
// "SW" = low drain (plain analog), "W" = high drain (lights, alarms, chronographs); same physical size.
// Numeric names (377, 371...) are the Renata/Energizer/Maxell retail numbers.
// AG/LR codes are cheap alkaline equivalents of the same size; buy silver oxide (SR) for watches.

const silver = (code, d, h, aliases, extra = {}) => ({ code, chemistry: 'silver oxide', volts: 1.55, d, h, aliases, ...extra });
const lithium = (code, d, h) => ({ code, chemistry: 'lithium', volts: 3, d, h, aliases: [] });

export const BATTERIES = [
  silver('SR416SW', 4.8, 1.65, ['337'], { drain: 'low' }),
  silver('SR512SW', 5.8, 1.25, ['335'], { drain: 'low' }),
  silver('SR516SW', 5.8, 1.65, ['317'], { drain: 'low' }),
  silver('SR521SW', 5.8, 2.15, ['379'], { drain: 'low', alkaline: ['AG0', 'LR521'] }),
  silver('SR527SW', 5.8, 2.7, ['319'], { drain: 'low' }),
  silver('SR616SW', 6.8, 1.65, ['321'], { drain: 'low' }),
  silver('SR621SW', 6.8, 2.1, ['364', 'SR60'], { drain: 'low', alkaline: ['AG1', 'LR621'] }),
  silver('SR621W', 6.8, 2.1, ['363'], { drain: 'high' }),
  silver('SR626SW', 6.8, 2.6, ['377', 'SR66'], { drain: 'low', alkaline: ['AG4', 'LR626'] }),
  silver('SR626W', 6.8, 2.6, ['376'], { drain: 'high' }),
  silver('SR712SW', 7.9, 1.25, ['346'], { drain: 'low' }),
  silver('SR716SW', 7.9, 1.65, ['315'], { drain: 'low' }),
  silver('SR721SW', 7.9, 2.1, ['362', 'SR58'], { drain: 'low' }),
  silver('SR721W', 7.9, 2.1, ['361'], { drain: 'high' }),
  silver('SR726SW', 7.9, 2.6, ['397', 'SR59'], { drain: 'low', alkaline: ['AG2', 'LR726'] }),
  silver('SR726W', 7.9, 2.6, ['396'], { drain: 'high' }),
  silver('SR731SW', 7.9, 3.1, ['329'], { drain: 'low' }),
  silver('SR41SW', 7.9, 3.6, ['384'], { drain: 'low' }),
  silver('SR41W', 7.9, 3.6, ['392'], { drain: 'high', alkaline: ['AG3', 'LR41'] }),
  silver('SR754W', 7.9, 5.4, ['393', 'SR48'], { drain: 'high', alkaline: ['AG5', 'LR754'] }),
  silver('SR916SW', 9.5, 1.6, ['373', 'SR68'], { drain: 'low' }),
  silver('SR920SW', 9.5, 2.05, ['371', 'SR69'], { drain: 'low', alkaline: ['AG6', 'LR921', 'LR920'] }),
  silver('SR920W', 9.5, 2.05, ['370'], { drain: 'high' }),
  silver('SR927SW', 9.5, 2.7, ['395', 'SR57'], { drain: 'low', alkaline: ['AG7', 'LR927'] }),
  silver('SR927W', 9.5, 2.7, ['399'], { drain: 'high' }),
  silver('SR936SW', 9.5, 3.6, ['394', 'SR45'], { drain: 'low', alkaline: ['AG9', 'LR936'] }),
  silver('SR936W', 9.5, 3.6, ['380'], { drain: 'high' }),
  silver('SR1120SW', 11.6, 2.05, ['381', 'SR55'], { drain: 'low' }),
  silver('SR1120W', 11.6, 2.05, ['391'], { drain: 'high', alkaline: ['AG8', 'LR1120'] }),
  silver('SR1130SW', 11.6, 3.05, ['390', 'SR54'], { drain: 'low' }),
  silver('SR1130W', 11.6, 3.05, ['389'], { drain: 'high', alkaline: ['AG10', 'LR1130'] }),
  silver('SR43SW', 11.6, 4.2, ['301'], { drain: 'low' }),
  silver('SR43W', 11.6, 4.2, ['386'], { drain: 'high', alkaline: ['AG12', 'LR43'] }),
  silver('SR44SW', 11.6, 5.4, ['303'], { drain: 'low' }),
  silver('SR44W', 11.6, 5.4, ['357'], { drain: 'high', alkaline: ['AG13', 'LR44'] }),
  ...['CR1216', 'CR1220', 'CR1225', 'CR1616', 'CR1620', 'CR1632', 'CR2012', 'CR2016', 'CR2025', 'CR2032', 'CR2430']
    .map((c) => lithium(c, Number(c.slice(2, 4)), Number(c.slice(4)) / 10)),
].map((b) => ({ alkaline: [], drain: null, ...b, size: sizeKey(b.code) }));

// Cells that share a physical size (SR626SW and SR626W) share a size key.
export function sizeKey(code) {
  return code.replace(/S?W$/, '');
}

const INDEX = new Map();
for (const b of BATTERIES) {
  for (const name of [b.code, ...b.aliases, ...b.alkaline]) INDEX.set(compact(name), b);
}

function compact(s) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const BRAND_WORDS = /\b(RENATA|ENERGIZER|MAXELL|SONY|MURATA|VARTA|DURACELL|SEIZAIKEN|SEIKO|PANASONIC|GP|TIANQIU|TOSHIBA|BATTERY|CELL|SILVER OXIDE|LITHIUM|MF|HG|ZERO MERCURY|0% HG)\b/g;

// Turns anything a person or web page might call a watch cell into our canonical entry.
// Returns { battery, assumedSuffix, alkalineInput } or null.
export function normalizeBattery(input) {
  if (!input) return null;
  let s = String(input).toUpperCase().replace(BRAND_WORDS, ' ');
  let key = compact(s);
  if (!key) return null;
  // Varta "V377", Duracell "D377"
  if (/^[VD]3\d\d$/.test(key)) key = key.slice(1);
  let battery = INDEX.get(key);
  let assumedSuffix = false;
  if (!battery && /^SR\d{3,4}$/.test(key)) {
    battery = INDEX.get(key + 'SW') || INDEX.get(key + 'W');
    assumedSuffix = Boolean(battery);
  }
  if (!battery) return null;
  return { battery, assumedSuffix, alkalineInput: battery.alkaline.some((a) => compact(a) === key) };
}

export function getBattery(code) {
  return INDEX.get(compact(code)) || null;
}

export function sameSize(code) {
  const size = sizeKey(code);
  return BATTERIES.filter((b) => b.size === size);
}

// Finds battery names inside free text. Bare numbers (377) only count when the text around them
// is clearly about a battery, otherwise prices and part numbers would be picked up.
const TOKEN = /(?<![A-Z0-9])(?:(SR|CR|LR|AG)\s?-?(\d{1,4})\s?(SW|W)?|([VD]?3\d\d))(?![A-Z0-9])/gi;
const CONTEXT = /(batter|cell|renata|energizer|maxell|sony|murata|varta|seizaiken|\bSR\d|\bAG\d)/i;

export function findBatteryMentions(text) {
  const out = [];
  if (!text) return out;
  for (const m of String(text).matchAll(TOKEN)) {
    const raw = m[0];
    if (m[4]) {
      const around = text.slice(Math.max(0, m.index - 40), m.index + raw.length + 40);
      if (!CONTEXT.test(around.replace(raw, ''))) continue;
    }
    const n = normalizeBattery(raw);
    if (n) out.push({ raw, index: m.index, code: n.battery.code, battery: n.battery });
  }
  return out;
}

export function describeBattery(b) {
  if (!b) return null;
  const pair = BATTERIES.filter((x) => x.size === b.size && x.code !== b.code).map((x) => x.code);
  return {
    code: b.code,
    names: [b.code, ...b.aliases],
    alkaline_equivalents: b.alkaline,
    chemistry: b.chemistry,
    volts: b.volts,
    diameter_mm: b.d,
    height_mm: b.h,
    drain: b.drain,
    same_size: pair,
  };
}
