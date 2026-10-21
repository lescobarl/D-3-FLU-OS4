/**
 * Etiquetas y nombres de hablante: parseo, normalización, orden y siguiente libre.
 * Única fuente de la plantilla «Hablante N» (config-driven, sin hardcode).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { normalizeSpaces, stripDiacritics } from './audioMath.js'
import { getFallbackSpeaker, isAutoSpeakerLabel, nextAutoSpeakerLabel, parseSpeakerIndex } from './speakerCore.js'
import { SPEAKER_ASSIGN } from './speakerAssignDefaults.js'

export { isAutoSpeakerLabel, parseSpeakerIndex } from './speakerCore.js'

export function getVoiceIdentityConfig(config = FLU_CONFIG) {
  return config.voiceIdentity || FLU_CONFIG.voiceIdentity
}

export function foldSpeakerKey(label = '') {
  return stripDiacritics(normalizeSpaces(label)).toLowerCase()
}

/**
 * Etiquetas que RESERVAN numero de hablante: las voces REALES de la sesion. El RESPALDO
 * ("sin medida") NO es una voz: si reservara, la primera voz medida nace "Hablante 2"
 * aunque no exista un "Hablante 1" real (defecto medido 2026-10-18).
 *
 * @param {Iterable<string>} labels etiquetas vivas de la sesion
 * @returns {string[]} etiquetas que cuentan para el high-water de "Hablante N"
 */
export function reservedSpeakerLabels(labels = []) {
  const fallback = foldSpeakerKey(getFallbackSpeaker())
  return [...(labels || [])].filter((label) => Boolean(label) && foldSpeakerKey(label) !== fallback)
}

/**
 * DUENO UNICO de la GRAFIA canonica de un nombre propio. Las etiquetas automaticas
 * («Hablante N») y el motor («FLU») se dejan TAL CUAL: no son nombres de persona.
 * Un nombre propio se escribe con la INICIAL EN MAYUSCULA, asi "luis" y "Luis" son
 * UNA sola grafia en la fila, el alias y la base (P9.78: medido en el log del dueno,
 * las filas salian con las dos: `luis` 2 y `Luis` 8). No toca el resto del texto.
 * @param {string} [label]
 * @returns {string}
 */
export function canonicalSpeakerName(label = '') {
  const text = normalizeSpaces(label)
  if (!text) return ''
  if (isAutoSpeakerLabel(text)) return text
  if (text.toLowerCase() === 'flu') return 'FLU'
  return text.charAt(0).toUpperCase() + text.slice(1)
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

/**
 * DUENO UNICO de la etiqueta de RESPALDO cuando NO hay medida de esta voz.
 *
 * Un NOMBRE PROPIO (persona registrada) NUNCA es una etiqueta de respaldo: no se
 * hereda por continuidad, ni por cercania temporal, ni por ser el participante
 * activo del onboarding. Sin evidencia acustica de ESTE turno se responde la
 * etiqueta ANONIMA («Hablante N») — la que ya traia la voz — o el respaldo
 * generico de config. Las automaticas y el motor pasan tal cual.
 *
 * @param {string} [label] Etiqueta que se pretendia heredar.
 * @param {object} [config] Configuracion (para el respaldo generico).
 * @returns {string} Etiqueta segura para un turno sin identidad medida.
 */
/**
 * DUENO UNICO de la etiqueta PROVISIONAL de un turno cuya voz aun NO esta medida.
 *
 * No es un nombre propio ni una etiqueta automatica `Hablante N`: dice "no se sabe
 * todavia". Existe para que un turno sin medida NO herede la etiqueta del turno anterior
 * (la mujer quedaba con la etiqueta del dueno) ni el nombre del participante primario.
 * La fila se actualiza UNA vez cuando llega el vector de su propio audio.
 *
 * @param {object} [config] Configuracion (etiqueta en `voiceIdentity.labels.pendingSpeaker`).
 * @returns {string}
 */
export function pendingSpeakerLabel(config = FLU_CONFIG) {
  const label = config?.voiceIdentity?.labels?.pendingSpeaker
  const text = String(label || '').trim()
  return text || SPEAKER_ASSIGN.pendingSpeaker
}

export function anonymousSpeakerLabel(label = '', config = FLU_CONFIG) {
  const text = normalizeSpeakerLabel(label)
  if (text && !isProperSpeakerName(text)) return text
  return getFallbackSpeaker(config)
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
  { maxSpeakers = 0, config = FLU_CONFIG, highWater = 0 } = {},
) {
  return nextAutoSpeakerLabel(clusters, extraLabels, { maxSpeakers, config, highWater })
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
