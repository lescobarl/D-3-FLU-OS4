// ============================================================
// src/lib/spokenNumbers.ts
// Léxico ÚNICO de números hablados (es/en) → entero.
// ------------------------------------------------------------
// Una sola tabla para TODO lo que lee un número del habla:
//   - horas  → core/temporal/timeOfDay ("a las siete", "at seven").
//   - días de fecha → voice/lib/configCommands ("diez de mayo").
//   - cualquier consumidor futuro.
// Antes vivía copiada dentro de configCommands y las regex de hora sólo
// aceptaban cifras, así que "a las siete" no existía para ningún flujo.
// Con una sola fuente, añadir una forma nueva la habilita en TODOS los flujos
// a la vez (y las regex se construyen a partir de esta tabla: no hay listas de
// frases paralelas que puedan divergir).
// ============================================================
import { normalizeForMatch } from './textUtils';

/** Números hablados en español (0-30, sin acentos: se normaliza antes de buscar). */
export const SPOKEN_NUMBERS_ES: Readonly<Record<string, number>> = Object.freeze({
  uno: 1,
  // Femenino de 1: la hora usa "a la una".
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
});

/** Números hablados en inglés (0-30). */
export const SPOKEN_NUMBERS_EN: Readonly<Record<string, number>> = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  twentyone: 21,
  twentytwo: 22,
  twentythree: 23,
  twentyfour: 24,
  twentyfive: 25,
  twentysix: 26,
  twentyseven: 27,
  twentyeight: 28,
  twentynine: 29,
  thirty: 30,
});

/**
 * Resuelve un número hablado (cifra o palabra, es/en) a entero, o null.
 * Se usa en huecos ACOTADOS del habla (hora, minuto, día), así que una cifra
 * sólo es válida con 1-2 dígitos: "1995" no es un día ni una hora.
 */
export function resolveSpokenNumber(token: string | number | null | undefined): number | null {
  if (typeof token === 'number') return Number.isFinite(token) ? token : null;
  const raw = String(token ?? '').trim();
  if (!raw) return null;
  if (/^\d{1,2}$/.test(raw)) return Number(raw);
  const word = normalizeForMatch(raw);
  const es = SPOKEN_NUMBERS_ES[word];
  if (es != null) return es;
  return SPOKEN_NUMBERS_EN[word] ?? null;
}

/**
 * Alternancia regex con las palabras de un idioma, de más larga a más corta
 * (para que "veinticinco" no se lea como "cinco"). Pensada para incrustar en un
 * patrón: `new RegExp('(?:' + spokenNumberAlternation('es') + ')')`.
 */
export function spokenNumberAlternation(language: 'es' | 'en' = 'es'): string {
  const table = language === 'en' ? SPOKEN_NUMBERS_EN : SPOKEN_NUMBERS_ES;
  return Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .join('|');
}
