/**
 * Lectores de config del motor de transcripción/ingress (sin fallbacks numéricos en código).
 * Inventario: docs/reglas-duras.md · validate-pause-config.mjs
 */
import { FLU_CONFIG } from './fluConfig.js'

export const INGRESS_GUARDS_KEYS = [
  'forceNewRowShortFinalMaxWords',
  'novelWordMinCount',
  'novelWordMinTextLength',
  'alternateNewRowMinLength',
]

export const SPEECH_MERGE_KEYS = [
  'shortFinalKeywords',
  'minKeywordConfidence',
  'shortFinalMaxWords',
  'shortFinalKeywordMinChars',
]

export function getSpeakerThresholdsCfg() {
  const cfg = FLU_CONFIG.voiceIdentity?.capture?.conversationSpeakerThresholds
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('fluConfig.voiceIdentity.capture.conversationSpeakerThresholds es obligatorio')
  }
  return cfg
}

export function getIngressGuardsCfg() {
  const cfg = FLU_CONFIG.transcript?.ingressGuards
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('fluConfig.transcript.ingressGuards es obligatorio')
  }
  return cfg
}

export function getSpeechMergeCfg() {
  const cfg = FLU_CONFIG.transcript?.speechMerge
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('fluConfig.transcript.speechMerge es obligatorio')
  }
  return cfg
}

export function getAsrSegmentationCfg() {
  const cfg = FLU_CONFIG.transcript?.asrSegmentation
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('fluConfig.transcript.asrSegmentation es obligatorio')
  }
  return cfg
}

export function getProfileMatchCfg() {
  const cfg = FLU_CONFIG.voiceIdentity?.capture?.profileMatch
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('fluConfig.voiceIdentity.capture.profileMatch es obligatorio')
  }
  return cfg
}

export function getFluTimingCfg() {
  const cfg = FLU_CONFIG.timing
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('fluConfig.timing es obligatorio')
  }
  return cfg
}

export function listConfiguredIngressGuardsRules() {
  const cfg = getIngressGuardsCfg()
  return INGRESS_GUARDS_KEYS.filter((key) => key in cfg).map((key) => ({
    key,
    value: cfg[key],
    source: 'fluConfig.transcript.ingressGuards',
  }))
}

export function listConfiguredSpeechMergeRules() {
  const cfg = getSpeechMergeCfg()
  return SPEECH_MERGE_KEYS.filter((key) => key in cfg).map((key) => ({
    key,
    value: cfg[key],
    source: 'fluConfig.transcript.speechMerge',
  }))
}

/** Set de palabras clave para filas cortas (speechMerge). */
export function getShortFinalKeywordSet() {
  const cfg = getSpeechMergeCfg()
  const list = Array.isArray(cfg.shortFinalKeywords) ? cfg.shortFinalKeywords : []
  return new Set(list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))
}
