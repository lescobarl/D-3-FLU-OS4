/**
 * Lectores de config del motor de transcripción/ingress (sin fallbacks numéricos en código).
 * Inventario: docs/reglas-duras.md · validate-pause-config.mjs
 */
import { requireConfigBlock } from './configGuard.js'

export function getSpeakerThresholdsCfg() {
  return requireConfigBlock(['voiceIdentity', 'capture', 'conversationSpeakerThresholds'], 'fluConfig.voiceIdentity.capture.conversationSpeakerThresholds')
}

export function getIngressGuardsCfg() {
  return requireConfigBlock(['transcript', 'ingressGuards'], 'fluConfig.transcript.ingressGuards')
}

export function getSpeechMergeCfg() {
  return requireConfigBlock(['transcript', 'speechMerge'], 'fluConfig.transcript.speechMerge')
}

export function getAsrSegmentationCfg() {
  return requireConfigBlock(['transcript', 'asrSegmentation'], 'fluConfig.transcript.asrSegmentation')
}

export function getProfileMatchCfg() {
  return requireConfigBlock(['voiceIdentity', 'capture', 'profileMatch'], 'fluConfig.voiceIdentity.capture.profileMatch')
}

export function getFluTimingCfg() {
  return requireConfigBlock(['timing'], 'fluConfig.timing')
}

/** Set de palabras clave para filas cortas (speechMerge). */
export function getShortFinalKeywordSet() {
  const cfg = getSpeechMergeCfg()
  const list = Array.isArray(cfg.shortFinalKeywords) ? cfg.shortFinalKeywords : []
  return new Set(list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))
}
