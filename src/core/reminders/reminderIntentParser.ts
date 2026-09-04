// ============================================================
// Reminder Intent Parser — Recordatorios y compras (B9/B10)
// ------------------------------------------------------------
// Parser determinista de intenciones es/en:
//   - 'recuérdame [a {persona}] {texto} {cuándo}'
//   - 'remind me to {text} {when}'
//   - 'agrega {ítem} a la lista de compras'
//   - 'tacha {ítem} de la lista' / 'quita {ítem} de la lista'
//   - 'qué pendientes tengo' / 'muéstrame la lista de compras'
// Regla #1: sin hardcode; `now` y `defaultOffsetMs` inyectables.
// Regla de oro: motor determinista (no toca Gemini ni el DOM).
// ============================================================

import { parseDateTime } from './dateParser';
import { describeNlDateTime, parseNlDateTime } from './nlDateParser';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export type ReminderIntentAction =
  | 'reminder.add'
  | 'reminder.list'
  | 'shopping.add'
  | 'shopping.toggle'
  | 'shopping.remove'
  | 'shopping.list';

export interface ReminderIntentData {
  /** Texto del recordatorio (reminder.add). */
  text?: string;
  /** Vencimiento en ms desde epoch (reminder.add). */
  dueAt?: number;
  /** Persona a la que va dirigido (reminder.add, opcional). */
  personName?: string;
  /** Etiqueta del ítem (shopping.add/toggle/remove). */
  label?: string;
}

export interface ReminderIntent {
  /** true si el input fue reconocido como comando de recordatorios/compras. */
  handled: boolean;
  /** Acción a ejecutar; null cuando hace falta aclaración. */
  action: ReminderIntentAction | null;
  /** Mensaje determinista para confirmar o pedir aclaración. */
  reply: string;
  data?: ReminderIntentData;
}

export interface ReminderIntentParserOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Si no se indica cuándo, programa con este desfase (ms). */
  defaultOffsetMs?: number;
}

// ------------------------------------------------------------
// Constantes declarativas — Regla #1 (sin hardcode disperso)
// ------------------------------------------------------------

const REMINDER_TRIGGERS_ES =
  /^(?:recuérdame|recuerdame|recordame|recuerdale|recuérdale|recuerda|recuerdá|acordate|acuerdate|no\s+olvides)\b\s*(?:de\s+)?(?:que\s+)?/i;
const REMINDER_TRIGGERS_EN =
  /^(?:remind\s+me|remind|don'?t\s+forget)\b\s*(?:to\s+)?/i;

/** Persona con preposición: 'a María', 'le Juan', 'para Laura'. */
const PERSON_PREFIX = /^(?:a|le|para|que|that)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\b/;
/** Persona directa (inglés): 'remind Mary ...'. */
const PERSON_DIRECT = /^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\b/;

/** Palabras que nunca son nombres propios. */
const PERSON_STOP_WORDS: ReadonlyArray<string> = Object.freeze([
  'me', 'i', 'you', 'he', 'she', 'it', 'the', 'a', 'an', 'to',
  'que', 'de', 'la', 'el', 'lo', 'las', 'los', 'al', 'del', 'por', 'para',
]);

/** Marcadores de inicio de una cláusula 'cuándo' (se busca el más temprano). */
const WHEN_MARKERS: ReadonlyArray<{ pattern: RegExp; label: string }> =
  Object.freeze([
    { pattern: /pasado\s+mañana|pasado\s+manana|day\s+after\s+tomorrow/i, label: 'day-after' },
    { pattern: /\b(mañana|manana|tomorrow)\b/i, label: 'tomorrow' },
    { pattern: /\b(hoy|today)\b/i, label: 'today' },
    { pattern: /\ben\s+\d+\s+(minuto|minutos|min|hora|horas|hrs?|dia|dias|semana|semanas)\b/i, label: 'offset' },
    { pattern: /\b(?:el\s+)?proximo\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/i, label: 'weekday' },
    { pattern: /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, label: 'weekday' },
    { pattern: /\bel\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/i, label: 'weekday' },
    { pattern: /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/i, label: 'weekday' },
    { pattern: /\b(?:el\s+)?\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i, label: 'absolute' },
    { pattern: /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?\b/i, label: 'absolute' },
    { pattern: /\b(esta\s+mañana|esta\s+manana|esta\s+tarde|esta\s+noche|this\s+morning|this\s+afternoon|tonight)\b/i, label: 'part-of-day' },
    { pattern: /\b(?:a|para)\s+las?\s+\d{1,2}(?:\s*[.:]\s*\d{2})?\b|\bat\s+\d{1,2}\b/i, label: 'time' },
    { pattern: /\b\d{1,2}[.:]\d{2}\b/, label: 'time' },
    { pattern: /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?\b/, label: 'iso' },
    { pattern: /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}(?:[ T]\d{1,2}:\d{2})?\b/, label: 'dmy' },
  ]);

