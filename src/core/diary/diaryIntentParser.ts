// ============================================================
// diaryIntentParser — Reconocimiento determinista del DIARIO
// ------------------------------------------------------------
// "escribe/anota en el diario que…", "diario: …". Puro y testeable, sin
// React. Se evalúa ANTES que el parser de notas porque su patrón
// ("... en el diario ...") es más específico que el "apunta {texto}" genérico.
// ============================================================

export interface DiaryIntent {
  /** true si el input fue reconocido como comando de diario. */
  handled: boolean;
  /** Acción a ejecutar; null si no aplica. */
  action: 'diary.addEntry' | null;
  /** Confirmación determinista para hablar. */
  reply: string;
  data?: { content?: string };
}

export interface DiaryIntentParserOptions {
  /** Idioma de la respuesta determinista (por defecto: 'es'). */
  language?: 'es' | 'en';
}

// "escribe en el diario que fui al parque" / "anota en mi diario: hoy llovió"
const ADD_DIARIO_ES =
  /^(?:escribe|escribi|guarda|guarde|anota|apunta|registra|agrega|a[ñn]ade)\s+(?:en\s+)?(?:el\s+|mi\s+|la\s+)?diario(?:\s+que)?\s*[:,\-]?\s*(.+)$/i;

// "diario: fui al parque" / "diario fui al parque"
const PREFIX_DIARIO = /^diario\s*[:,\-]?\s+(.+)$/i;

// "write in my diary that I went to the park"
const ADD_DIARY_EN =
  /^(?:write|add|note|log|save)\s+(?:in\s+)?(?:my\s+|the\s+)?diary(?:\s+that)?\s*[:,\-]?\s*(.+)$/i;

/**
 * Interpreta un texto como comando de diario. Devuelve `handled:false` si no
 * reconoce una entrada con contenido.
 */
export function parseDiaryIntent(
  rawText: string,
  options: DiaryIntentParserOptions = {},
): DiaryIntent {
  const text = String(rawText || '').trim();
  if (!text) return { handled: false, action: null, reply: '' };

  const match = ADD_DIARIO_ES.exec(text) || PREFIX_DIARIO.exec(text) || ADD_DIARY_EN.exec(text);
  const content = match?.[1]?.trim();
  if (!content) return { handled: false, action: null, reply: '' };

  const lang = options.language === 'en' ? 'en' : 'es';
  return {
    handled: true,
    action: 'diary.addEntry',
    reply:
      lang === 'en'
        ? `Done, I saved your diary entry: "${content}".`
        : `Listo, guardé en tu diario: "${content}".`,
    data: { content },
  };
}
