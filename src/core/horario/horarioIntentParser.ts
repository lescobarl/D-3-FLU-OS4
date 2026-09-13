// ============================================================
// Horario Intent Parser — Horario por dictado de voz (FASE C)
// ------------------------------------------------------------
// Parser determinista es/en para AGREGAR, CONSULTAR y QUITAR
// entradas del horario semanal por dictado:
//   - 'agrega matemáticas el lunes a las 8'
//   - 'agrega historia el martes de 8 a 9:30'
//   - 'pon natación el miércoles a las 5 de la tarde'
//   - 'qué clases tengo mañana' / 'qué tengo el lunes' / 'qué tengo hoy'
//   - 'quita la clase de historia del martes' / 'elimina matemáticas del lunes'
//
// Regla #1: sin hardcode; días/horas se resuelven con helpers
//   reutilizados de horarioService (clasificarDia, extractHorarioHoras).
// Regla de oro: motor determinista (no toca Gemini ni el DOM).
// ============================================================

import { clasificarDia, extractHorarioHoras, diaDeFecha, toHHMM } from './horarioService';
import { pickTimeOfDay } from '../temporal/timeOfDay';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export type HorarioIntentAction =
  | 'horario.add'
  | 'horario.query'
  | 'horario.remove';

export interface HorarioIntentData {
  /** Título/actividad de la entrada (add/remove). */
  materia?: string;
  /** Día ISO (1=Lunes ... 7=Domingo). */
  dia?: number;
  /** Hora de inicio 'HH:MM' (add). */
  inicio?: string;
  /** Hora de fin 'HH:MM' (add, opcional). */
  fin?: string;
  /** Lugar opcional (add). */
  aula?: string;
  /** Día relativo para consulta: 'hoy' | 'manana' | 'proximo' | 'dia' | null. */
  when?: 'hoy' | 'manana' | 'proximo' | 'dia' | null;
}

export interface HorarioIntent {
  /** true si el input fue reconocido como comando de horario. */
  handled: boolean;
  /** Acción a ejecutar; null cuando hace falta aclaración. */
  action: HorarioIntentAction | null;
  /** Mensaje determinista para confirmar o pedir aclaración. */
  reply: string;
  data?: HorarioIntentData;
}

export interface HorarioIntentParserOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

// ------------------------------------------------------------
// Constantes declarativas — Regla #1 (sin hardcode disperso)
// ------------------------------------------------------------

const ADD_TRIGGERS_ES =
  /^(?:agrega|agregar|agregame|añade|anade|agenda|agendame|apunta|apuntame|anota|anotame|pon|pone|ponen|poner|pones|ponme|programa|programar|registra|registrar|registrame|crea|crear)\b/i;
const ADD_TRIGGERS_EN =
  /^(?:add|put|schedule|set|create|register)\b/i;

const REMOVE_TRIGGERS_ES =
  /^(?:quita|quitar|quitame|quitale|quitemos|elimina|eliminar|eliminame|borra|borrar|borrame|remueve|remover|saca|sacar)\b/i;
const REMOVE_TRIGGERS_EN =
  /^(?:remove|delete|drop|clear|quit)\b/i;

const QUERY_TRIGGERS_ES =
  /^(?:qué|que)\s+(?:clases|materias|entradas|actividades|tengo|hay)\b|^(?:dime|muestra|muéstrame|muestrame|ver|abre|abrir|enseñame|ensename|consulta)\s+(?:mis\s+)?(?:clases|materias|entradas|horario|actividades)\b|^qué\s+tengo\b/i;