const SHOPPING_ADD_ES =
  /^(?:agrega|añade|anade|anota|pon|pone|apunta)\s+(.+?)\s+(?:a\s+)?(?:la\s+lista\s+de\s+compras|el\s+listado\s+de\s+compras|la\s+lista|a\s+las\s+compras)\s*$/i;
const SHOPPING_ADD_EN =
  /^(?:add|put)\s+(.+?)\s+(?:to\s+)?(?:the\s+)?(?:shopping\s+)?(?:grocery\s+)?list\s*$/i;
const SHOPPING_TOGGLE_ES =
  /^(?:tacha|marca|cruza|chequea)\s+(.+?)\s+(?:como\s+comprad[oa]\s+)?(?:de\s+)?(?:la\s+)?(?:lista\s+de\s+compras|lista)\s*$/i;
const SHOPPING_TOGGLE_EN =
  /^(?:check|mark|tick)\s+(?:off\s+)?(.+?)\s+(?:off\s+)?(?:from\s+)?(?:the\s+)?(?:shopping\s+)?list\s*$/i;
const SHOPPING_REMOVE_ES =
  /^(?:quita|quitemos|borra|elimina)\s+(.+?)\s+(?:de\s+)?(?:la\s+)?(?:lista\s+de\s+compras|lista)\s*$/i;
const SHOPPING_REMOVE_EN =
  /^(?:remove|delete)\s+(.+?)\s+(?:from\s+)?(?:the\s+)?(?:shopping\s+)?list\s*$/i;
const SHOPPING_LIST_ES =
  /^(?:muestra|muéstrame|muestrame|mostrar|ver|abre|abrir|dime|enseñame|ensename)\s+(?:la\s+)?(?:lista\s+de\s+compras|lista|compras)\s*$|^lista\s+de\s+compras\s*$/i;
const SHOPPING_LIST_EN =
  /^(?:show|open|display)\s+(?:me\s+)?(?:the\s+)?(?:shopping\s+)?list\s*$|^(?:shopping\s+)?list\s*$/i;
const REMINDER_LIST_ES =
  /^(?:qué|que)\s+(?:tengo|hay)\s+(?:pendiente|pendientes|recordatorios)\b|^(?:dime|muestra|muéstrame|muestrame)\s+(?:mis\s+)?(?:pendientes|recordatorios)\b/i;
