// ============================================================
// calendarNames — FUENTE ÚNICA de los nombres de días y meses (es)
// ------------------------------------------------------------
// Antes había CUATRO tablas de días y TRES de meses repartidas por el
// calendario (parser de agenda, parser de recordatorios, panel, estacional):
// el mismo hecho escrito varias veces, que Regla #1 prohíbe. Aquí vive la
// única copia; el resto importa.
//
// Dos formas a propósito, no una mal usada:
//   - nombres de COMPARACIÓN (`WEEKDAYS_ES`, `MONTH_NAMES_ES`): sin acentos,
//     porque el habla se pliega con `stripDiacritics` antes de comparar.
//   - nombres de PANTALLA (`WEEKDAY_DISPLAY_ES`): con acentos, para mostrar.
// ============================================================

/** Nombres de mes, índice 0 = enero. Sin acentos (comparación). */
export const MONTH_NAMES_ES: readonly string[] = Object.freeze([
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]);

/** Días por `getDay()`: domingo = 0 … sábado = 6. Sin acentos (comparación). */
export const WEEKDAYS_ES: ReadonlyArray<{ name: string; day: number }> = Object.freeze([
    { name: 'domingo', day: 0 },
    { name: 'lunes', day: 1 },
    { name: 'martes', day: 2 },
    { name: 'miercoles', day: 3 },
    { name: 'jueves', day: 4 },
    { name: 'viernes', day: 5 },
    { name: 'sabado', day: 6 },
]);

/** Alternancia para regex ("domingo|lunes|…"): misma fuente que `WEEKDAYS_ES`. */
export const WEEKDAYS_ALT_ES: string = WEEKDAYS_ES.map((w) => w.name).join('|');

/** Nombres de día para MOSTRAR, indexados por `getDay()`. Con acentos. */
export const WEEKDAY_DISPLAY_ES: readonly string[] = Object.freeze([
    'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
]);

/** Nombres de mes para MOSTRAR, indexados por `getMonth()`. */
export const MONTH_DISPLAY_ES: readonly string[] = MONTH_NAMES_ES;

/** Día ISO local (1 = lunes … 7 = domingo) por nombre normalizado. */
export const ISO_WEEKDAY_BY_NAME: Readonly<Record<string, number>> = Object.freeze(
    Object.fromEntries(WEEKDAYS_ES.map((w) => [w.name, w.day === 0 ? 7 : w.day])),
);
