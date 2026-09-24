/**
 * Clave de día local `YYYY-MM-DD`. Fuente única (C58).
 *
 * Antes existían 5 copias idénticas de este formateador (browserSession,
 * dayRollover, contactService, habitService, participantRegistry); todas
 * consumen ahora esta función.
 *
 * @param input Fecha o timestamp; por defecto, el instante actual.
 * @returns El día local en formato `YYYY-MM-DD`.
 */
export function dayKey(input: Date | number = new Date()): string {
  const d = input instanceof Date ? input : new Date(input)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * `true` si `value` tiene FORMA de clave de dA-a (`YYYY-MM-DD`). NO valida el
 * calendario (aceptaria `2026-13-45`): es el guardia de formato, no un parser.
 * Contraparte del formateador `dayKey()`.
 *
 * C58 quedo a medias: unifico el formateador y dejo 5 copias de ESTE literal
 * (contactService, diaryService, habitService, moodService, participantRegistry).
 */
export function isDayKey(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