const REMINDER_LIST_EN =
  /^what(?:'s| is)?\s+(?:pending|my\s+reminders)\b|^show\s+(?:me\s+)?(?:my\s+)?(?:pending|reminders)\b/i;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/** Separa el texto del recordatorio de su cláusula 'cuándo'. */
function splitWhen(remainder: string): { textPart: string; whenClause: string | null } {
  let earliest = -1;
  for (const marker of WHEN_MARKERS) {
    const m = marker.pattern.exec(remainder);
    if (m && (earliest === -1 || m.index < earliest)) {
      earliest = m.index;
    }
  }
  if (earliest === -1) return { textPart: remainder.trim(), whenClause: null };
  return {
    textPart: remainder.slice(0, earliest).trim(),
    whenClause: remainder.slice(earliest).trim(),
  };
}

/** Resuelve la cláusula 'cuándo' a timestamp usando los parsers de fecha. */
function resolveWhen(whenClause: string, now: number): { dueAt: number; label: string } | null {
  const nl = parseNlDateTime(whenClause, { now: () => now });
  if (nl) return { dueAt: nl.at, label: describeNlDateTime(nl.at) };
  const explicit = parseDateTime(whenClause, { now: () => now });
  if (explicit) return { dueAt: explicit.at, label: describeNlDateTime(explicit.at) };
  return null;
}

// ------------------------------------------------------------
// Respuestas deterministas (es/en)
// ------------------------------------------------------------

function shoppingAddReply(label: string, lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `Listo, agregué "${label}" a la lista de compras.`
    : `Done, I added "${label}" to the shopping list.`;
}

function shoppingToggleReply(label: string, lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `Listo, marqué "${label}" en la lista de compras.`
    : `Done, I marked "${label}" on the shopping list.`;
}

function shoppingRemoveReply(label: string, lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `Listo, quité "${label}" de la lista de compras.`
    : `Done, I removed "${label}" from the shopping list.`;
}

function shoppingListReply(lang: 'es' | 'en'): string {
  return lang === 'es'
    ? 'Aquí tienes tu lista de compras.'
    : 'Here is your shopping list.';
}

function reminderListReply(lang: 'es' | 'en'): string {
  return lang === 'es'
    ? 'Aquí tienes tus recordatorios pendientes.'
    : 'Here are your pending reminders.';
}

function askTextReply(lang: 'es' | 'en'): string {
  return lang === 'es'
    ? '¿Qué quieres que te recuerde?'
    : 'What would you like me to remind you about?';
}

// ------------------------------------------------------------
// Parser principal
// ------------------------------------------------------------

/**
 * Interpreta un texto de voz/texto como comando de recordatorios o compras.
 * Devuelve `handled: false` si no reconoce ninguna intención.
 */
export function parseReminderIntent(
  input: string,
  options: ReminderIntentParserOptions = {},
): ReminderIntent {
  if (typeof input !== 'string') return { handled: false, action: null, reply: '' };
  const text = input.trim();
  if (!text) return { handled: false, action: null, reply: '' };

  const now = options.now ? options.now() : Date.now();

  // --- Lista de compras -----------------------------------------
  const shoppingAdd = SHOPPING_ADD_ES.exec(text) || SHOPPING_ADD_EN.exec(text);
  if (shoppingAdd) {
    const label = shoppingAdd[1].trim();
    const lang = SHOPPING_ADD_ES.test(text) ? 'es' : 'en';
    return { handled: true, action: 'shopping.add', reply: shoppingAddReply(label, lang), data: { label } };
  }

  const shoppingToggle = SHOPPING_TOGGLE_ES.exec(text) || SHOPPING_TOGGLE_EN.exec(text);
  if (shoppingToggle) {
    const label = shoppingToggle[1].trim();
    const lang = SHOPPING_TOGGLE_ES.test(text) ? 'es' : 'en';
    return { handled: true, action: 'shopping.toggle', reply: shoppingToggleReply(label, lang), data: { label } };
  }

  const shoppingRemove = SHOPPING_REMOVE_ES.exec(text) || SHOPPING_REMOVE_EN.exec(text);
  if (shoppingRemove) {
    const label = shoppingRemove[1].trim();
    const lang = SHOPPING_REMOVE_ES.test(text) ? 'es' : 'en';
    return { handled: true, action: 'shopping.remove', reply: shoppingRemoveReply(label, lang), data: { label } };
  }

  const shoppingList = SHOPPING_LIST_ES.test(text) || SHOPPING_LIST_EN.test(text);
  if (shoppingList) {
    const lang = SHOPPING_LIST_ES.test(text) ? 'es' : 'en';
    return { handled: true, action: 'shopping.list', reply: shoppingListReply(lang) };
  }

  // --- Recordatorios --------------------------------------------
  const reminderList = REMINDER_LIST_ES.test(text) || REMINDER_LIST_EN.test(text);
  if (reminderList) {
    const lang = REMINDER_LIST_ES.test(text) ? 'es' : 'en';
    return { handled: true, action: 'reminder.list', reply: reminderListReply(lang) };
  }

  const triggerEs = REMINDER_TRIGGERS_ES.exec(text);
  const triggerEn = REMINDER_TRIGGERS_EN.exec(text);
  const trigger = triggerEs || triggerEn;
  if (trigger) {
    const lang = triggerEs ? 'es' : 'en';
    let rest = text.slice(trigger[0].length).trim();

    // Persona (opcional): 'a María', 'remind Mary ...'.
    let person: string | undefined;
    const prefixed = PERSON_PREFIX.exec(rest);
    if (prefixed && !PERSON_STOP_WORDS.includes(prefixed[1].toLowerCase())) {
      person = prefixed[1];
      rest = rest.slice(prefixed[0].length).trim();
    } else {
      const direct = PERSON_DIRECT.exec(rest);
      if (direct && !PERSON_STOP_WORDS.includes(direct[1].toLowerCase())) {
        person = direct[1];
        rest = rest.slice(direct[0].length).trim();
      }
    }

    // Cláusula 'cuándo' (opcional).
    const { textPart, whenClause } = splitWhen(rest);
    if (!textPart) {
      return { handled: true, action: null, reply: askTextReply(lang) };
    }

    let dueAt: number | undefined;
    let whenLabel: string | undefined;
    if (whenClause) {
      const resolved = resolveWhen(whenClause, now);
      if (resolved) {
        dueAt = resolved.dueAt;
        whenLabel = resolved.label;
      }
    }
    if (dueAt === undefined && options.defaultOffsetMs !== undefined) {
      dueAt = now + options.defaultOffsetMs;
    }

    const data: ReminderIntentData = { text: textPart };
    if (dueAt !== undefined) data.dueAt = dueAt;
    if (person) data.personName = person;

    const whenPhrase = whenLabel
      ? lang === 'es'
        ? `, ${whenLabel}`
        : `, at ${whenLabel}`
      : '';
    const reply =
      lang === 'es'
        ? `Listo, te lo recuerdo${person ? ` y se lo haré saber a ${person}` : ''}: "${textPart}"${whenPhrase}.`
        : `Okay, I will remind you${person ? ` and let ${person} know` : ''}: "${textPart}"${whenPhrase}.`;

    return { handled: true, action: 'reminder.add', reply, data };
  }

  return { handled: false, action: null, reply: '' };
}
