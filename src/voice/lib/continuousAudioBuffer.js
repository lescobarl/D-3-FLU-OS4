/**
 * Búfer FIFO continuo de PCM: el micrófono sigue escribiendo mientras se copia un segmento al Worker.
 */
import { FLU_CONFIG } from './fluConfig.js'
import {
  getConversationMinVoicedSamples,
  getConversationSpeakerTailMs,
  getPassiveBufferMs,
  getTurnAudioOverlapMs,
  getVoiceIdentityCaptureConfig,
} from './micCapture.js'
import { flattenChunksTail } from './voiceIdentity.js'

function sumChunkLengths(chunks = []) {
  return chunks.reduce((sum, chunk) => sum + (chunk?.length || 0), 0)
}

export class ContinuousAudioBuffer {
  constructor({
    sampleRate = 48000,
    maxBufferMs = getPassiveBufferMs(),
    minRetainMs = getTurnAudioOverlapMs(),
  } = {}) {
    this.sampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000
    this.maxBufferMs =
      Number.isFinite(maxBufferMs) && maxBufferMs > 0 ? maxBufferMs : getPassiveBufferMs()
    this.minRetainMs =
      Number.isFinite(minRetainMs) && minRetainMs > 0 ? minRetainMs : getTurnAudioOverlapMs()
    this.chunks = []
    this.totalSamples = 0
    this.consumedSamples = 0
  }

  append(samples) {
    const chunk = samples instanceof Float32Array ? samples : new Float32Array(samples)
    if (!chunk.length) return
    this.chunks.push(chunk)
    this.totalSamples += chunk.length
    this._trimToMax()
  }

  getTotalSamples() {
    return this.totalSamples
  }

  getConsumedSamples() {
    return this.consumedSamples
  }

  /** Copia plana [from, to) sin vaciar el FIFO (el mic sigue acumulando). */
  copySampleRange(fromSample = 0, toSample = this.totalSamples) {
    const start = Math.max(0, Math.floor(fromSample))
    const end = Math.min(this.totalSamples, Math.floor(toSample))
    if (end <= start) return new Float32Array(0)

    const out = new Float32Array(end - start)
    let write = 0
    let cursor = 0
    for (const chunk of this.chunks) {
      const chunkStart = cursor
      const chunkEnd = cursor + chunk.length
      cursor = chunkEnd
      if (chunkEnd <= start) continue
      if (chunkStart >= end) break
      const localStart = Math.max(0, start - chunkStart)
      const localEnd = Math.min(chunk.length, end - chunkStart)
      out.set(chunk.subarray(localStart, localEnd), write)
      write += localEnd - localStart
    }
    return out
  }

  copyAllSamples() {
    return this.copySampleRange(0, this.totalSamples)
  }

