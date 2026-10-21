// Minimal Gemini client (generateContent REST API). The AI is only used to *read* things:
// photos (dial, caseback) and web page snippets. It never decides the battery on its own.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODELS = 'gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-2.5-flash';

export class AiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let workingModel = null;

export async function generateJson(env, { system, parts, schema }, fetchImpl = fetch) {
  if (!env.GEMINI_API_KEY) throw new AiError('GEMINI_API_KEY is not set, so photos cannot be read.', 503);
  const models = workingModel ? [workingModel] : String(env.GEMINI_MODEL || DEFAULT_MODELS).split(',').map((m) => m.trim()).filter(Boolean);
  let lastError;
  for (const model of models) {
    const res = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
    });
    if (res.ok) {
      workingModel = model;
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      return { model, json: parseJsonLoose(text) };
    }
    const body = await res.text();
    lastError = new AiError(`Gemini ${model}: HTTP ${res.status} ${body.slice(0, 300)}`, res.status);
    // Model missing / not offered to this key: try the next one. Anything else is a real error.
    if (res.status === 404 || (res.status === 400 && /not (found|supported)|unsupported model|is not available/i.test(body))) continue;
    if (res.status === 429) throw new AiError('Gemini free quota used up for now. Try again in a minute (or tomorrow if the daily limit is hit).', 429);
    throw lastError;
  }
  workingModel = null;
  throw lastError ?? new AiError('No Gemini model configured.', 500);
}

export function parseJsonLoose(text) {
  const t = String(text ?? '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new AiError(`AI returned something that isn't JSON: ${t.slice(0, 200)}`, 502);
  }
}

const S = (type, extra = {}) => ({ type, ...extra });
const str = (description) => S('STRING', { description, nullable: true });
const list = (description) => S('ARRAY', { description, items: S('STRING') });

export const VISION_SCHEMA = S('OBJECT', {
  properties: {
    brand: str('Brand printed on the dial or caseback'),
    model_name: str('Model / collection name if printed or obvious (e.g. "Seiko 5", "G-Shock")'),
    reference_number: str('Model reference number, e.g. SNK809K1, DW-5600E, AW1361-10H, from dial or caseback'),
    caseback_codes: list('Every code-like engraving on the caseback, verbatim (e.g. "7N43-0AA0", "E168-S081234", "3229", serial numbers)'),
    calibre: str('Movement calibre ONLY if it is printed/engraved or directly derivable from a caseback code'),
    module_number: str('Casio module number (the 3-4 digit number in a box on the caseback), if visible'),
    movement_type: S('STRING', { enum: ['quartz', 'automatic', 'manual_wind', 'solar', 'kinetic', 'spring_drive', 'smartwatch', 'unknown'] }),
    type_evidence: list('Short visible clues for the movement type, e.g. "dial says AUTOMATIC", "21 JEWELS on caseback", "exhibition caseback shows rotor", "Eco-Drive on dial", "digital display"'),
    display: S('STRING', { enum: ['analog', 'digital', 'ana-digi', 'unknown'] }),
    features: list('Visible complications/features: date, day-date, chronograph, alarm, light, GMT, tachymeter...'),
    case_shape: S('STRING', { enum: ['round', 'rectangular', 'square', 'tonneau', 'other', 'unknown'] }),
    battery_text: str('A battery code that is literally visible in a photo (on an old battery, a sticker, or engraved), else null'),
    likely_calibre_from_knowledge: str('Your best guess of the calibre from memory if not visible. May be wrong; null if no idea'),
    battery_from_knowledge: str('The battery you believe this watch uses, from memory. May be wrong; null if unsure'),
    readability: S('STRING', { enum: ['good', 'partly_readable', 'unreadable'], description: 'How well caseback/dial text could be read' }),
    retake_tip: str('If the photos were not good enough, one short tip for a better photo'),
    notes: str('Anything else useful, one or two sentences'),
  },
  required: ['brand', 'caseback_codes', 'movement_type', 'type_evidence', 'display', 'readability'],
});

const VISION_SYSTEM = `You are a watchmaker's assistant reading photos of wristwatches.
Read text exactly as printed/engraved; do not invent codes. Caseback engravings are often faint: read carefully and report partial codes rather than guessing missing characters (use "?" for unreadable characters).
Clues for movement type: "AUTOMATIC", "AUTO", "jewels" (17+ jewels usually mechanical, but some quartz say "7 jewels"), exhibition back showing a rotor => automatic. "QUARTZ", digital display, battery hatch => quartz. "Eco-Drive", "Solar", "Tough Solar" => solar (rechargeable cell, not a normal battery). "Kinetic", "Auto Quartz", "AGS" => kinetic (rechargeable capacitor). "Spring Drive" => spring_drive.
Fields marked "from knowledge" are separate guesses: fill them only if reasonably confident and never copy them into the "visible" fields.`;

export async function readWatchPhotos(env, images, hintText, fetchImpl) {
  const parts = [{ text: `Photos of one watch. ${hintText ? `The owner adds: "${hintText}"` : ''}\nExtract the fields.` }];
  for (const img of images) {
    parts.push({ text: `Photo: ${img.label}` });
    parts.push({ inlineData: { mimeType: img.mime || 'image/jpeg', data: img.data } });
  }
  return generateJson(env, { system: VISION_SYSTEM, parts, schema: VISION_SCHEMA }, fetchImpl);
}

export const CLAIMS_SCHEMA = S('OBJECT', {
  properties: {
    claims: S('ARRAY', {
      items: S('OBJECT', {
        properties: {
          source: S('STRING', { description: 'Source id like S1' }),
          battery: S('STRING', { description: 'Battery name as written, e.g. SR626SW or 377' }),
          quote: S('STRING', { description: 'Exact verbatim text from the source that states it (must include the movement/model name and the battery)' }),
        },
        required: ['source', 'battery', 'quote'],
      }),
    }),
  },
  required: ['claims'],
});

const CLAIMS_SYSTEM = `You check web page snippets for which battery (button cell) a specific watch movement or watch model uses.
Only report a claim when the snippet clearly states that THIS movement/model uses that battery. Ignore other movements listed nearby in tables.
The quote must be copied character-for-character from the snippet and must contain both the movement/model name and the battery name.
Exception: sources marked [ABOUT THIS MOVEMENT] are pages dedicated to the subject; there a spec line such as "Battery Cell Number SR626SW / 377" counts and may be quoted alone.
If nothing qualifies, return an empty list.`;

export async function extractBatteryClaims(env, subject, sources, fetchImpl) {
  const body = sources.map((s) => `[${s.id}] ${s.title} (${s.domain})${s.about ? ' [ABOUT THIS MOVEMENT]' : ''}\n${s.text}`).join('\n\n---\n\n');
  return generateJson(env, {
    system: CLAIMS_SYSTEM,
    parts: [{ text: `Subject: ${subject}\n\nSnippets:\n\n${body}` }],
    schema: CLAIMS_SCHEMA,
  }, fetchImpl);
}