const QUERY_TRIGGERS_EN =
  /^what(?:'s| is)?\s+(?:my\s+)?(?:schedule|classes|subjects|entries|agenda)\b|^show\s+(?:me\s+)?(?:my\s+)?(?:schedule|classes|subjects|entries|agenda)\b/i;

/** Palabras que se descartan al extraer el nombre de la materia. */
const MATERIA_STOP_WORDS: ReadonlyArray<string> = Object.freeze([
  'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'en', 'a', 'para', 'por', 'favor',
  'clase', 'clases', 'materia', 'materias', 'entrada', 'entradas', 'actividad',
  'actividades', 'curso', 'cursos', 'horario', 'agenda',
  'hoy', 'mañana', 'manana', 'tarde', 'noche',
  'the', 'a', 'an', 'of', 'on',
  'at', 'from', 'until', 'to', 'in', 'for', 'class', 'classes', 'subject',
  'subjects', 'entry', 'entries', 'activity', 'activities', 'schedule',
]);

const DAY_NAMES_ES: ReadonlyArray<{ name: string; num: number }> = Object.freeze([
  { name: 'lunes', num: 1 },
  { name: 'martes', num: 2 },
  { name: 'miercoles', num: 3 },
  { name: 'jueves', num: 4 },
  { name: 'viernes', num: 5 },
  { name: 'sabado', num: 6 },
  { name: 'domingo', num: 7 },
]);

const DAY_NAMES_EN: ReadonlyArray<{ name: string; num: number }> = Object.freeze([
  { name: 'monday', num: 1 },
  { name: 'tuesday', num: 2 },
  { name: 'wednesday', num: 3 },
  { name: 'thursday', num: 4 },
  { name: 'friday', num: 5 },
  { name: 'saturday', num: 6 },
  { name: 'sunday', num: 7 },
]);

const DAY_LABELS_ES: ReadonlyArray<string> = Object.freeze([
  'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo',
]);
const DAY_LABELS_EN: ReadonlyArray<string> = Object.freeze([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

const stripDiacritics = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Detecta el día ISO (1-7) mencionado en un texto, o null. */
function detectDia(text: string): number | null {
  const norm = stripDiacritics(text);
  // Día relativo: hoy / mañana / próximo lunes.
  if (/\b(hoy|today)\b/.test(norm)) return diaDeFecha(Date.now());
  if (/\b(mañana|manana|tomorrow)\b/.test(norm)) {
    const d = new Date(Date.now());
    d.setDate(d.getDate() + 1);
    return diaDeFecha(d.getTime());
  }
  // Día de la semana explícito.
  for (const d of DAY_NAMES_ES) {
    if (new RegExp(`\\b${d.name}\\b`).test(norm)) return d.num;
  }
  for (const d of DAY_NAMES_EN) {
    if (new RegExp(`\\b${d.name}\\b`).test(norm)) return d.num;
  }
  return null;
}

/** Detecta si el texto pide el día de HOY o MAÑANA para una consulta. */
function detectWhen(text: string): 'hoy' | 'manana' | 'proximo' | 'dia' | null {
  const norm = stripDiacritics(text);
  if (/\b(hoy|today)\b/.test(norm)) return 'hoy';
  if (/\b(mañana|manana|tomorrow)\b/.test(norm)) return 'manana';
  if (/\b(próximo|proximo|next)\b/.test(norm)) return 'proximo';
  if (detectDia(text) !== null) return 'dia';
  return null;
}

/** Extrae la hora de inicio 'HH:MM' con el selector ÚNICO compartido. */
function extractStartTime(text: string): string | null {
  return pickTimeOfDay(stripDiacritics(text)).timeOfDay;
}

/** Extrae la hora de fin 'HH:MM' de frases como 'hasta las 9:30', 'until 9:30'. */
function extractEndTime(text: string): string | null {
  const norm = stripDiacritics(text);
  // 'de 8:00 a 9:30' / '8:00 a 9:30' — rango explícito con minutos.
  const range = extractHorarioHoras(text);
  if (range) return range.fin;
  // Marcadores de fin EXPLÍCITOS ('hasta'/'until'). NO se usa 'a'/'to' sueltos
  // porque colisionan con la hora de inicio ('a las 8'): así 'a las 8 hasta
  // las 9:30' devuelve 09:30 y 'a las 8' no produce un fin espurio.
  // 'hasta las 9:30' / 'until 9:30' (el 'las' es opcional en inglés).
  let m = /\b(?:hasta|until)(?:\s+las?)?\s+(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\b/.exec(norm);
  if (m) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return toHHMM(h * 60 + min);
  }
  // Hora de fin en formato am/pm (p. ej. 'hasta las 2 pm').
  m = /\b(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(am|pm)\b/.exec(norm);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const meridiem = m[3];
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return toHHMM(h * 60 + min);
  }
  return null;
}

/** Extrae el aula/salón si se menciona ('en el aula 3', 'salón 12'). */
function extractAulaFromText(text: string): string | undefined {
  const m = /\b(?:en\s+)?(?:el\s+)?(?:aula|sal[oó]n|salon|lab|laboratorio|taller)\s+([\wÁÉÍÓÚáéíóúÑñ.-]+)/i.exec(text);
  return m ? m[1] : undefined;
}

/** Limpia el nombre de la materia quitando palabras de relleno. */
function cleanMateriaName(raw: string): string {
  let value = String(raw || '').trim();
  // Días de la semana (es/en), con o sin preposición previa ('el lunes', 'on monday').
  // Se incluyen las variantes acentuadas (miércoles, sábado) porque el texto
  // dictado puede llegar con o sin tilde.
  const dayNames =
    '(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|' +
    'monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
  value = value
    .replace(new RegExp(`\\b(?:el|los|las|on|from)\\s+${dayNames}\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b${dayNames}\\b`, 'gi'), ' ')
    // Día relativo ('mañana', 'hoy') y franja del día ('de la mañana'): no son
    // parte del nombre de la materia. Dictado natural: 'natación para mañana a
    // las 10 de la mañana' → materia 'natación'.
    .replace(/\b(?:para\s+)?(?:mañana|manana|hoy|today|tomorrow)\b/gi, ' ')
    .replace(/\bde\s+la\s+(?:mañana|manana|tarde|noche)\b/gi, ' ')
    // Cláusula de hora con meridiano como una sola unidad: 'a las 2 pm', 'at 8 am',
    // 'hasta las 9:30', 'until 9:30', 'de 8 a 9', 'from 8 to 9'.
    .replace(
      /\b(?:a\s+las?|at|para\s+las?|hasta\s+las?|until|de|from|to)\s+\d{1,2}(?:\s*[:.]\s*\d{2})?(?:\s*(?:am|pm))?\b/gi,
      ' ',
    )
    // Rango '8:00 a 9:30' / '8 am a 9:30 am' que no llevara preposición.
    .replace(/\b\d{1,2}(?:\s*[:.]\s*\d{2})?\s*(?:am|pm)?\s*(?:-|–|—|a|to)\s*\d{1,2}(?:\s*[:.]\s*\d{2})?\s*(?:am|pm)?\b/gi, ' ')
    // Hora suelta con meridiano ('2 pm').
    .replace(/\b\d{1,2}(?:\s*[:.]\s*\d{2})?\s*(?:am|pm)\b/gi, ' ')
    // Aula/salón/laboratorio.
    .replace(/\b(?:en\s+)?(?:el\s+)?(?:aula|sal[oó]n|salon|lab|laboratorio|taller)\s+[\wÁÉÍÓÚáéíóúÑñ.-]+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Quitar palabras de relleno iniciales/finales.
  const words = value.split(/\s+/).filter(Boolean);
  const cleaned = words.filter((w) => !MATERIA_STOP_WORDS.includes(stripDiacritics(w)));
  return cleaned.join(' ').trim();
}

/** Etiqueta legible de un día ISO (1-7). */
function dayLabel(dia: number, lang: 'es' | 'en'): string {
  const idx = dia - 1;
  if (lang === 'en') return DAY_LABELS_EN[idx] || String(dia);
  return DAY_LABELS_ES[idx] || String(dia);
}

// ------------------------------------------------------------
// Respuestas deterministas (es/en)
// ------------------------------------------------------------

function addReply(materia: string, dia: number, inicio: string, fin: string | undefined, lang: 'es' | 'en'): string {
  const time = fin ? `${inicio} a ${fin}` : `a las ${inicio}`;
  return lang === 'es'
    ? `Listo, agregué "${materia}" el ${dayLabel(dia, 'es')} ${time} al horario.`
    : `Done, I added "${materia}" on ${dayLabel(dia, 'en')} ${time} to the schedule.`;
}

function removeReply(materia: string, dia: number | undefined, lang: 'es' | 'en'): string {
  const when = dia ? ` el ${dayLabel(dia, lang)}` : '';
  return lang === 'es'
    ? `Listo, quité "${materia}"${when} del horario.`
    : `Done, I removed "${materia}"${when} from the schedule.`;
}

function removeNotFoundReply(materia: string, lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `No encontré "${materia}" en el horario.`
    : `I couldn't find "${materia}" in the schedule.`;
}

function askMateriaReply(lang: 'es' | 'en'): string {
  return lang === 'es'
    ? '¿Qué entrada quieres agregar al horario y en qué día?'
    : 'What entry would you like to add to the schedule, and on which day?';
}

function askMateriaRemoveReply(lang: 'es' | 'en'): string {
  return lang === 'es'
    ? '¿Qué entrada quieres quitar del horario?'
    : 'Which entry would you like to remove from the schedule?';
}

// ------------------------------------------------------------
// Parser principal
// ------------------------------------------------------------

/**
 * Interpreta un texto de voz/texto como comando de horario (agregar,
 * consultar o quitar). Devuelve `handled: false` si no reconoce ninguna
 * intención de horario.
 */
export function parseHorarioIntent(
  input: string,
  options: HorarioIntentParserOptions = {},
): HorarioIntent {
  if (typeof input !== 'string') return { handled: false, action: null, reply: '' };
  const text = input.trim();
  if (!text) return { handled: false, action: null, reply: '' };

  const now = options.now ? options.now() : Date.now();
  const lang: 'es' | 'en' = /[a-záéíóúñü]/i.test(text) && !/[¿¡áéíóú]/.test(text) && /^(add|put|schedule|set|create|register|remove|delete|drop|clear|quit|what|show)\b/i.test(text)
    ? 'en'
    : 'es';

  // --- Consulta ---------------------------------------------
  const queryEs = QUERY_TRIGGERS_ES.test(text);
  const queryEn = QUERY_TRIGGERS_EN.test(text);
  if (queryEs || queryEn) {
    const qLang = queryEs ? 'es' : 'en';
    const when = detectWhen(text);
    const dia = detectDia(text);
    const data: HorarioIntentData = { when };
    if (dia !== null) data.dia = dia;
    return { handled: true, action: 'horario.query', reply: '', data };
  }

  // --- Agregar ---------------------------------------------
  const addEs = ADD_TRIGGERS_ES.exec(text);
  const addEn = ADD_TRIGGERS_EN.exec(text);
  const addTrigger = addEs || addEn;
  if (addTrigger) {
    const aLang = addEs ? 'es' : 'en';
    const rest = text.slice(addTrigger[0].length).trim();
    const dia = detectDia(rest);
    const inicio = extractStartTime(rest);
    const fin = extractEndTime(rest);
    const aula = extractAulaFromText(rest);
    const materia = cleanMateriaName(rest);

    if (!materia || dia === null) {
      return { handled: true, action: null, reply: askMateriaReply(aLang) };
    }
    if (!inicio) {
      // Sin hora: pedir aclaración.
      return {
        handled: true,
        action: null,
        reply: aLang === 'es'
          ? `¿A qué hora es "${materia}" el ${dayLabel(dia, 'es')}?`
          : `At what time is "${materia}" on ${dayLabel(dia, 'en')}?`,
      };
    }

    const data: HorarioIntentData = { materia, dia, inicio };
    if (fin) data.fin = fin;
    if (aula) data.aula = aula;
    return {
      handled: true,
      action: 'horario.add',
      reply: addReply(materia, dia, inicio, fin ?? undefined, aLang),
      data,
    };
  }

  // --- Quitar ----------------------------------------------
  const removeEs = REMOVE_TRIGGERS_ES.exec(text);
  const removeEn = REMOVE_TRIGGERS_EN.exec(text);
  const removeTrigger = removeEs || removeEn;
  if (removeTrigger) {
    const rLang = removeEs ? 'es' : 'en';
    const rest = text.slice(removeTrigger[0].length).trim();
    const dia = detectDia(rest);
    const materia = cleanMateriaName(rest);
    if (!materia) {
      return { handled: true, action: null, reply: askMateriaRemoveReply(rLang) };
    }
    const data: HorarioIntentData = { materia };
    if (dia !== null) data.dia = dia;
    return {
      handled: true,
      action: 'horario.remove',
      reply: removeReply(materia, dia ?? undefined, rLang),
      data,
    };
  }

  return { handled: false, action: null, reply: '' };
}
