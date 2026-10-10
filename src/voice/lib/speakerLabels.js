/**
 * Etiquetas y nombres de hablante: parseo, normalización, orden y siguiente libre.
 * Única fuente de la plantilla «Hablante N» (config-driven, sin hardcode).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { normalizeSpaces, stripDiacritics } from './audioMath.js'
import { getFallbackSpeaker, isAutoSpeakerLabel, nextAutoSpeakerLabel, parseSpeakerIndex } from './speakerCore.js'

export { isAutoSpeakerLabel, parseSpeakerIndex } from './speakerCore.js'

export function getVoiceIdentityConfig(config = FLU_CONFIG) {
  return config.voiceIdentity || FLU_CONFIG.voiceIdentity
}

export function foldSpeakerKey(label = '') {
  return stripDiacritics(normalizeSpaces(label)).toLowerCase()
}

/** Nombre propio registrado (no «Hablante N»). */
export function isRegisteredSpeakerLabel(label = '') {
  const text = String(label || '').trim()
  return Boolean(text) && !isAutoSpeakerLabel(text)
}

/**
 * Nombre propio de PERSONA: ni la etiqueta automatica "Hablante N" ni el motor
 * de dialogo (FLU). Criterio unico para decidir si una etiqueta puede estamparse
 * como identidad sin evidencia (regla requireWakeWordForSpeakerName).
 */
export function isProperSpeakerName(label = '') {
  const text = normalizeSpeakerLabel(label)
  if (!text) return false
  if (text.toLowerCase() === 'flu') return false
  return !isAutoSpeakerLabel(text)
}

/** Corrige etiquetas corruptas «Hablante N / Hablante M / …» → un solo hablante. */
export function normalizeSpeakerLabel(label = '') {
  const text = normalizeSpaces(label)
  if (!text) return ''
  const lower = text.toLowerCase()
  if (lower === 'true' || lower === 'false' || lower === 'null' || lower === 'undefined') return ''
  if (!text.includes('/')) return text

  const parts = text
    .split('/')
    .map((part) => normalizeSpaces(part))
    .filter(Boolean)
  const hablantes = parts.filter((part) => isAutoSpeakerLabel(part))
  if (hablantes.length) return hablantes[hablantes.length - 1]
  return parts[parts.length - 1] || text
}

export function expandSessionSpeakerNames(label = '') {
  const text = normalizeSpaces(label)
  if (!text) return []
  if (!text.includes('/')) return [text]
  return text
    .split('/')
    .map((part) => normalizeSpaces(part))
    .filter(Boolean)
}

/** Primer índice libre (Hablante N, N+1, …) sin saltos por clusters fantasma. */
/**
 * CONSUMIDOR del DUENO UNICO (speakerCore.nextAutoSpeakerLabel): conserva la firma
 * historica (opciones con maxSpeakers) SIN reimplementar la decision.
 */
export function nextAvailableSpeakerLabel(
  clusters = [],
  extraLabels = [],
  { maxSpeakers = 0, config = FLU_CONFIG } = {},
) {
  return nextAutoSpeakerLabel(clusters, extraLabels, { maxSpeakers, config })
}

/** Quita clusters Hablante N que nunca aparecieron en el log ni son activos. */
export function pruneGhostSpeakerClusters(
  clusters = [],
  committedLabels = [],
  { keepLabels = [] } = {},
) {
  const keep = new Set(
    [...committedLabels, ...keepLabels]
      .map((label) => foldSpeakerKey(label))
      .filter(Boolean),
  )
  return clusters.filter((cluster) => {
    const label = String(cluster?.label || '').trim()
    if (!label) return false
    if (!isAutoSpeakerLabel(label)) return true
    return keep.has(foldSpeakerKey(label))
  })
}

export function sortSessionSpeakers(speakers = []) {
  const numbered = []
  const custom = []
  for (const name of speakers) {
    const index = parseSpeakerIndex(name)
    if (index !== null) numbered.push({ name, index })
    else custom.push(name)
  }
  numbered.sort((a, b) => a.index - b.index)
  custom.sort((a, b) => String(a).localeCompare(String(b), 'es'))
  return [...numbered.map((entry) => entry.name), ...custom]
}

export function formatSpeakerLabel(label = '', confidence = 'medium', config = getVoiceIdentityConfig()) {
  const suffix = config.confidence?.display?.[confidence] ?? ''
  const normalized = normalizeSpeakerLabel(normalizeSpaces(label))
  if (!normalized) return getFallbackSpeaker(config)
  return suffix ? `${normalized} ${suffix}` : normalized
}

/**
 * P8.40 - Etiqueta de diarizacion -> NOMBRE de la persona. El panel de participantes
 * ya guarda ese vinculo (A3, speakerLabel): si el hablante resuelto es una etiqueta
 * AUTOMATICA ("Hablante N") y coincide con la etiqueta registrada del participante
 * activo, la fila lleva su NOMBRE. Un nombre propio ya resuelto nunca se pisa y una
 * etiqueta no registrada (los ninos del aula) queda como esta: no hace falta
 * heuristica de cluster.
 *
 * @param {string} label Etiqueta resuelta por la diarizacion.
 * @param {{ registeredLabel?: string, registeredName?: string }} [registered]
 * @returns {string} Nombre de la persona, o '' si no hay vinculo.
 */
export function resolveRegisteredSpeakerName(label = '', { registeredLabel = '', registeredName = '' } = {}) {
  const text = normalizeSpeakerLabel(label)
  const name = normalizeSpeakerLabel(registeredName)
  if (!text || !name) return ''
  if (!isAutoSpeakerLabel(text)) return ''
  const registered = normalizeSpeakerLabel(registeredLabel)
  if (!registered || foldSpeakerKey(registered) !== foldSpeakerKey(text)) return ''
  return name
}
