/**
 * Restricciones y ganancia del micrófono (config central, sin hardcode).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'

export function getConversationAudioConfig(config = FLU_CONFIG) {
  return config.voiceIdentity?.capture?.conversationAudio || {}
}

/** RMS lineal desde dBFS (p. ej. -45 → ~0.0056). */
export function dbToLinearRms(db) {
  return Math.pow(10, Number(db) / 20)
}

/** Umbral adaptativo de voz (prioriza silenceThresholdDb; legacy voiceDetectionThreshold). */
export function getSilenceThresholdLinear(config = FLU_CONFIG) {
  const audio = getConversationAudioConfig(config)
  const legacy = Number(audio.voiceDetectionThreshold)
  if (Number.isFinite(legacy) && legacy > 0 && audio.silenceThresholdDb == null) {
    return legacy
  }
  return dbToLinearRms(Number(audio.silenceThresholdDb))
}

export function getVoiceDetectionThreshold(config = FLU_CONFIG) {
  return getSilenceThresholdLinear(config)
}

export function getVoiceHoldMs(config = FLU_CONFIG) {
  return Number(getConversationAudioConfig(config).voiceHoldMs)
}

/** Ventanas de silencio en segmentAudio (hop ~20 ms). */
export function getMaxSilenceWindowsForHold(_sampleRate = DEFAULT_SAMPLE_RATE, config = FLU_CONFIG) {
  const hopMs = 20
  const voiceHoldMs = getVoiceHoldMs(config)
  return Math.max(4, Math.ceil(voiceHoldMs / hopMs))
}

export function getVoiceIdentityCaptureConfig(config = FLU_CONFIG) {
  return config.voiceIdentity?.capture || {}
}

export function getPassiveBufferMs(config = FLU_CONFIG) {
  const capture = config.voiceIdentity?.capture ?? config.capture ?? {}
  return Number(capture.passiveBufferMs)
}

export function getTurnAudioOverlapMs(config = FLU_CONFIG) {
  return Number(config.transcript?.turnAudioOverlapMs)
}

export function getConversationSpeakerTailMs(config = FLU_CONFIG, { atTurnBoundary = false } = {}) {
  const capture = getVoiceIdentityCaptureConfig(config)
  const tailMs = Number(capture.conversationSpeakerTailMs)
  if (!atTurnBoundary) return tailMs
  const room = capture.roomCapture || {}
  const classroomCap = Number(room.classroomTurnBoundaryTailCapMs)
  if (room.classroomMultiSpeaker === true && Number.isFinite(classroomCap) && classroomCap > 0) {
    return Math.min(tailMs, classroomCap)
  }
  const cap = Number(capture.turnBoundaryTailCapMs)
  const boundaryCap = Number.isFinite(cap) && cap > 0 ? cap : tailMs
  return Math.min(tailMs, boundaryCap)
}

export function getConversationMinVoicedSamples(sampleRate, config = FLU_CONFIG) {
  const ms = Number(getVoiceIdentityCaptureConfig(config).conversationMinVoicedMs)
  return Math.floor(sampleRate * (ms / 1000))
}

export function getConversationMinVoicedForNewSamples(sampleRate, config = FLU_CONFIG) {
  const capture = getVoiceIdentityCaptureConfig(config)
  const room = capture.roomCapture || {}
  let ms = Number(capture.conversationMinVoicedForNewMs)
  if (room.classroomMultiSpeaker === true) {
    const classroomMs = Number(room.classroomMinVoicedForNewMs)
    if (Number.isFinite(classroomMs) && classroomMs > 0) ms = classroomMs
  }
  return Math.floor(sampleRate * (ms / 1000))
}

export function getDiarizeIntervalMs(config = FLU_CONFIG) {
  return Number(config.activeListen?.speakers?.diarizeIntervalMs)
}

export function getLastTurnSignatureContinuityDistance(config = FLU_CONFIG) {
  return Number(
    getVoiceIdentityCaptureConfig(config).conversationSpeakerThresholds
      ?.lastTurnSignatureContinuityDistance,
  )
}

/**
 * Constraints del microfono (fuente unica de la decision).
 *
 * `maxSensitivity` (config) extiende la captura de SALA tambien FUERA de la
 * conversacion: antes solo se aplicaba con la conversacion activa, asi que en
 * escucha pasiva el navegador metia AGC/NS/EC y atenuaba las voces lejanas del
 * aula ("se pierde conversacion"). `roomCapture` manda como siempre.
 */
export function resolveCaptureAudioConstraints({
  conversationActive = false,
  roomCapture = false,
  maxSensitivity = false,
  audio = getConversationAudioConfig(),
} = {}) {
  const raw = Boolean(roomCapture) || (!conversationActive && Boolean(maxSensitivity))
  if (!conversationActive && !raw) {
    return { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  }
  return {
    echoCancellation: raw ? (audio?.echoCancellation ?? false) : true,
    noiseSuppression: raw ? (audio?.noiseSuppression ?? false) : true,
    autoGainControl: raw ? (audio?.autoGainControl ?? false) : true,
  }
}

/** Ganancia digital del micro (mayor = mas sensible); 1 = sin refuerzo. */
export function resolveCaptureGain({
  conversationActive = false,
  maxSensitivity = false,
  audio = getConversationAudioConfig(),
} = {}) {
  if (!conversationActive && !maxSensitivity) return 1
  return Number(audio?.captureGain) || 8
}
