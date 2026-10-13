/**
 * Contrato atómico del log de conversación (UI + IndexedDB).
 * speakerId / speakerName: solo etiquetas. signature: embedding 512-D opcional por fila.
 */
import { cleanForSpeech, stripDiacritics } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { resolveVoiceName } from './speakerDirectory.js'
import { normalizeSpeakerLabel, parseSpeakerIndex } from './voiceIdentity.js'
import { equalsTrimmed } from '../../lib/textUtils'

export const SPEAKER_ID_CALCULATING = 'calculando'
export const SPEAKER_ID_FLU = 'flu'

const SPEAKER_ID_PATTERN = /^speaker_[a-z0-9_]+$/

export function getIdentifyingSpeakerName(config = FLU_CONFIG) {
  const label = String(config?.ui?.identifyingSpeakerName || '').trim()
  return label || 'Identificando...'
}

export function isCalculatingSpeakerId(speakerId = '') {
  return equalsTrimmed(speakerId, SPEAKER_ID_CALCULATING)
}

export function isValidSpeakerId(speakerId = '') {
  const id = String(speakerId || '').trim()
  if (!id) return false
  if (id === SPEAKER_ID_CALCULATING || id === SPEAKER_ID_FLU) return true
  return SPEAKER_ID_PATTERN.test(id)
}

export function labelToSpeakerId(label = '') {
  const name = normalizeSpeakerLabel(cleanForSpeech(label))
  if (!name) return SPEAKER_ID_CALCULATING
  const index = parseSpeakerIndex(name)
  if (index != null) return `speaker_${index}`
  const slug = stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug ? `speaker_name_${slug}` : SPEAKER_ID_CALCULATING
}

/**
 * ETIQUETA VISIBLE de una fila de conversacion: se resuelve AL MOSTRAR y por la VOZ.
 *
 * Mandato del dueno (2026-10-13): el NOMBRE no vive en la conversacion (la conversacion es
 * texto insertado y no se reescribe ninguna fila). La fila guarda LA VOZ (`speakerId`) y
 * aqui se resuelve su nombre; sin nombre registrado para esa voz, la etiqueta provisional
 * de su id ("Hablante N"): NO se adivina. FLU, el sistema y las filas viejas que YA traen
 * su nombre escrito se muestran tal cual (compatibilidad).
 */
export function resolveRowSpeakerLabel(row = {}, config = FLU_CONFIG) {
    const id = String(row?.speakerId || '').trim();
    if (!id) return String(row?.speakerName || row?.speaker || '');
    const name = resolveVoiceName(id);
    if (name) return name;
    return speakerIdToDefaultName(id, config);
}

export function speakerIdToDefaultName(speakerId = '', config = FLU_CONFIG) {
  const id = String(speakerId || '').trim()
  if (id === SPEAKER_ID_CALCULATING) return getIdentifyingSpeakerName(config)
  if (id === SPEAKER_ID_FLU) return 'Flu'
  const autoMatch = id.match(/^speaker_(\d+)$/)
  if (autoMatch) return `Hablante ${autoMatch[1]}`
  const named = id.match(/^speaker_name_(.+)$/)
  if (named) {
    return named[1]
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }
  return config?.voiceIdentity?.labels?.fallbackSpeaker || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
}

export function resolveSpeakerNameFromId(speakerId = '', clusters = [], config = FLU_CONFIG) {
  const id = String(speakerId || '').trim()
  if (!id || id === SPEAKER_ID_CALCULATING) return getIdentifyingSpeakerName(config)
  const cluster = clusters.find((c) => String(c?.speakerId || '').trim() === id)
  if (cluster?.label) return normalizeSpeakerLabel(cluster.label)
  return speakerIdToDefaultName(id, config)
}

export function ensureClusterSpeakerId(cluster = {}) {
  const label = normalizeSpeakerLabel(cluster?.label || '')
  const speakerId = isValidSpeakerId(cluster?.speakerId)
    ? String(cluster.speakerId).trim()
    : labelToSpeakerId(label)
  return { ...cluster, label, speakerId }
}

/**
 * @param {number[]|null} [signature]
 * @returns {number[]|null}
 */
export function normalizeRowSignature(signature = null) {
  if (!Array.isArray(signature) || !signature.length) return null
  return signature.slice(0, 512).map((value) => Number(value) || 0)
}




export function formatRowClock(row = {}) {
  const ts = Number(row.timestamp)
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const date = new Date(ts)
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
