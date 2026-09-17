// ============================================================
// panelRescue.js — Garantía determinista del PANEL (agenda + notas)
// ------------------------------------------------------------
// Red de seguridad de UNA sola ruta: cuando el cerebro LLM emite acciones
// pero NINGUNA cubre agenda ni nota, y el turno SÍ resuelve agenda/nota por
// el MISMO árbitro determinista que estructuran todos los elementos del
// panel, se devuelve esa resolución para que App la despache por el MISMO
// `dispatchArbiterIntent`. No crea una segunda ruta: reutiliza el parser
// único (`resolveDeterministicCommand`).
//
// No duplica: si el dominio resuelto ya está entre los dominios efectivos
// del turno, devuelve null.
// ============================================================

import { normalizeCommandForDeterministic } from './audioMath.js'
import { resolveDeterministicCommand } from './deterministicArbiter.js'

/** Dominios del panel derecho (agenda + notas). */
const PANEL_DOMAINS = ['agendaCommand', 'agenda', 'note']

/**
 * Resuelve la acción de panel (agenda o nota) que falta en un turno, si aplica.
 *
 * @param {object} params
 * @param {string} [params.transcript] Transcript canónico del turno.
 * @param {string[]} [params.resolvedDomains] Dominios de las acciones ya resueltas.
 * @param {string[]} [params.wakeWords] Wake words configuradas (para normalizar).
 * @param {object} [params.arbiterOptions] Opciones del árbitro (now, offsets, idioma…).
 * @returns {{ matched: boolean, domain: string, action: object, channel: string } | null}
 */
export function resolvePanelRescue({
  transcript = '',
  resolvedDomains = [],
  wakeWords = [],
  arbiterOptions = {},
} = {}) {
  const text = String(transcript || '').trim()
  if (!text) return null

  const commandText = normalizeCommandForDeterministic(text, wakeWords)
  const resolved = resolveDeterministicCommand(commandText, arbiterOptions)
  if (!resolved?.matched || !resolved.domain) return null
  if (!PANEL_DOMAINS.includes(resolved.domain)) return null

  const covered = new Set(Array.isArray(resolvedDomains) ? resolvedDomains : [])
  if (covered.has(resolved.domain)) return null

  return resolved
}
