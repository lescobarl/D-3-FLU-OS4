/**
 * Dueño único de la configuración de captura para identidad de voz.
 *
 * El core (Node) y el Web Worker mantenían cada uno su copia de estos cuatro
 * lectores, con los mismos fallbacks escritos dos veces: corregir uno no
 * corregía el otro. El cliente del worker tenía una tercera copia del lector
 * de configuración. Aquí el valor vive una sola vez.
 */
import { FLU_CONFIG } from './fluConfig.js'

/** Tasa objetivo del pipeline de embeddings (Hz). */
export const DEFAULT_TARGET_SAMPLE_RATE = 16000

/** Fracción mínima de muestras para aceptar un embedding. */
export const DEFAULT_MIN_SAMPLE_RATIO = 0.35

export function getEmbeddingConfig() {
  return FLU_CONFIG.voiceIdentity?.capture?.embedding || {}
}

export function getModelId(cfg = getEmbeddingConfig()) {
  return cfg.modelId
}

export function getTargetSampleRate(cfg = getEmbeddingConfig()) {
  const rate = Number(cfg.targetSampleRate)
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_TARGET_SAMPLE_RATE
}

export function getMinSamples(cfg = getEmbeddingConfig()) {
  const ratio = Number(cfg.minSampleRatio)
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_MIN_SAMPLE_RATIO
  return Math.floor(getTargetSampleRate(cfg) * safeRatio)
}
