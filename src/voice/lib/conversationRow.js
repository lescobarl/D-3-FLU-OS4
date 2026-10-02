/**
 * Contrato atómico del log de conversación (UI + IndexedDB).
 * speakerId / speakerName: solo etiquetas. signature: embedding 512-D opcional por fila.
 */
import { cleanForSpeech, stripDiacritics } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { normalizeSpeakerLabel, parseSpeakerIndex } from './voiceIdentity.js'
import { buildSyncTuple } from '../../core/db/syncTuple'

export const SPEAKER_ID_CALCULATING = 'calculando'
export const SPEAKER_ID_FLU = 'flu'

const SPEAKER_ID_PATTERN = /^speaker_[a-z0-9_]+$/

export function getIdentifyingSpeakerName(config = FLU_CONFIG) {
  const label = String(config?.ui?.identifyingSpeakerName || '').trim()
  return label || 'Identificando...'
}

export function isCalculatingSpeakerId(speakerId = '') {
  return String(speakerId || '').trim() === SPEAKER_ID_CALCULATING
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

export function normalizeRowSignature(signature = null) {
  if (!Array.isArray(signature) || !signature.length) return null
  return signature.slice(0, 512).map((value) => Number(value) || 0)
}

export function createConversationRow({
  text = '',
  speakerId = SPEAKER_ID_CALCULATING,
  speakerName = '',
  timestamp = Date.now(),
  isFinal = true,
  id = '',
  signature = null,
} = {}) {
  const cleanText = cleanForSpeech(text)
  const sid = String(speakerId || '').trim() || SPEAKER_ID_CALCULATING
  const sname = cleanForSpeech(speakerName) || resolveSpeakerNameFromId(sid)
  assertConversationRowFields({ speakerId: sid, speakerName: sname })
  const final = Boolean(isFinal)
  const row = {
    id: String(id || '').trim() || crypto.randomUUID(),
    text: cleanText,
    speakerId: sid,
    speakerName: sname,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    isFinal: final,
    ...buildSyncTuple(undefined, Date.now()),
    ...(final ? { speakerLocked: true } : {}),
  }
  const normalizedSignature = normalizeRowSignature(signature)
  if (normalizedSignature?.length) {
    row.signature = normalizedSignature
  }
  return row
}

export function assertConversationRowFields({ speakerId = '', speakerName = '' } = {}) {
  for (const value of [speakerId, speakerName]) {
    if (Array.isArray(value)) {
      throw new Error('conversationRow: vector/array forbidden in speaker fields')
    }
    const text = String(value || '')
    if (text.startsWith('[') && text.includes(',')) {
      throw new Error('conversationRow: serialized vector forbidden in speaker fields')
    }
  }
}

export function isSpeakerImmutable(row = {}) {
  return row.isFinal !== false
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
