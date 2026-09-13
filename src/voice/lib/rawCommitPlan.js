// ============================================================
// rawCommitPlan.js — Decisión de commit de la emisión cruda (§9)
// ------------------------------------------------------------
// El MOTOR de voz decide si una emisión REEMPLAZA la fila del turno
// (`replaceLastRawLog`, misma emisión creciendo) o si es una fila Nueva.
// Esta capa pura resuelve la fila objetivo SIN depender de la etiqueta de
// hablante: entre commits la voz puede resolverse y el nombre pasar de
// provisional ("Hablante 1") a real ("Luis"). Buscar por nombre hacía que el
// reemplazo no encontrara la fila y se duplicara (dos filas por una frase).
//
// Invariante (§9): una frase hablada → UNA fila. El reemplazo se identifica
// por el id de la emisión cruda en curso, no por el hablante.
// ============================================================

/**
 * Resuelve la operación de commit de una emisión cruda.
 * @param {Array<{id?: string, speakerName?: string}>} history — historial actual.
 * @param {object} options
 * @param {boolean} options.replaceLastRawLog — decisión del motor (misma emisión).
 * @param {string|null} options.lastRawEntryId — id de la fila cruda en curso.
 * @param {string} options.speakerName — hablante resuelto de ESTA emisión.
 * @returns {{action: 'replace', index: number, speakerName: string} | {action: 'append'}}
 */
export function planRawCommit(history, {
  replaceLastRawLog = false,
  lastRawEntryId = null,
  speakerName = '',
} = {}) {
  const list = Array.isArray(history) ? history : []
  if (!replaceLastRawLog || !lastRawEntryId) return { action: 'append' }

  const targetId = String(lastRawEntryId)
  const index = list.findIndex((entry) => entry && String(entry.id || '') === targetId)
  if (index < 0) return { action: 'append' }

  const prev = list[index] || {}
  const resolved =
    String(speakerName || '').trim() ||
    String(prev.speakerName || '').trim() ||
    'Hablante 1'
  return { action: 'replace', index, speakerName: resolved }
}
