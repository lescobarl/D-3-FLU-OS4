/**
 * Núcleo puro de diarización por embedding (512-D WavLM-SV).
 *
 * Única fuente de verdad de: normalización L2, similitud coseno, id de hablante
 * y asignación estricta por coseno. Sin store/React (importable en Web Worker y
 * en hilo principal). Los textos configurables («Hablante N») viven en FLU_CONFIG.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { stripDiacriticsLower } from '../../lib/textUtils.ts';

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

/**
 * Etiqueta ANONIMA de la sesion: `Hablante N` o la etiqueta PENDIENTE
 * (`voiceIdentity.labels.pendingSpeaker`). Las dos son agrupaciones sin identidad,
 * asi que ninguna puede afirmar ni heredar un nombre propio.
 */
export function isAutoSpeakerLabel(label = '', config = FLU_CONFIG) {
  const text = String(label || '').trim()
  if (/^Hablante\s+\d+$/i.test(text)) return true
  const pending = String(config?.voiceIdentity?.labels?.pendingSpeaker || '').trim()
  return Boolean(pending) && text.toLowerCase() === pending.toLowerCase()
}

/** Id estable a partir de la etiqueta de hablante («Hablante 3» → speaker_3). */
export function labelToSpeakerIdSimple(label = '') {
  const text = String(label || '').trim()
  const index = parseSpeakerIndex(text)
  if (index !== null) return `speaker_${index}`
  // Etiqueta PENDIENTE (config): clave propia y estable. NO es un nombre propio, asi que
  // no puede acabar en `speaker_name_*` (eso la haria competir como identidad).
  if (isAutoSpeakerLabel(text)) return 'speaker_pending'
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
 * @param {{maxSpeakers?: number, config?: object, highWater?: number}} [options]
 * @returns {string} etiqueta automatica libre
 */
/**
 * Indice automatico de una CLAVE de voz (`speaker_3` -> 3). `null` si la clave no es
 * automatica (p. ej. `speaker_name_luis`).
 *
 * @param {string} key
 * @returns {number|null}
 */
export function autoSpeakerIndexFromKey(key = '') {
  const match = String(key || '').trim().match(/^speaker_(\d+)$/)
  return match ? Number(match[1]) : null
}

/**
 * HIGH-WATER de la sesion: el indice automatico mas alto ya usado.
 *
 * Se deriva de DATOS (no de un contador duplicado): clusters (`autoNumber`/etiqueta),
 * etiquetas reservadas y las filas del epoch. La fila conserva la clave aunque se borre
 * el hablante del panel o se poden clusters fantasma, asi que el numero NO se reutiliza.
 *
 * @param {{ rows?: Array<object>, clusters?: Array<object>, reserved?: Iterable<string>, epoch?: number|null }} [m]
 * @returns {number} indice mas alto (0 si no hay ninguno).
 */
export function sessionSpeakerHighWater({ rows = [], clusters = [], reserved = [], epoch = null } = {}) {
  let highest = 0
  const note = (value) => {
    const index = Number(value)
    if (Number.isFinite(index) && index > highest) highest = index
  }
  for (const cluster of clusters || []) {
    note(parseSpeakerIndex(cluster?.label))
    note(cluster?.autoNumber)
  }
  for (const label of reserved || []) note(parseSpeakerIndex(label))
  const sameEpoch = (row) => epoch == null || Number(row?.epoch) === Number(epoch)
  for (const row of rows || []) {
    if (!sameEpoch(row)) continue
    note(autoSpeakerIndexFromKey(row?.speakerId))
    note(parseSpeakerIndex(row?.speakerName))
  }
  return highest
}

export function nextAutoSpeakerLabel(clusters = [], reserved = [], { maxSpeakers = 0, config = FLU_CONFIG, highWater = 0 } = {}) {
  const known = new Set()
  // HIGH-WATER de sesion (dato): el siguiente numero es max+1 y NUNCA reutiliza uno ya
  // usado, aunque su dueno se haya renombrado, borrado o podado. `highWater` lo aporta
  // el dueno de la sesion (`sessionSpeakerHighWater` / store); el indice sobrevive al
  // renombre en `cluster.autoNumber` (`mergeSpeakerClustersOnRename`).
  let highest = Math.max(0, Number(highWater) || 0)
  const noteIndex = (label) => {
    const index = parseSpeakerIndex(String(label || ''))
    if (index != null) highest = Math.max(highest, index)
  }
  for (const cluster of clusters) {
    const label = String(cluster?.label || '').trim()
    if (label) known.add(stripDiacriticsLower(label))
    noteIndex(label)
    const number = Number(cluster?.autoNumber)
    if (Number.isFinite(number) && number > 0) highest = Math.max(highest, number)
  }
  for (const label of reserved) {
    const cleaned = String(label || '').trim()
    if (cleaned) known.add(stripDiacriticsLower(cleaned))
    noteIndex(cleaned)
  }
  const limit = Number(maxSpeakers) > 0 ? Number(maxSpeakers) : 9999
  for (let index = highest + 1; index <= limit; index += 1) {
    const candidate = autoSpeakerLabel(index, config)
    if (!known.has(stripDiacriticsLower(candidate))) return candidate
  }
  return autoSpeakerLabel(limit, config)
}

/**
 * FASE 0 (diarizacion, 2026-10-14): payload de la sonda de SEPARACION del turno.
 * Devuelve la calidad de la ventana (ms, rms) y el coseno del vector del turno contra
 * CADA cluster de la sesion (top 4, ordenado). Dueno unico del coseno y de la L2: este modulo.
 */
export function payloadSeparacionDeTurno(vector = [], clusters = [], snapshot = [], sampleRate = 0) {
  const v = normalizeEmbeddingVector(Array.isArray(vector) ? vector : [])
  const pares = (Array.isArray(clusters) ? clusters : [])
    .filter((c) => Array.isArray(c?.signature) && c.signature.length)
    .map((c) => ({ label: String(c?.label || ''), sim: Number(compareCosineSignatures(v, normalizeEmbeddingVector(c.signature)).toFixed(3)) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 4)
  const m = snapshot && snapshot.length !== undefined ? snapshot : []
  let suma = 0
  for (let i = 0; i < m.length; i += 1) suma += m[i] * m[i]
  const rms = m.length ? Number(Math.sqrt(suma / m.length).toFixed(5)) : 0
  const ms = sampleRate ? Math.round((m.length / sampleRate) * 1000) : 0
  return { ms, rms, pares }
}
