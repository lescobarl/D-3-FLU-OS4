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

/**
 * POLITICAS DE TRANSCRIPCION: constantes de DOMINIO con un solo dueno (auditoria
 * 2026-10-23). Eran literales repartidos por el pipeline (2 palabras en la caja, 24
 * caracteres en la revision, 8 palabras y 48 caracteres en speechMerge, 2 letras en la
 * clave de palabra) y cada modulo decidia por su cuenta. Se declaran aqui, una vez.
 * @returns tabla congelada de umbrales de transcripcion
 */
export function getTranscriptPolicyCfg() {
  return TRANSCRIPT_POLICY
}

const TRANSCRIPT_POLICY = Object.freeze({
  /** Palabras compartidas al arranque que acreditan "misma revision" en la caja. */
  boxStablePrefixWords: 2,
  /** Caja corta (<= N palabras): una palabra comun ya es arranque estable. */
  boxShortBoxMaxWords: 4,
  boxShortBoxPrefixWords: 1,
  /** Caracteres de prefijo comun que acreditan "misma revision" de transcripcion. */
  sameRevisionMinSharedChars: 24,
  /** Palabras minimas para buscar tartamudeo / bloque de palabras repetido. */
  stutterMinWords: 8,
  /** Longitud (caracteres) desde la que `normalizeMicText` colapsa tartamudeo. */
  stutterCharFloor: 48,
  /** Letras minimas para que dos palabras compartan clave (prefijo). */
  sameWordMinLetters: 2,
})

export function getAsrSegmentationCfg() {
  return requireConfigBlock(['transcript', 'asrSegmentation'], 'fluConfig.transcript.asrSegmentation')
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