  /** Ventana de turno (misma semántica que extractTurnAudioForDiarize, solo copia). */
  snapshotTurnWindow({
    turnAudioStartSample = 0,
    atTurnBoundary = false,
    minVoicedMs,
  } = {}) {
    const captureCfg = getVoiceIdentityCaptureConfig()
    const effectiveTailMs = getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary })
    const maxSamples = Math.floor(this.sampleRate * (effectiveTailMs / 1000))
    const minVoiced = Math.floor(
      minVoicedMs != null
        ? this.sampleRate * (Number(minVoicedMs) / 1000)
        : getConversationMinVoicedSamples(this.sampleRate),
    )

    const tailEnd = this.totalSamples
    const tailStart = Math.max(0, tailEnd - maxSamples)
    let window = this.copySampleRange(tailStart, tailEnd)

    if (!atTurnBoundary && captureCfg.conversationTurnAlignedDiarize !== false) {
      const turnStart = Math.max(this.consumedSamples, turnAudioStartSample)
      const turnEnd = this.totalSamples
      const turnLen = turnEnd - turnStart
      if (turnLen >= minVoiced) {
        window = this.copySampleRange(
          Math.max(turnStart, turnEnd - maxSamples),
          turnEnd,
        )
      }
    }

    return window
  }

  /** Tras commit confirmado: avanza cabeza FIFO y conserva cola de solapamiento. */
  advanceAfterCommit({ overlapMs = this.minRetainMs } = {}) {
    const overlapSamples = Math.floor(this.sampleRate * (overlapMs / 1000))
    const retainFrom = Math.max(this.consumedSamples, this.totalSamples - overlapSamples)
    this._dropThrough(retainFrom)
    this.consumedSamples = 0
    this.turnAudioStartSample = this.totalSamples
    return { overlapSamples, retainedSamples: this.totalSamples }
  }

  markTurnStart(startedAtMs) {
    this.turnAudioStartSample = this.totalSamples
    this.segmentStartedAtMs =
      Number.isFinite(startedAtMs) && startedAtMs > 0
        ? startedAtMs
        : typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()
    return this.turnAudioStartSample
  }

  getTurnStartSample() {
    return Number.isFinite(this.turnAudioStartSample) ? this.turnAudioStartSample : 0
  }

  getSegmentStartedAtMs() {
    return Number.isFinite(this.segmentStartedAtMs) ? this.segmentStartedAtMs : 0
  }

  reset() {
    this.chunks = []
    this.totalSamples = 0
    this.consumedSamples = 0
    this.turnAudioStartSample = 0
  }

  /** Vaciado inmediato al FINAL STT: descarta remanentes (cero solapamiento). */
  flushToZero(startedAtMs) {
    this.reset()
    this.markTurnStart(startedAtMs)
    return {
      flushed: true,
      totalSamples: 0,
      turnStartSample: 0,
      segmentStartedAtMs: this.segmentStartedAtMs,
    }
  }

  _trimToMax() {
    const maxSamples = Math.max(
      Math.floor(this.sampleRate * (this.minRetainMs / 1000)) + 4096,
      Math.floor(this.sampleRate * (this.maxBufferMs / 1000)),
    )
    while (this.totalSamples > maxSamples && this.chunks.length > 0) {
      const dropBudget = this.totalSamples - maxSamples
      const first = this.chunks[0]
      if (!first) break
      if (first.length <= dropBudget) {
        this.chunks.shift()
        this.totalSamples -= first.length
        this.consumedSamples = Math.max(0, this.consumedSamples - first.length)
        if (Number.isFinite(this.turnAudioStartSample)) {
          this.turnAudioStartSample = Math.max(0, this.turnAudioStartSample - first.length)
        }
      } else {
        this.chunks[0] = first.subarray(dropBudget)
        this.totalSamples -= dropBudget
        this.consumedSamples = Math.max(0, this.consumedSamples - dropBudget)
        if (Number.isFinite(this.turnAudioStartSample)) {
          this.turnAudioStartSample = Math.max(0, this.turnAudioStartSample - dropBudget)
        }
        break
      }
    }
  }

  _dropThrough(throughSample) {
    const target = Math.max(0, Math.floor(throughSample))
    if (target <= 0) return
    let cursor = 0
    while (this.chunks.length && cursor < target) {
      const first = this.chunks[0]
      const chunkEnd = cursor + first.length
      if (chunkEnd <= target) {
        this.chunks.shift()
        cursor = chunkEnd
      } else {
        const drop = target - cursor
        this.chunks[0] = first.subarray(drop)
        cursor = target
      }
    }
    this.totalSamples = sumChunkLengths(this.chunks)
    this.consumedSamples = 0
    if (Number.isFinite(this.turnAudioStartSample)) {
      this.turnAudioStartSample = Math.max(0, this.turnAudioStartSample - target)
    }
  }
}

/** Compat: refs estilo chunksRef + chunkTotalSamplesRef. */
export function bindContinuousAudioBuffer(buffer) {
  return {
    get chunksRef() {
      return { current: buffer.chunks }
    },
    get chunkTotalSamplesRef() {
      return { current: buffer.totalSamples }
    },
    get turnAudioStartSampleRef() {
      return {
        get current() {
          return buffer.getTurnStartSample()
        },
        set current(value) {
          buffer.turnAudioStartSample = Number(value) || 0
        },
      }
    },
  }
}

export function extractTurnAudioSnapshot(buffer, sampleRate, options = {}) {
  if (!buffer) return new Float32Array(0)
  return buffer.snapshotTurnWindow({
    turnAudioStartSample: options.turnAudioStartSample ?? buffer.getTurnStartSample(),
    atTurnBoundary: options.atTurnBoundary,
  })
}

/** Cola de solapamiento (ms) desde chunks legacy o ContinuousAudioBuffer. */
export function extractTurnAudioOverlapTail(chunks = [], sampleRate = 48000, overlapMs = 800) {
  if (chunks?.snapshotTurnWindow) {
    const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000
    const ms = Number.isFinite(overlapMs) && overlapMs > 0 ? overlapMs : 800
    const maxSamples = Math.floor(rate * (ms / 1000))
    return chunks.copySampleRange(Math.max(0, chunks.getTotalSamples() - maxSamples), chunks.getTotalSamples())
  }
  const tail = flattenChunksTail(chunks, Math.floor((sampleRate || 48000) * (overlapMs / 1000)))
  return tail.length ? new Float32Array(tail) : null
}
