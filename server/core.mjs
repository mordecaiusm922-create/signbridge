// Pure, dependency-free logic: text normalization, strict confirmation and
// rule-based intent parsing. Everything here is unit-tested.

export function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

const AFFIRM = new Set(['yes', 'confirm', 'confirmed', 'approve', 'do it', 'go ahead', 'yes confirm', 'yes do it', 'yes go ahead', 'yes please']);
const NEGATION = /\b(no|not|don't|dont|never|cancel|stop|wait|but|maybe|later|wrong|undo)\b/;

// Returns 'confirm' only for an unambiguous, complete affirmative.
// Anything containing a negation or hesitation cancels; everything else is unclear.
// ASL glosses (YES, CONFIRM) arrive upper-case and are handled the same way.
export function parseConfirmation(input) {
  const text = normalizeText(input).toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'unclear';
  if (NEGATION.test(text)) return 'cancel';
  return AFFIRM.has(text) ? 'confirm' : 'unclear';
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow', 'tonight'];

function findNumber(words) {
  for (const w of words) {
    if (/^\d+$/.test(w)) return Number(w);
    if (NUMBER_WORDS[w]) return NUMBER_WORDS[w];
  }
  return null;
}

// Rule-based intent parser over English text or ASL gloss strings.
// Actions with real-world consequences always require confirmation.
export function deriveIntent(input) {
  const text = normalizeText(input);
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z0-9']+/).filter(Boolean);
  const has = (...keys) => keys.some((k) => words.includes(k));
  const day = DAYS.find((d) => words.includes(d)) ?? null;
  const time = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)?.[0] ?? null;

  let kind = 'conversation';
  let slots = {};
  if (has('reserve', 'reservation', 'book', 'table', 'restaurant')) {
    kind = 'reservation';
    slots = { partySize: findNumber(words), day, time };
  } else if (has('buy', 'order', 'purchase')) {
    kind = 'purchase';
    slots = { item: words.slice(words.findIndex((w) => ['buy', 'order', 'purchase'].includes(w)) + 1).join(' ') || null };
  } else if (has('call', 'text', 'message', 'send')) {
    kind = 'message';
    slots = { recipient: words.find((w, i) => ['call', 'text', 'message'].includes(words[i - 1])) ?? null };
  } else if (has('remind', 'reminder', 'alarm')) {
    kind = 'reminder';
    slots = { day, time };
  } else if (has('lights', 'light', 'lock', 'door', 'thermostat')) {
    kind = 'smart_home';
    slots = { device: words.find((w) => ['lights', 'light', 'lock', 'door', 'thermostat'].includes(w)) };
  }
  return {
    kind,
    text,
    slots,
    requiresConfirmation: kind !== 'conversation',
    parser: 'rules'
  };
}

export function describeAction(intent) {
  const s = intent.slots ?? {};
  switch (intent.kind) {
    case 'reservation':
      return `Reserve a table${s.partySize ? ` for ${s.partySize}` : ''}${s.day ? ` on ${s.day}` : ''}${s.time ? ` at ${s.time}` : ''}`;
    case 'purchase': return `Buy ${s.item ?? 'the requested item'}`;
    case 'message': return `Contact ${s.recipient ?? 'the requested person'}`;
    case 'reminder': return `Set a reminder${s.day ? ` for ${s.day}` : ''}${s.time ? ` at ${s.time}` : ''}`;
    case 'smart_home': return `Change the ${s.device ?? 'device'}`;
    default: return intent.text;
  }
}
