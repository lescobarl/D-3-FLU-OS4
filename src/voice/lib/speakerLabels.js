/**
 * Etiquetas y nombres de hablante: parseo, normalización, orden y siguiente libre.
 * Única fuente de la plantilla «Hablante N» (config-driven, sin hardcode).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { normalizeSpaces, stripDiacritics } from './audioMath.js'
import { autoSpeakerLabel, getFallbackSpeaker } from './speakerCore.js'

export function getVoiceIdentityConfig(config = FLU_CONFIG) {
  return config.voiceIdentity || FLU_CONFIG.voiceIdentity
}

export function foldSpeakerKey(label = '') {
  return stripDiacritics(normalizeSpaces(label)).toLowerCase()
}

export function parseSpeakerIndex(label = '') {
  const match = String(label || '').match(/^Hablante\s+(\d+)$/i)
  return match ? Number(match[1]) : null
}

export function isAutoSpeakerLabel(label = '') {
  return /^Hablante\s+\d+$/i.test(String(label || '').trim())
}

/** Nombre propio registrado (no «Hablante N»). */
export function isRegisteredSpeakerLabel(label = '') {
  const text = String(label || '').trim()
  return Boolean(text) && !isAutoSpeakerLabel(text)
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
export function nextAvailableSpeakerLabel(
  clusters = [],
  extraLabels = [],
  { maxSpeakers = 0, config = FLU_CONFIG } = {},
) {
  const known = new Set()
  for (const cluster of clusters) {
    const label = String(cluster?.label || '').trim()
    if (label) known.add(foldSpeakerKey(label))
  }
  for (const label of extraLabels) {
    const cleaned = String(label || '').trim()
    if (cleaned) known.add(foldSpeakerKey(cleaned))
  }
  const limit = maxSpeakers > 0 ? maxSpeakers : 9999
  for (let index = 1; index <= limit; index += 1) {
    const candidate = autoSpeakerLabel(index, config)
    if (!known.has(foldSpeakerKey(candidate))) return candidate
  }
  return autoSpeakerLabel(limit, config)
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
