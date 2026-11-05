/**
 * Segmentador / VAD — §9 Motor único de escucha.
 *
 * Corta el PCM continuo en turnos (silencio→voz→silencio) y emite el audio del
 * turno. Reemplaza los eventos `interim/final/onend` que antes aportaba Chrome
 * SpeechRecognition. Puro y determinista (sin Web Audio, sin red).
 *
 * Config: `FLU_CONFIG.transcript.asr.vad` (sin valores quemados en el motor).
 */
import { getAsrConfig, getVadSegmentConfig } from './asrConfig.js'

// El dueno de la lectura de la config del ASR es asrConfig.js; se re-exporta para no
// cambiar la API del segmentador (lo consumen el worker y los tests).
export { getAsrConfig }
import { DEFAULT_TARGET_SAMPLE_RATE } from '../audioConstants.js'
import { concatFloat32 } from '../pcmChunks.js'
import { countSpeechLikeSamples, frameSamplesFor, isVoicedFrame } from '../voicedActivity.js'

/**
 * @typedef {{ type: 'speech-start', atMs: number }} SpeechStartEvent
 * @typedef {{ type: 'speech-end', samples: Float32Array, startMs: number, durationMs: number, speechLikeMs: number }} SpeechEndEvent
 * @typedef {SpeechStartEvent | SpeechEndEvent} VoiceSegmentEvent
 * @typedef {{ push(samples: Float32Array): VoiceSegmentEvent[], flush(): VoiceSegmentEvent[], reset(): void }} VoiceSegmenter
 */



export function getVadConfig() {
  return getAsrConfig().vad || {}
}

export function getAsrSampleRate(config = getAsrConfig()) {
  const rate = Number(config.targetSampleRate)
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_TARGET_SAMPLE_RATE
}

/**
 * @param {object} [config] Bloque `vad` de config.
 * @param {number} [sampleRate] Tasa del PCM entrante (Hz).
 * @returns {VoiceSegmenter}
 */export function createVoiceSegmenter(config = getVadConfig(), sampleRate = getAsrSampleRate()) {
  // Un solo lector del bloque de segmentacion (respaldos en `VAD_DEFAULTS`): el
  // `0` legitimo se respeta (`preRollMs: 0` = sin pre-roll, no "sin valor").
  const segmentCfg = getVadSegmentConfig(config)
  const frameMs = segmentCfg.frameMs
  const energyThreshold = segmentCfg.energyThreshold
  const minSpeechMs = segmentCfg.minSpeechMs
  const minSilenceMs = segmentCfg.minSilenceMs
  const maxSegmentMs = Math.max(minSpeechMs + frameMs, segmentCfg.maxSegmentMs)
  const preRollMs = segmentCfg.preRollMs

  const frameSamples = frameSamplesFor(sampleRate, frameMs)
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
    const samples = concatFloat32(segmentFrames)
    events.push({
      type: 'speech-end',
      samples,
      startMs: (doneFrames - segmentFrames.length) * frameMs,
      durationMs: segmentFrames.length * frameMs,
      // Evidencia de HABLA del turno (RMS + ZCR + modulacion, dueno unico
      // `voicedActivity`): la consume el motor local para el gate de finales.
      // NO cambia el criterio de apertura/cierre (que sigue siendo energia),
      // para no romper la segmentacion ya medida.
      speechLikeMs: (countSpeechLikeSamples(samples, { sampleRate }) / Math.max(1, sampleRate)) * 1000,
    })
    resetTurn()
  }

  function processFrame(frame) {
    const isVoice = isVoicedFrame(frame, 0, frame.length, energyThreshold)

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
    const merged = leftover.length ? concatFloat32([leftover, input]) : input
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

/**
 * TRAMOS de un PCM completo: [{ inicioMs, finMs }] por locución (silencio→voz→silencio).
 *
 * Es el dueño único de "dónde empieza y dónde acaba cada locución" para consumidores que
 * no empujan audio en vivo (el portero del tramo, el playback, los tests). En vivo se usa
 * `createVoiceSegmenter` directamente; aquí solo se le da de comer el PCM por bloques.
 *
 * @param {Float32Array} samples PCM mono
 * @param {number} sampleRate tasa del PCM (Hz)
 * @param {object} [config] bloque `vad` de config (por defecto el de la app)
 * @returns {Array<{ inicioMs: number, finMs: number }>}
 */
export function tramosDeAudio(samples, sampleRate, config = undefined) {
  if (!samples || !samples.length || !(sampleRate > 0)) return []
  const segmenter = createVoiceSegmenter(config, sampleRate)
  const salida = []
  const bloque = Math.max(1, Math.round(sampleRate * 0.5))
  const recoger = (eventos) => {
    for (const evento of eventos || []) {
      if (evento.type !== 'speech-end') continue
      salida.push({ inicioMs: evento.startMs, finMs: evento.startMs + evento.durationMs })
    }
  }
  for (let i = 0; i < samples.length; i += bloque) {
    recoger(segmenter.push(samples.subarray(i, Math.min(samples.length, i + bloque))))
  }
  recoger(segmenter.flush())
  return salida
}
