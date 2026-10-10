/**
 * Núcleo puro de diarización por embedding (512-D WavLM-SV).
 *
 * Única fuente de verdad de: normalización L2, similitud coseno, id de hablante
 * y asignación estricta por coseno. Sin store/React (importable en Web Worker y
 * en hilo principal). Los textos configurables («Hablante N») viven en FLU_CONFIG.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { stripDiacriticsLower } from '../../lib/textUtils';

/** Etiqueta de hablante por defecto (config-driven; nunca un literal fuera de config). */
export function getFallbackSpeaker(config = FLU_CONFIG) {
  const label = config?.voiceIdentity?.labels?.fallbackSpeaker
  return String(label || '').trim() || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
}

/** Umbral del bloque conversationSpeakerThresholds (config-driven; sin literal quemado). */

/** Factor de roomCapture (config-driven; sin literal quemado). */

/** Etiqueta automática «Hablante N» desde la plantilla de config. */
export function autoSpeakerLabel(index = 1, config = FLU_CONFIG) {
  const template =
    config?.voiceIdentity?.labels?.template || FLU_CONFIG.voiceIdentity.labels.template
  return String(template).replace(/\{n\}/g, String(index))
}

/** Normalización L2 (única): vector de magnitud 1. */
export function normalizeEmbeddingVector(vector = []) {
  if (!Array.isArray(vector) || !vector.length) return []
  const out = vector.map((value) => Number(value || 0))
  let norm = 0
  for (let index = 0; index < out.length; index += 1) {
    norm += out[index] * out[index]
  }
  norm = Math.sqrt(norm) || 1
  return out.map((value) => value / norm)
}

/**
 * ¿La ventana trae VOZ (medida)? Un vector vacio o DEGENERADO (todo ceros) NO es
 * "una voz distinta": es AUSENCIA de medida, y su coseno es 0 con todo. DUENO UNICO
 * del criterio: lo consumen los DOS resolvedores vivos (el nucleo del worker
 * `assignSpeaker` y el del hilo principal `resolveProductionSpeakerAtBoundary`),
 * que antes lo tenian escrito por separado y solo uno lo protegia (medido
 * 2026-10-08: el hilo principal abria `production-forced-new-voice` con lastSim=0).
 * @param {number[]} normalized vector YA normalizado (normalizeEmbeddingVector)
 * @returns {boolean} `true` si hay al menos una componente util
 */
export function hasVoiceMeasurement(normalized = []) {
  return Array.isArray(normalized) && normalized.some((value) => Math.abs(value) > 1e-9)
}

/** Similitud coseno pura [0, 1] entre embeddings; 1 = misma identidad de voz. */
export function compareCosineSignatures(sig1 = [], sig2 = []) {
  if (!Array.isArray(sig1) || !Array.isArray(sig2) || !sig1.length || !sig2.length) {
    return 0
  }
  const dim = Math.min(sig1.length, sig2.length)
  let dot = 0
  let norm1 = 0
  let norm2 = 0
  for (let i = 0; i < dim; i += 1) {
    const a = Number(sig1[i] || 0)
    const b = Number(sig2[i] || 0)
    dot += a * b
    norm1 += a * a
    norm2 += b * b
  }
  const denom = Math.sqrt(norm1) * Math.sqrt(norm2)
  if (!denom || !Number.isFinite(denom)) return 0
  const similarity = dot / denom
  if (!Number.isFinite(similarity)) return 0
  return Math.max(0, Math.min(1, similarity))
}

/** Coincide con la etiqueta automatica «Hablante N». FUENTE UNICA del patron (antes
 * reimplementado en activeListen, fluDebug, speakerPolicy y useFluVoiceAssistant). */
export function parseSpeakerIndex(label = '') {
  const match = String(label || '').trim().match(/^Hablante\s+(\d+)$/i)
  return match ? Number(match[1]) : null
}

export function isAutoSpeakerLabel(label = '') {
  return /^Hablante\s+\d+$/i.test(String(label || '').trim())
}

/** Id estable a partir de la etiqueta de hablante («Hablante 3» → speaker_3). */
export function labelToSpeakerIdSimple(label = '') {
  const text = String(label || '').trim()
  const index = parseSpeakerIndex(text)
  if (index !== null) return `speaker_${index}`
  const slug = stripDiacriticsLower(text)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug ? `speaker_name_${slug}` : 'speaker_1'
}

/** Siguiente etiqueta automática libre (sin colisión con clusters ni reservadas). */
/**
 * DUENO UNICO del "siguiente indice libre" (etiqueta automatica NUEVA).
 *
 * Lo consume el HILO PRINCIPAL (el WORKER solo EMBEBE desde P9.57: la decision de
 * identidad tiene UN solo dueno, speakerDiarization.resolveConversationSpeaker).
 * Antes lo consumian DOS resolvedores (assignSpeaker en el worker y el del hilo
 * principal); speakerLabels.nextAvailableSpeakerLabel delega aqui. Estaba implementado DOS
 * veces (aqui y en speakerLabels) con normalizacion y tope distintos: dos duenos de la
 * MISMA decision que podian divergir (medido 2026-10-09: la misma voz abria Hablante
 * 2/3/4 segun quien resolviera).
 *
 * @param {Array} clusters clusters de la sesion
 * @param {Array} reserved etiquetas ya reservadas/conocidas
 * @param {{maxSpeakers?: number, config?: object}} [options]
 * @returns {string} etiqueta automatica libre
 */
export function nextAutoSpeakerLabel(clusters = [], reserved = [], { maxSpeakers = 0, config = FLU_CONFIG } = {}) {
  const known = new Set()
  for (const cluster of clusters) {
    const label = String(cluster?.label || '').trim()
    if (label) known.add(stripDiacriticsLower(label))
  }
  for (const label of reserved) {
    const cleaned = String(label || '').trim()
    if (cleaned) known.add(stripDiacriticsLower(cleaned))
  }
  const limit = Number(maxSpeakers) > 0 ? Number(maxSpeakers) : 9999
  for (let index = 1; index <= limit; index += 1) {
    const candidate = autoSpeakerLabel(index, config)
    if (!known.has(stripDiacriticsLower(candidate))) return candidate
  }
  return autoSpeakerLabel(limit, config)
}


