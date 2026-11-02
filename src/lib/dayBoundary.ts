/**
 * dayBoundary — frontera de día LOCAL, dueño único.
 *
 * Antes vivía duplicada en el parser de fechas (Date) y en el panel de agenda
 * (milisegundos). Ambas deben responder la misma frontera.
 */

/**
 * Devuelve una copia de la fecha en la medianoche local.
 * @param date Fecha de referencia.
 * @returns Nueva fecha a las 00:00:00.000 locales.
 */
export function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/**
 * Devuelve la medianoche local en milisegundos.
 * @param date Fecha de referencia.
 * @returns Marca temporal de la medianoche local.
 */
export function startOfDayMs(date: Date): number {
  return startOfDay(date).getTime()
}
