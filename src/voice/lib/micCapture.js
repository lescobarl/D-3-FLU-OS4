/**
 * Restricciones y ganancia del micrófono (config central, sin hardcode).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { optionalConfigBlock } from './configGuard.js'

/**
 * Bloque de audio de conversacion de la captura (o `{}`).
 * @param {typeof FLU_CONFIG} [config]
 * @returns {NonNullable<typeof FLU_CONFIG.voiceIdentity>['capture']['conversationAudio']}
 */
export function getConversationAudioConfig(config = FLU_CONFIG) {
  return optionalConfigBlock(config, ['voiceIdentity', 'capture', 'conversationAudio'])
}

/**
 * Bloque de captura de identidad (o `{}`).
 * @param {typeof FLU_CONFIG} [config]
 * @returns {NonNullable<typeof FLU_CONFIG.voiceIdentity>['capture']}
 */
export function getVoiceIdentityCaptureConfig(config = FLU_CONFIG) {
  return optionalConfigBlock(config, ['voiceIdentity', 'capture'])
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
  // UN cap (un dato = una clave): el mismo techo sirve para aula y no-aula.
  const cap = Number(capture.turnBoundaryTailCapMs)
  const boundaryCap = Number.isFinite(cap) && cap > 0 ? cap : tailMs
  return Math.min(tailMs, boundaryCap)
}

export function getConversationMinVoicedSamples(sampleRate, config = FLU_CONFIG) {
  const ms = Number(getVoiceIdentityCaptureConfig(config).conversationMinVoicedMs)
  return Math.floor(sampleRate * (ms / 1000))
}

export function getConversationMinVoicedForNewSamples(sampleRate, config = FLU_CONFIG) {
  const ms = Number(getVoiceIdentityCaptureConfig(config).conversationMinVoicedForNewMs)
  return Math.floor(sampleRate * (ms / 1000))
}

export function getDiarizeIntervalMs(config = FLU_CONFIG) {
  return Number(config.activeListen?.speakers?.diarizeIntervalMs)
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
  // La ganancia tiene UN dueno: `voiceIdentity.capture.conversationAudio.captureGain`
  // (fluConfig). Si el bloque faltara, se devuelve 1 (NEUTRA): inventar un 8 dejaba la
  // captura 3,7x por debajo de la configurada y nadie lo veia (auditoria 2026-10-22).
  const ganancia = Number(audio?.captureGain)
  return Number.isFinite(ganancia) && ganancia > 0 ? ganancia : 1
}
