// ============================================================
// agendaIntentParser — Parser determinista de la agenda del día
// ------------------------------------------------------------
// Reconoce la consulta "¿qué hay para hoy?" (y variantes) como
// una acción determinista `agenda.today`, SIN depender del LLM
// para el listado. Vive en src/core/agenda (puro, sin React).
// ============================================================

export type AgendaIntentAction = 'agenda.today';

export interface AgendaIntentData {
  /** Día de la consulta: hoy (único soportado). */
  when?: 'hoy';
}

export interface AgendaIntent {
  handled: boolean;
  action: AgendaIntentAction | null;
  data?: AgendaIntentData;
  reply: string;
}

const WAKE_LEAD = /^(?:ok\s*flu|okay\s*flow|hey\s*flu|flu|ok\s*flow)[,.\s]*/i;

const QUERY_TRIGGERS_ES =
  /^(?:qué|que)\s+(?:hay|tengo|tienes|tiene)\s*(?:para\s+)?(?:hoy|el\s+d[ií]a\s+de\s+hoy)\b|^(?:agenda|plan|resumen|resúmeme|resumeme)\s*(?:de\s+|del\s+|para\s+(?:el\s+|la\s+)?)?(?:hoy|el\s+d[ií]a|mi\s+d[ií]a)\b|^(?:dime|muestra|muéstrame|muestrame|dame|ver|enseñame|ensename)\s+(?:mi\s+|la\s+|el\s+)?(?:agenda|plan|resumen|d[ií]a)\b/i;

const QUERY_TRIGGERS_EN =
  /^what(?:'s| is)?\s+(?:on|up|do\s+i\s+have)\s*(?:for\s+)?(?:today|my\s+day)\b|^(?:my|today'?s)\s+(?:agenda|schedule|plan)\b|^show\s+(?:me\s+)?(?:my\s+)?(?:agenda|day|plan)\b/i;

/**
 * Interpreta un texto de voz/texto como consulta de la agenda del día.
 * Devuelve `handled: false` si no reconoce la intención.
 */
export function parseAgendaIntent(input: string): AgendaIntent {
  if (typeof input !== 'string') return { handled: false, action: null, reply: '' };
  let text = String(input || '').trim();
  text = text.replace(WAKE_LEAD, ' ').trim();
  // Signos de apertura del dictado ("¿qué…", "¡…"): no son parte del mandato.
  text = text.replace(/^[¿¡]+/, '').trim();
  if (!text) return { handled: false, action: null, reply: '' };

  if (QUERY_TRIGGERS_ES.test(text) || QUERY_TRIGGERS_EN.test(text)) {
    return { handled: true, action: 'agenda.today', data: { when: 'hoy' }, reply: '' };
  }
  return { handled: false, action: null, reply: '' };
}
