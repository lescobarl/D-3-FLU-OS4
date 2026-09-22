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
