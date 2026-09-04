// ============================================================
// Date Parser — Recordatorios (B2)
// ------------------------------------------------------------
// Parseo determinista de formatos explícitos de fecha/hora.
// Regla #1: sin hardcode; los formatos soportados se declaran aquí.
// Función pura: `now` es inyectable para testear sin reloj real.
// ============================================================

export interface ParsedDateTime {
  /** Timestamp en ms (epoch). */
  at: number;
  /** Formato que coincidió (para trazas/mensajes). */
  format: string;
  /** true si el resultado incluye hora explícita. */
  hasTime: boolean;
}

export interface DateParserOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

/** Expresiones de hora explícitas: 'HH:mm', 'H:mm', 'HH:mm:ss'. */
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** Fecha ISO corta: 'YYYY-MM-DD'. */
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha con hora ISO: 'YYYY-MM-DD HH:mm' (o con 'T'). */
const ISO_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ]([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** Fecha día/mes/año: 'DD/MM/YYYY' o 'DD-MM-YYYY'. */
const DMY_PATTERN = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

/** Fecha día/mes/año con hora: 'DD/MM/YYYY HH:mm'. */
const DMY_DATETIME_PATTERN = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T]([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** Fecha completa ISO 8601 con zona (Date.parse nativo). */
const ISO_FULL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isValidDatePart(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(year, month - 1, day);
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day
  );
}

/** Construye un Date local desde sus partes. */
function buildLocalDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

/**
 * Parsea una fecha/hora explícita a timestamp.
 * Formatos soportados:
 *   - 'HH:mm'                    → hoy a esa hora (si ya pasó, mañana)
 *   - 'YYYY-MM-DD'               → fecha a medianoche
 *   - 'YYYY-MM-DD HH:mm' / 'T'   → fecha y hora local
 *   - 'DD/MM/YYYY' / 'DD-MM-YYYY'
 *   - 'DD/MM/YYYY HH:mm'
 *   - ISO 8601 completo con zona (Date.parse)
 * Devuelve null si no reconoce el formato o la fecha es inválida.
 */
export function parseDateTime(
  input: string,
  options: DateParserOptions = {},
): ParsedDateTime | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;

  const now = options.now ? options.now() : Date.now();
  const nowDate = new Date(now);

  // ISO completo con zona → Date.parse nativo (UTC-aware).
  if (ISO_FULL_PATTERN.test(text)) {
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) return null;
    return { at: parsed, format: 'iso-full', hasTime: true };
  }

  // Solo hora 'HH:mm' → hoy, o mañana si ya pasó.
  const timeMatch = TIME_PATTERN.exec(text);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    const second = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    let date = buildLocalDate(nowDate.getFullYear(), nowDate.getMonth() + 1, nowDate.getDate(), hour, minute, second);
    if (date.getTime() <= now) {
      // Ya pasó hoy → programar para mañana.
      date = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    }
    return { at: date.getTime(), format: 'time-only', hasTime: true };
  }

  // Fecha ISO 'YYYY-MM-DD' → a medianoche local.
  const isoDateMatch = ISO_DATE_PATTERN.exec(text);
  if (isoDateMatch) {
    const year = parseInt(isoDateMatch[1], 10);
    const month = parseInt(isoDateMatch[2], 10);
    const day = parseInt(isoDateMatch[3], 10);
    if (!isValidDatePart(year, month, day)) return null;
    return {
      at: buildLocalDate(year, month, day).getTime(),
      format: 'iso-date',
      hasTime: false,
    };
  }

  // Fecha ISO con hora 'YYYY-MM-DD HH:mm'.
  const isoDateTimeMatch = ISO_DATETIME_PATTERN.exec(text);
  if (isoDateTimeMatch) {
    const year = parseInt(isoDateTimeMatch[1], 10);
    const month = parseInt(isoDateTimeMatch[2], 10);
    const day = parseInt(isoDateTimeMatch[3], 10);
    const hour = parseInt(isoDateTimeMatch[4], 10);
    const minute = parseInt(isoDateTimeMatch[5], 10);
    const second = isoDateTimeMatch[6] ? parseInt(isoDateTimeMatch[6], 10) : 0;
    if (!isValidDatePart(year, month, day)) return null;
    return {
      at: buildLocalDate(year, month, day, hour, minute, second).getTime(),
      format: 'iso-datetime',
      hasTime: true,
    };
  }

  // Fecha DMY con hora 'DD/MM/YYYY HH:mm'.
  const dmyDateTimeMatch = DMY_DATETIME_PATTERN.exec(text);
  if (dmyDateTimeMatch) {
    const day = parseInt(dmyDateTimeMatch[1], 10);
    const month = parseInt(dmyDateTimeMatch[2], 10);
    const year = parseInt(dmyDateTimeMatch[3], 10);
    const hour = parseInt(dmyDateTimeMatch[4], 10);
    const minute = parseInt(dmyDateTimeMatch[5], 10);
    const second = dmyDateTimeMatch[6] ? parseInt(dmyDateTimeMatch[6], 10) : 0;
    if (!isValidDatePart(year, month, day)) return null;
    return {
      at: buildLocalDate(year, month, day, hour, minute, second).getTime(),
      format: 'dmy-datetime',
      hasTime: true,
    };
  }

  // Fecha DMY 'DD/MM/YYYY' → a medianoche local.
  const dmyMatch = DMY_PATTERN.exec(text);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    if (!isValidDatePart(year, month, day)) return null;
    return {
      at: buildLocalDate(year, month, day).getTime(),
      format: 'dmy-date',
      hasTime: false,
    };
  }

  return null;
}

/**
 * Formatea un timestamp como 'YYYY-MM-DD HH:mm' (local).
 * Útil para UI y mensajes.
 */
export function formatDateTime(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
