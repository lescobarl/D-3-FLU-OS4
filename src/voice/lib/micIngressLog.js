/**
 * Panel mic izquierdo: reflejo crudo del Productor (STT sin filtrar).
 * La conversación y ÚLTIMA FRASE las alimenta exclusivamente el Consumidor vía React state.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { appendFluMicLogLine } from './fluDevConsole.js'

let producerSeq = 0

export function isMicIngressLogEnabled() {
  if (typeof window === 'undefined') return true
  if (window.__FLU_MIC_INGRESS_LOG === false) return false
  if (window.__FLU_MIC_INGRESS_LOG === true) return true
  return FLU_CONFIG.debug?.micIngressLog !== false
}

/**
 * Log crudo del Productor — cada fragmento STT encolado, sin lógica de descarte.
 * @param {{ source?: 'browser'|'stream'|'heartbeat', kind?: 'interim'|'final', text?: string }} entry
 */
export function logMicProducerRaw({ source = 'browser', kind = 'interim', text = '' } = {}) {
  if (!isMicIngressLogEnabled()) return

  const phrase = String(text ?? '').trim()
  if (!phrase) return

  producerSeq += 1
  appendFluMicLogLine({
    seq: producerSeq,
    source,
    kind,
    published: phrase,
    raw: '',
    note: '',
  })

  if (FLU_CONFIG.debug?.micIngressConsole !== false && typeof console !== 'undefined') {
    console.info(`[Flu][mic-producer] #${producerSeq} [${source}] ${kind}`, phrase)
  }
}

/** @deprecated Consumidor ya no escribe en el panel mic; usar logMicProducerRaw. */
export function logMicIngress() {}

export function resetMicIngressLogSeq() {
  producerSeq = 0
}
