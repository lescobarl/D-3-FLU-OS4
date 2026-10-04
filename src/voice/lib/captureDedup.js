import { sameRequestWindowMs, spokenUtteranceRevision } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'

/**
 * Dedup por captura/emision: la MISMA locucion reentregada por el ASR no es un
 * turno nuevo. Un solo criterio y una sola memoria para los dos consumidores
 * (`processCapture` y el commit temprano de la fila).
 *
 * DEFECTO MEDIDO (2026-10-03, prueba de escritorio con micro falso por el MISMO
 * camino que Chrome -onresult/onend reales-): una locucion y su reentrega 500 ms
 * despues producian 3 filas de usuario y 2 ejecuciones. Causa: el dedup por
 * captura identica se desactivaba ENTERO mientras habia un turno en curso
 * (`correctionInFlight`), que es justo cuando llega la reentrega.
 *
 * @param {{ prevText?: string, prevAt?: number, nextText?: string, nowMs?: number,
 *           correctionInFlight?: boolean, windowMs?: number }} [input]
 * @returns {'duplicate' | 'superset' | null}
 */
export function shouldSkipCapture({
  prevText = '',
  prevAt = 0,
  nextText = '',
  nowMs = 0,
  correctionInFlight = false,
  windowMs = sameRequestWindowMs(),
} = {}) {
  const next = String(nextText || '')
  const prev = String(prevText || '')
  if (!next || !prev) return null
  const ageMs = Number(nowMs || 0) - Number(prevAt || 0)
  const window = Number(windowMs) > 0 ? Number(windowMs) : sameRequestWindowMs()
  if (next === prev && ageMs < window) return 'duplicate'
  if (correctionInFlight) return null
  if (prev.length >= 20 && next.length > prev.length && next.startsWith(prev) && ageMs < 25000) {
    return 'superset'
  }
  return null
}

/**
 * La ultima emision y la nueva son la MISMA emision dentro de la ventana de "misma
 * peticion". Comparador del motor (`spokenUtteranceRevision`: pliega acentos/case y
 * pela la wake), no una comparacion nueva.
 *
 * @param {string} prevText
 * @param {string} nextText
 * @param {{ sinceMs?: number, windowMs?: number }} [options]
 * @returns {boolean}
 */
export function isSameEmissionWithinWindow(
  prevText = '',
  nextText = '',
  { sinceMs = 0, windowMs = sameRequestWindowMs() } = {},
) {
  const prev = String(prevText || '')
  const next = String(nextText || '')
  if (!prev || !next) return false
  const window = Number(windowMs) > 0 ? Number(windowMs) : sameRequestWindowMs()
  if (Number(sinceMs) >= window) return false
  return spokenUtteranceRevision(prev, next, FLU_CONFIG.voiceCommands?.wakeWords || []) === 'equal'
}

/**
 * Memoria de "esta emision ya se emitio como peticion" (idempotencia por PETICION,
 * no por turnId). El consumidor solo pregunta; el criterio y la memoria viven aqui.
 *
 * @param {{ windowMs?: number }} [options]
 * @returns {{ isRepeat: (text: string, nowMs?: number) => boolean, reset: () => void }}
 */
export function createEmissionDeduper({ windowMs = sameRequestWindowMs() } = {}) {
  let last = { text: '', at: 0 }
  return {
    isRepeat(text = '', nowMs = Date.now()) {
      const repeat = isSameEmissionWithinWindow(last.text, text, {
        sinceMs: nowMs - last.at,
        windowMs,
      })
      last = { text: String(text || ''), at: nowMs }
      return repeat
    },
    reset() {
      last = { text: '', at: 0 }
    },
  }
}
