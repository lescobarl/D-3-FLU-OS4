/**
 * Segmentador / VAD — §9 Motor único de escucha.
 *
 * Corta el PCM continuo en turnos (silencio→voz→silencio) y emite el audio del
 * turno. Reemplaza los eventos `interim/final/onend` que antes aportaba Chrome
 * SpeechRecognition. Puro y determinista (sin Web Audio, sin red).
 *
 * Config: `FLU_CONFIG.transcript.asr.vad` (sin valores quemados en el motor).
 */
import { FLU_CONFIG } from '../fluConfig.js'

/**
 * @typedef {{ type: 'speech-start', atMs: number }} SpeechStartEvent
 * @typedef {{ type: 'speech-end', samples: Float32Array, startMs: number, durationMs: number }} SpeechEndEvent
 * @typedef {SpeechStartEvent | SpeechEndEvent} VoiceSegmentEvent
 * @typedef {{ push(samples: Float32Array): VoiceSegmentEvent[], flush(): VoiceSegmentEvent[], reset(): void }} VoiceSegmenter
 */

export function getAsrConfig() {
  return FLU_CONFIG.transcript?.asr || {}
}

export function getVadConfig() {
  return getAsrConfig().vad || {}
}

export function getAsrSampleRate(config = getAsrConfig()) {
  const rate = Number(config.targetSampleRate)
  return Number.isFinite(rate) && rate > 0 ? rate : 16000
}

function rootMeanSquare(samples) {
  if (!samples?.length) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index]
  }
  return Math.sqrt(sum / samples.length)
}

function concatFrames(frames) {
  const total = frames.reduce((acc, frame) => acc + frame.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const frame of frames) {
    out.set(frame, offset)
    offset += frame.length
  }
  return out
}

/**
 * @param {object} [config] Bloque `vad` de config.
 * @param {number} [sampleRate] Tasa del PCM entrante (Hz).
 * @returns {VoiceSegmenter}
 */
export function createVoiceSegmenter(config = getVadConfig(), sampleRate = getAsrSampleRate()) {
  const frameMs = Math.max(1, Number(config.frameMs) || 30)
  const energyThreshold = Number(config.energyThreshold) || 0.012
  const minSpeechMs = Math.max(0, Number(config.minSpeechMs) || 240)
  const minSilenceMs = Math.max(0, Number(config.minSilenceMs) || 480)
  const maxSegmentMs = Math.max(minSpeechMs + frameMs, Number(config.maxSegmentMs) || 12000)
  const preRollMs = Math.max(0, Number(config.preRollMs) || 180)

  const frameSamples = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  const minSpeechFrames = Math.max(1, Math.ceil(minSpeechMs / frameMs))
  const minSilenceFrames = Math.max(1, Math.ceil(minSilenceMs / frameMs))
  const maxSegmentFrames = Math.max(1, Math.floor(maxSegmentMs / frameMs))
  const preRollFrames = Math.max(0, Math.round(preRollMs / frameMs))

  let leftover = new Float32Array(0)
  let doneFrames = 0
  let preRoll = []
  let segmentFrames = []
  let candidateFrames = []
  let speechFrames = 0
  let silenceFrames = 0
  let inSpeech = false

  /** @type {VoiceSegmentEvent[]} */
  const events = []

  function resetTurn() {
    segmentFrames = []
    candidateFrames = []
    speechFrames = 0
    silenceFrames = 0
    inSpeech = false
  }

  function closeTurn() {
    if (!segmentFrames.length) {
      resetTurn()
      return
    }
    events.push({
      type: 'speech-end',
      samples: concatFrames(segmentFrames),
      startMs: (doneFrames - segmentFrames.length) * frameMs,
      durationMs: segmentFrames.length * frameMs,
    })
    resetTurn()
  }

  function processFrame(frame) {
    const isVoice = rootMeanSquare(frame) >= energyThreshold

    if (!inSpeech) {
      if (isVoice) {
        candidateFrames.push(frame)
        speechFrames += 1
        if (speechFrames >= minSpeechFrames) {
          inSpeech = true
          segmentFrames = [...preRoll, ...candidateFrames]
          candidateFrames = []
          silenceFrames = 0
          events.push({ type: 'speech-start', atMs: (doneFrames - segmentFrames.length) * frameMs })
        }
      } else {
        candidateFrames = []
        speechFrames = 0
        if (preRollFrames > 0) {
          preRoll.push(frame)
          if (preRoll.length > preRollFrames) preRoll.shift()
        }
      }
    } else {
      segmentFrames.push(frame)
      if (isVoice) {
        silenceFrames = 0
      } else {
        silenceFrames += 1
      }
      if (silenceFrames >= minSilenceFrames || segmentFrames.length >= maxSegmentFrames) {
        closeTurn()
        preRoll = []
      }
    }
    doneFrames += 1
  }

  function push(samples) {
    const input = samples instanceof Float32Array ? samples : new Float32Array(samples || [])
    if (!input.length) return []
    events.length = 0
    const merged = leftover.length ? concatFrames([leftover, input]) : input
    let offset = 0
    while (offset + frameSamples <= merged.length) {
      processFrame(merged.subarray(offset, offset + frameSamples))
      offset += frameSamples
    }
    leftover = offset < merged.length ? merged.slice(offset) : new Float32Array(0)
    return events.slice()
  }

  function flush() {
    events.length = 0
    if (inSpeech) closeTurn()
    leftover = new Float32Array(0)
    candidateFrames = []
    speechFrames = 0
    return events.slice()
  }

  function reset() {
    leftover = new Float32Array(0)
    doneFrames = 0
    preRoll = []
    resetTurn()
    events.length = 0
  }

  return { push, flush, reset }
}
