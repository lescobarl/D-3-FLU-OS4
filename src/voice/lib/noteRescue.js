// ============================================================
// noteRescue.js — Garantía determinista de nota por voz
// ------------------------------------------------------------
// Red de seguridad de UNA sola ruta: cuando el cerebro LLM emite
// acciones pero NINGUNA cubre una nota, y el turno SÍ es una nota
// determinista (mismo árbitro que usa el fallback offline), se
// devuelve el intent de nota para que App lo despache por el MISMO
// `dispatchArbiterIntent`. No crea una segunda ruta: reutiliza el
// parser único (`parseNoteIntentText`) a través del árbitro.
//
// No duplica: si las acciones efectivas del turno ya incluyen el
// dominio 'note', o el turno resuelve otro dominio, devuelve null.
// ============================================================

import { normalizeCommandForDeterministic } from './audioMath.js'
import { resolveDeterministicCommand } from './deterministicArbiter.js'

/**
 * Resuelve la acción de nota que falta en un turno, si aplica.
 *
 * @param {object} params
 * @param {string} [params.transcript] Transcript canónico del turno.
 * @param {string[]} [params.resolvedDomains] Dominios de las acciones ya resueltas.
 * @param {string[]} [params.wakeWords] Wake words configuradas (para normalizar).
 * @param {object} [params.arbiterOptions] Opciones del árbitro (now, offsets, idioma…).
 * El intent de nota resuelto por el árbitro, o null si no aplica (el tipo se
 * infiere de `resolveDeterministicCommand`).
 */
export function resolveNoteRescue({
  transcript = '',
  resolvedDomains = [],
  wakeWords = [],
  arbiterOptions = {},
} = {}) {
  const text = String(transcript || '').trim()
  if (!text) return null
  if (Array.isArray(resolvedDomains) && resolvedDomains.includes('note')) return null

  const commandText = normalizeCommandForDeterministic(text, wakeWords)
  const resolved = resolveDeterministicCommand(commandText, arbiterOptions)
  return resolved?.matched && resolved.domain === 'note' ? resolved : null
}
