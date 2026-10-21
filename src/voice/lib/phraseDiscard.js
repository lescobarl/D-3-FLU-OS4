/**
 * DUENO UNICO del DESCARTE de una locucion (B1).
 *
 * DEFECTO MEDIDO (2026-10-10): el descarte estaba repartido por el pipeline y la mayoria
 * de las veces era SILENCIOSO (`return` / `return false` a secas): el preview que encogia,
 * la re-entrega del mismo turno y la locucion viva que no abre fila solo dejaban un
 * `fluDebugHot('stream-skip', ...)` de DESARROLLO, invisible en la sesion del dueno. El
 * descarte por guard anti-alucinacion (`turnCommitPhrase`) emitia su motivo por su cuenta,
 * con su propio formato. Sin un unico sitio no se puede afirmar "0 descartes sin motivo".
 *
 * REGLA: todo descarte de locucion pasa por `discardLocution`, que SIEMPRE emite el motivo
 * (vocabulario cerrado; un motivo desconocido se registra como `unknown`, nunca en
 * silencio) y devuelve el valor de descarte ('' = no hay frase) para que el llamador no
 * pueda descartar por su cuenta.
 */

/** Vocabulario CERRADO de motivos de descarte de una locucion. */
export const DISCARD_REASONS = Object.freeze({
  /** El guard anti-alucinacion la marca como alucinacion clara (vacia o sin palabras). */
  EMPTY: 'empty',
  NONWORD: 'nonword',
  /** La misma frase ya estaba en el log (no aporta nada nuevo). */
  DUPLICATE_PHRASE: 'duplicate-phrase',
  /** Re-entrega del MISMO turno ya commiteado (doble onend / doble dispatch). */
  DUPLICATE_COMMIT: 'duplicate-turn-commit',
  /** El preview encogia (recorte de ruido del ASR): no se toca lo mostrado. */
  SHRINK_PREVIEW: 'shrink-preview',
  /** Locucion viva del turno en curso: no abre fila nueva. */
  AMBIENT_BLOCKED: 'ambient-blocked',
  /** Misma peticion dentro de la ventana del despacho. */
  SAME_REQUEST: 'same-request',
  /** Sin wake word cuando es obligatoria: no es un turno. */
  WAKE_REQUIRED: 'wake-required',
  /** Resultado del motor LOCAL sin evidencia acustica de habla (alucinacion de Whisper). */
  NOT_SPEECH: 'not-speech',
  /** Motivo no declarado (no deberia ocurrir; se registra en vez de callar). */
  UNKNOWN: 'unknown',
})

const KNOWN = new Set(Object.values(DISCARD_REASONS))

/** true si el motivo pertenece al vocabulario cerrado. */
export function isKnownDiscardReason(reason) {
  return KNOWN.has(String(reason || ''))
}

const clip = (value) => String(value || '').trim().slice(0, 80)

/**
 * Descarta una locucion EMITIENDO SIEMPRE su motivo. Unico sitio de descarte.
 *
 * @param {object} params
 * @param {string} params.reason Motivo del vocabulario (`DISCARD_REASONS`).
 * @param {string} [params.phrase] Locucion descartada (para el registro).
 * @param {string} [params.site] Punto del pipeline que descarta.
 * @param {(channel: string, scope: string, message: string) => void} [params.log] Relay.
 * @returns {string} `''` (valor de descarte) para que el llamador no calle por su cuenta.
 */
export function discardLocution({ reason, phrase = '', site = '', log } = {}) {
  const known = isKnownDiscardReason(reason)
  const motivo = known ? String(reason) : DISCARD_REASONS.UNKNOWN
  const emit = typeof log === 'function' ? log : () => {}
  emit(
    'WARN',
    'phraseDiscard',
    `locucion DESCARTADA motivo=${motivo}${known ? '' : ` (motivo no declarado: "${String(reason || '')}")`} site=${site || '-'} frase="${clip(phrase)}"`,
  )
  return ''
}
