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
  | 'reminder.remove'
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
  /**
   * Dominio ya clasificado por el cerebro conversacional (`accion.dominio`).
   * Cuando es 'reminder', el texto se interpreta como el objeto del
   * recordatorio AUNQUE no traiga el trigger verbal ("recuérdame ..."). Evita
   * que una acción ya clasificada por el LLM se pierda al re-parsear texto que
   * perdió el trigger. El parser sigue siendo la única fuente de estructura.
   */
  assumedDomain?: 'reminder';
  /** Idioma para las respuestas deterministas (por defecto: 'es'). */
  language?: 'es' | 'en';
}

// ------------------------------------------------------------
// Constantes declarativas — Regla #1 (sin hardcode disperso)
// ------------------------------------------------------------

const REMINDER_TRIGGERS_ES =
  /^(?:recuérdame|recuerdame|recordame|recuerdale|recuérdale|recuerda|recuerdá|acordate|acuerdate|no\s+olvides|pon(?:me)?\s+un\s+recordatorio)\b\s*(?:de\s+)?(?:que\s+)?/i;
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

/**
 * Cancelación / negación de recordatorios (voz). Reconoce pedir quitar,
 * cancelar, eliminar o "ya no querer" un recordatorio existente. El texto
 * capturado (grupo 1) se usa para localizar el recordatorio a eliminar.
 * Ejemplos: 'quita el recordatorio de comprar leche', 'cancela el
 * recordatorio de la cita', 'ya no quiero el recordatorio de X',
 * 'no nada más ese recordatorio de X'.
 */
const REMINDER_REMOVE_ES =
  /^(?:quita|quitemos|quitar|cancela|cancelar|elimina|eliminar|borra|borrar|retira|retirar)\s+(?:el\s+|ese\s+|este\s+|mi\s+)?(?:recordatorio|alarma|aviso|pendiente)(?:\s+(?:de\s+)?)?(.*?)\s*$|^(?:ya\s+no\s+quiero|no\s+quiero|no\s+nada\s+más|no\s+nada\s+mas|no\s+más|no\s+mas)\s+(?:el\s+|ese\s+|este\s+|mi\s+)?(?:recordatorio|alarma|aviso|pendiente)(?:\s+(?:de\s+)?)?(.*?)\s*$/i;
