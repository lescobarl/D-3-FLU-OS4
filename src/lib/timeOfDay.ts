/**
 * timeOfDay — parseo de una hora `HH:MM`, dueño único.
 *
 * Agenda y DND validaban el mismo formato por su cuenta. Aquí se valida una vez
 * y se ofrecen minutos (DND) y milisegundos (agenda).
 */

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/

/**
 * Convierte `HH:MM` a minutos desde medianoche.
 * @param value Hora en formato `HH:MM`.
 * @returns Minutos, o null si el formato es inválido.
 */
export function parseTimeOfDayToMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Convierte `HH:MM` a milisegundos desde medianoche.
 * @param value Hora en formato `HH:MM`.
 * @returns Milisegundos, o null si el formato es inválido.
 */
export function parseTimeOfDayToMs(value: string | undefined): number | null {
  if (!value) return null
  const minutes = parseTimeOfDayToMinutes(value)
  return minutes === null ? null : minutes * 60_000
}
