/**
 * Ciclo de vida del búfer de audio por turno: avance FIFO tras log confirmado + solapamiento.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { extractTurnAudioOverlapTail } from './continuousAudioBuffer.js'

export { extractTurnAudioOverlapTail } from './continuousAudioBuffer.js'

export const DEFAULT_TURN_AUDIO_OVERLAP_MS = 800

export function resolveTurnAudioOverlapMs(context = {}) {
  if (context.preserveOverlapMs === 0) return 0
  if (Number.isFinite(context.preserveOverlapMs) && context.preserveOverlapMs > 0) {
    return context.preserveOverlapMs
  }
  return Number(FLU_CONFIG.transcript?.turnAudioOverlapMs) || DEFAULT_TURN_AUDIO_OVERLAP_MS
}

/**
 * Ejecuta callback tras pintado (doble rAF).
 *
 * FIX pérdida/lag de transcripción: si el hilo principal queda BLOQUEADO (p. ej.
 * parseo síncrono de FBX que congela el rAF 10-20s), el doble rAF difiere el
 * commit indefinidamente y los turnos se acumulan/retrasan (se percibe como
 * "pérdida de transcripción"). Se añade un fallback por timeout: si el doble
 * rAF no llega a pintar en < 250ms, se commitea igual vía setTimeout. En Node
 * usa microtask.
 */
export function scheduleAfterLogPainted(callback) {
  if (typeof callback !== 'function') return
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    let done = false
    const flush = () => {
      if (done) return
      done = true
      callback()
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(flush))
    // Fallback anti-freeze: si el doble rAF no pinta en < 250ms (hilo bloqueado
    // por un long task), commitear igual para no perder/retrasar transcripción.
    window.setTimeout(flush, 250)
    return
  }
  queueMicrotask(callback)
}

/**
 * Avanza cabecera del FIFO continuo tras commit en UI (no detiene captura del mic).
 */
export function purgeTurnAudioBufferAfterLogCommit({
  audioBuffer = null,
  chunksRef = null,
  chunkTotalSamplesRef = null,
  turnAudioStartSampleRef = null,
  sampleRate = 48000,
  preserveOverlapMs = 0,
} = {}) {
  const overlapMs = resolveTurnAudioOverlapMs({ preserveOverlapMs })

  if (audioBuffer && typeof audioBuffer.advanceAfterCommit === 'function') {
    const result = audioBuffer.advanceAfterCommit({ overlapMs })
    if (turnAudioStartSampleRef) {
      turnAudioStartSampleRef.current =
        typeof audioBuffer.getTurnStartSample === 'function' ? audioBuffer.getTurnStartSample() : 0
    }
    if (chunkTotalSamplesRef) {
      chunkTotalSamplesRef.current =
        typeof audioBuffer.getTotalSamples === 'function' ? audioBuffer.getTotalSamples() : 0
    }
    return {
      purged: true,
      overlapSamples: result.overlapSamples,
      overlapMs: overlapMs > 0 ? overlapMs : 0,
    }
  }

  if (!chunksRef) return { purged: false, overlapSamples: 0 }

  const overlap =
    overlapMs > 0 ? extractTurnAudioOverlapTail(chunksRef.current, sampleRate, overlapMs) : null

  chunksRef.current = overlap ? [overlap] : []
  if (chunkTotalSamplesRef) {
    chunkTotalSamplesRef.current = overlap?.length || 0
  }
  if (turnAudioStartSampleRef) {
    turnAudioStartSampleRef.current = 0
  }

  return {
    purged: true,
    overlapSamples: overlap?.length || 0,
    overlapMs: overlapMs > 0 ? overlapMs : 0,
  }
}
