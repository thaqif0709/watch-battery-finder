// Turning messy text (dial print, caseback engravings, web pages) into lookup keys.

export function compact(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const MAKER_WORDS = /\b(ETA|RONDA|MIYOTA|SEIKO|TMI|HATTORI|EPSON|SII|CITIZEN|ISA|CASIO|SELLITA|ORIENT|VALJOUX|CAL|CALIBRE|CALIBER|MOVEMENT|MOVT|MODULE|MOD|NO|NR)\b\.?/gi;

// "ETA 955.112" -> "955112", "Cal. 7N43" -> "7N43", "Seiko NH35A" -> "NH35A".
export function normalizeCalibre(s) {
  if (!s) return '';
  return compact(String(s).replace(MAKER_WORDS, ' '));
}

// Variants worth trying in the database: "VX42E" also matches "VX42", "NH35A" matches "NH35".
export function calibreVariants(s) {
  const n = normalizeCalibre(s);
  if (!n) return [];
  const out = [n];
  if (n.length >= 4 && /\d[A-Z]$/.test(n)) out.push(n.slice(0, -1));
  return out;
}

const SEIKO_GROUP = ['seiko', 'pulsar', 'lorus', 'alba', 'grand seiko', 'credor', 'king seiko'];
const CITIZEN_GROUP = ['citizen'];
const CASIO_GROUP = ['casio', 'g-shock', 'g shock', 'baby-g', 'edifice', 'pro trek', 'protrek', 'g-steel', 'oceanus'];

export function makerFromBrand(brand) {
  const b = String(brand ?? '').toLowerCase().trim();
  if (!b) return '';
  if (SEIKO_GROUP.some((x) => b.includes(x))) return 'seiko';
  if (CITIZEN_GROUP.some((x) => b.includes(x))) return 'citizen';
  if (CASIO_GROUP.some((x) => b.includes(x))) return 'casio';
  return '';
}

const MAKER_IN_TEXT = [
  [/miyota/i, 'miyota'], [/ronda/i, 'ronda'], [/\beta\b/i, 'eta'], [/valjoux/i, 'eta'], [/\bisa\b/i, 'isa'],
  [/sellita/i, 'sellita'], [/seiko|\btmi\b|hattori|epson/i, 'seiko'], [/citizen/i, 'citizen'], [/casio/i, 'casio'],
];

// Which company made the movement: from the calibre text itself, otherwise from the watch brand.
export function movementMaker(calibreText, brand) {
  for (const text of [calibreText, brand]) {
    for (const [re, maker] of MAKER_IN_TEXT) if (re.test(text ?? '')) return maker;
  }
  return makerFromBrand(brand);
}

// Seiko-group casebacks: "7N43-0AA0" -> movement 7N43. Citizen: "E168-S081234" -> E168.
// Casio: the module number sits in a box, e.g. "3229".
export function calibreFromCasebackCodes(brand, codes) {
  const maker = makerFromBrand(brand);
  for (const raw of codes ?? []) {
    const code = String(raw).toUpperCase().replace(/\s+/g, '');
    if (maker === 'seiko') {
      const m = code.match(/^([0-9A-Z]{4})-[0-9A-Z]{3,4}$/);
      if (m && /\d/.test(m[1])) return { calibre: m[1], from: raw };
    }
    if (maker === 'citizen') {
      const m = code.match(/^([A-Z0-9]{4})-[A-Z0-9]{5,9}$/);
      if (m && /\d/.test(m[1])) return { calibre: m[1], from: raw };
    }
    if (maker === 'casio') {
      const m = code.match(/^(?:MODULE)?(\d{3,4})$/);
      if (m) return { calibre: m[1], from: raw };
    }
  }
  return null;
}

// A regex that finds a calibre/reference in page text, tolerant of "955.112" vs "955112" vs "955 112"
// and of a one-letter suffix ("VX42E" when looking for "VX42").
export function needleRegex(term) {
  const n = compact(term);
  if (n.length < 3) return null;
  const body = n.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\\-]?');
  return new RegExp(`(?<![A-Z0-9])${body}[A-Z]?(?![A-Z0-9])`, 'gi');
}