const REMINDER_REMOVE_EN =
  /^(?:remove|delete|cancel|clear)\s+(?:the\s+|that\s+|this\s+|my\s+)?(?:reminder|alarm)(?:\s+(?:to\s+|for\s+)?)?(.*?)\s*$|^(?:i\s+don'?t\s+want|no\s+more)\s+(?:the\s+|that\s+|this\s+|my\s+)?(?:reminder|alarm)(?:\s+(?:to\s+|for\s+)?)?(.*?)\s*$/i;

/**
 * Relleno conversacional tolerado (Point G). Los asistentes de voz reales
 * (Alexa/Siri/Google) reciben frases con ruido: interjecciones iniciales
 * ("sí, ", "oye ", "hey") y cortesía final ("por favor", "please"). Este
 * preprocesado normaliza el input en un único punto para que los triggers
 * anclados a `^` no fallen por ese ruido. No toca el contenido semántico.
 */
const LEADING_FILLER_ES =
  /^(?:s[ií]|oye|hey|a\s+ver|mira|bueno|pues|vamos|ok|okay|por\s+favor|porfa|claro)\s*[,:\s]+/i;
const LEADING_FILLER_EN =
  /^(?:ok|okay|hey|so|well|please|right|yeah|yes|sure)\s*[,:\s]+/i;
const TRAILING_FILLER_ES =
  /\s+(?:por\s+favor|porfa|gracias|muchas\s+gracias)\s*$/i;
const TRAILING_FILLER_EN =
  /\s+(?:please|thank\s+you|thanks)\s*$/i;

/**
 * Citas (agenda). No existe un modelo "cita" separado; por la regla de
 * fuente única por intención, una cita se modela como recordatorio
 * (cubre texto + persona + cuándo). Estos triggers reconocen la creación
 * de una cita y la enrutan a `reminder.add`.
 */
const CITA_TRIGGER_ES =
  /^(?:crea|crear|genera|generar|genérame|generame|agenda|agendar|programa|programar|pon|ponme|poner|hazme|hacer|tengo|quiero|quiero\s+(?:crear|agendar|programar|generar))\s+(?:una\s+|un\s+)?(?:cita|junta|reuni[oó]n)\b\s*/i;
const CITA_TRIGGER_EN =
  /^(?:create|schedule|book|set|make|add|i\s+have|i\s+want)\s+(?:an?\s+)?appointment\b\s*/i;
/** Persona de la cita: 'con el doctor', 'con la doctora', 'with the doctor'. */
const CITA_PERSON_ES = /^con\s+(?:el\s+|la\s+|mi\s+|nuestr[oa]\s+)?([A-ZÁÉÍÓÚÑa-záéíóúñ]+)\b/i;
const CITA_PERSON_EN = /^with\s+(?:the\s+|my\s+|our\s+)?([A-Za-z]+)\b/i;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Normaliza el input de voz quitando el relleno conversacional (Point G):
 * interjecciones iniciales y cortesía final. Se aplica en un único punto
 * para que todos los triggers anclados a `^` toleren el ruido real de ASR.
 */
function normalizeInput(raw: string): string {
  let t = raw.trim();
  let prev = '';
  while (t !== prev) {
    prev = t;
    const m = LEADING_FILLER_ES.exec(t) || LEADING_FILLER_EN.exec(t);
    if (m) t = t.slice(m[0].length).trim();
  }
  t = t.replace(TRAILING_FILLER_ES, '').replace(TRAILING_FILLER_EN, '').trim();
  // ASR: gatillo de tiempo duplicado ("a las a las 10") → "a las 10".
  t = t.replace(/\ba\s+las\s+a\s+las\b/gi, 'a las');
  return t;
}

/**
 * Limpia el ASUNTO de una cita quitando toda la cláusula de tiempo (día, hora,
 * franja, conectores y dígitos) para que el contexto sobreviva aunque el
 * usuario lo diga después de la hora ("…cita para mañana a las 12:30 para
 * revisar Data brix" → "revisar Data brix").
 */
const CITA_TIME_NOISE =
  /\b(?:hoy|mañana|manana|pasado\s+mañana|pasado\s+manana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo|today|tomorrow|tonight|morning|afternoon|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|a\s+las?|las?|de\s+la\s+(?:mañana|manana|tarde|noche|madrugada)|p\.?\s*m\.?|a\.?\s*m\.?|horas?|minutos?|hours?|minutes?|para|que|del|de|el|la|los|las|un|una|al|the|at|for|to|of|on|y|and|\d{1,2}(?::\d{2})?)\b/gi;

function cleanCitaSubject(text: string): string {
  return String(text || '')
    .replace(CITA_TIME_NOISE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Conectores que NUNCA son un asunto cuando encabezan una cláusula de tiempo.
 * "ponme un recordatorio para el jueves a las 13:00" creaba una cita titulada
 * "para". El recorte es QUIRÚRGICO: solo se quitan si lo que queda empieza por
 * una cláusula de tiempo ("…que llame" conserva su contenido).
 */
const LEADING_CONNECTORS = /^(?:para|de|del|que|el|la|los|las|un|una|unos|unas|al|a|en|por)\s+/i;

const WHEN_START_MARKERS = WHEN_MARKERS.map(
  (marker) => new RegExp(`^(?:${marker.pattern.source})`, 'i'),
);

function startsWithWhenMarker(text: string): boolean {
  return WHEN_START_MARKERS.some((re) => re.test(text));
}

function stripLeadingConnectors(text: string): string {
  let probe = String(text || '').trim();
  for (let i = 0; i < 4; i += 1) {
    const match = LEADING_CONNECTORS.exec(probe);
    if (!match) break;
    probe = probe.slice(match[0].length).trim();
    if (startsWithWhenMarker(probe)) return probe;
  }
  return String(text || '').trim();
}

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

function reminderRemoveReply(label: string, lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `Listo, quité el recordatorio "${label}".`
    : `Done, I removed the reminder "${label}".`;
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
 * Construye una intención `reminder.add` a partir del TEXTO del recordatorio
 * (ya sin trigger, o con el texto completo cuando el dominio fue asumido).
 * Fuente única de la extracción persona + cuándo + objeto, compartida por la
 * ruta con trigger verbal y la ruta con dominio asumido por el LLM.
 */
function buildReminderFromRest(
  rest: string,
  lang: 'es' | 'en',
  now: number,
  options: ReminderIntentParserOptions,
): ReminderIntent {
  let remaining = rest;

  // Persona (opcional): 'a María', 'remind Mary ...'.
  let person: string | undefined;
  const prefixed = PERSON_PREFIX.exec(remaining);
  if (prefixed && !PERSON_STOP_WORDS.includes(prefixed[1].toLowerCase())) {
    person = prefixed[1];
    remaining = remaining.slice(prefixed[0].length).trim();
  } else {
    const direct = PERSON_DIRECT.exec(remaining);
    if (direct && !PERSON_STOP_WORDS.includes(direct[1].toLowerCase())) {
      person = direct[1];
      remaining = remaining.slice(direct[0].length).trim();
    }
  }

  // Cláusula 'cuándo' (opcional). Los conectores iniciales se recortan para
  // que el asunto nunca quede en una preposición ("para").
  const { textPart, whenClause } = splitWhen(stripLeadingConnectors(remaining));
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

/**
 * Interpreta un texto de voz/texto como comando de recordatorios o compras.
 * Devuelve `handled: false` si no reconoce ninguna intención.
 */
export function parseReminderIntent(
  input: string,
  options: ReminderIntentParserOptions = {},
): ReminderIntent {
  if (typeof input !== 'string') return { handled: false, action: null, reply: '' };
  const text = normalizeInput(input);
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

  // --- Cancelación / negación de recordatorios ------------------
  // 'quita/cancela/elimina el recordatorio de X', 'ya no quiero el
  // recordatorio de X', 'no nada más ese recordatorio de X'.
  const reminderRemoveEs = REMINDER_REMOVE_ES.exec(text);
  const reminderRemoveEn = REMINDER_REMOVE_EN.exec(text);
  const reminderRemove = reminderRemoveEs || reminderRemoveEn;
  if (reminderRemove) {
    const lang = reminderRemoveEs ? 'es' : 'en';
    // El texto a eliminar puede estar en el grupo 1 o 2 según la rama.
    const label = (reminderRemove[1] || reminderRemove[2] || '').trim();
    if (!label) {
      return { handled: true, action: null, reply: askTextReply(lang) };
    }
    return {
      handled: true,
      action: 'reminder.remove',
      reply: reminderRemoveReply(label, lang),
      data: { text: label },
    };
  }

  const triggerEs = REMINDER_TRIGGERS_ES.exec(text);
  const triggerEn = REMINDER_TRIGGERS_EN.exec(text);
  const trigger = triggerEs || triggerEn;
  if (trigger) {
    const lang = triggerEs ? 'es' : 'en';
    return buildReminderFromRest(text.slice(trigger[0].length).trim(), lang, now, options);
  }

  // Dominio asumido por el cerebro conversacional: el LLM ya clasificó el texto
  // como recordatorio (accion.dominio='reminder') aunque el fragmento no traiga
  // el trigger verbal. Se parsea la estructura con el MISMO parser.
  if (options.assumedDomain === 'reminder') {
    const lang: 'es' | 'en' = options.language === 'en' ? 'en' : 'es';
    return buildReminderFromRest(text, lang, now, options);
  }

  // --- Citas (agenda) -------------------------------------------
  // 'crea/agenda/programa una cita con {persona} {cuándo}' → reminder.add.
  // Las citas se modelan como recordatorios (fuente única por intención).
  const citaEs = CITA_TRIGGER_ES.exec(text);
  const citaEn = CITA_TRIGGER_EN.exec(text);
  const cita = citaEs || citaEn;
  if (cita) {
    const lang = citaEs ? 'es' : 'en';
    let rest = text.slice(cita[0].length).trim();

    // Persona (opcional): 'con el doctor', 'with the doctor'.
    let person: string | undefined;
    const conMatch = (lang === 'es' ? CITA_PERSON_ES : CITA_PERSON_EN).exec(rest);
    if (conMatch) {
      person = conMatch[1];
      rest = rest.slice(conMatch[0].length).trim();
    }

    const { textPart, whenClause } = splitWhen(rest);
    const base = person
      ? lang === 'es'
        ? `cita con ${person}`
        : `appointment with ${person}`
      : lang === 'es'
        ? 'cita'
        : 'appointment';
    // El asunto conserva el contexto aunque el usuario lo diga DESPUÉS de la
    // hora: se limpia la cláusula de tiempo de todo el resto (textPart +
    // whenClause) con un único limpiador.
    const subjectText = cleanCitaSubject(`${textPart} ${whenClause || ''}`);
    const subject = subjectText ? `${base} ${subjectText}` : base;
    if (!subject.trim()) {
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

    const data: ReminderIntentData = { text: subject };
    if (dueAt !== undefined) data.dueAt = dueAt;
    if (person) data.personName = person;

    const whenPhrase = whenLabel
      ? lang === 'es'
        ? `, ${whenLabel}`
        : `, at ${whenLabel}`
      : '';
    const reply =
      lang === 'es'
        ? `Listo, agendé tu cita${person ? ` con ${person}` : ''}: "${subject}"${whenPhrase}.`
        : `Done, I scheduled your appointment${person ? ` with ${person}` : ''}: "${subject}"${whenPhrase}.`;

    return { handled: true, action: 'reminder.add', reply, data };
  }

  return { handled: false, action: null, reply: '' };
}
