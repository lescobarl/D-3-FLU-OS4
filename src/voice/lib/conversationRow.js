/**
 * Contrato atómico del log de conversación (UI + IndexedDB).
 * speakerId / speakerName: solo etiquetas. signature: embedding 512-D opcional por fila.
 */
import { cleanForSpeech, stripDiacritics } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { isAutoSpeakerLabel, normalizeSpeakerLabel, parseSpeakerIndex } from './voiceIdentity.js'
import { buildSyncTuple } from '../../core/db/syncTuple'

export const SPEAKER_ID_CALCULATING = 'calculando'
export const SPEAKER_ID_FLU = 'flu'

const SPEAKER_ID_PATTERN = /^speaker_[a-z0-9_]+$/

export function getIdentifyingSpeakerName(config = FLU_CONFIG) {
  const label = String(config?.ui?.identifyingSpeakerName || '').trim()
  return label || 'Identificando...'
}

export function getCalculatingSpeakerId() {
  return SPEAKER_ID_CALCULATING
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
  return config?.voiceIdentity?.labels?.fallbackSpeaker || 'Hablante 1'
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

/**
 * Fusiona una revisión ASR (replaceLast) sobre una fila ya commitada.
 * Regla: isFinal → hablante y firma congelados; solo evoluciona el texto.
 */
export function mergeCommittedRowUpdate(prev = {}, incoming = {}) {
  const immutable = isSpeakerImmutable(prev)
  return {
    ...prev,
    ...incoming,
    id: prev.id || incoming.id,
    text: incoming.text || prev.text,
    speakerId: immutable ? prev.speakerId : incoming.speakerId || prev.speakerId,
    speakerName: immutable ? prev.speakerName : incoming.speakerName || prev.speakerName,
    signature:
      immutable && prev.signature?.length ? prev.signature : incoming.signature ?? prev.signature,
    speakerLocked: immutable || prev.speakerLocked || incoming.speakerLocked,
    isFinal: prev.isFinal !== false,
  }
}

export function patchConversationRowSpeaker(
  row,
  { speakerId, speakerName, signature = undefined, force = false } = {},
) {
  if (!row || typeof row !== 'object') return row
  if (isSpeakerImmutable(row) && !force) return row
  const sid = String(speakerId || '').trim()
  const sname = cleanForSpeech(speakerName)
  assertConversationRowFields({ speakerId: sid, speakerName: sname })
  const next = {
    ...row,
    speakerId: sid || row.speakerId,
    speakerName: sname || row.speakerName,
  }
  if (signature !== undefined) {
    const normalized = normalizeRowSignature(signature)
    if (normalized?.length) next.signature = normalized
  }
  return next
}

/** Migra filas legacy (transcript/speaker/signature) al contrato estricto. */
export function normalizeConversationRow(entry = {}, config = FLU_CONFIG) {
  if (!entry || typeof entry !== 'object') return null
  const text = cleanForSpeech(entry.text ?? entry.transcript ?? '')
  if (!text && !entry.response) return null

  const legacySpeaker = cleanForSpeech(entry.speakerName ?? entry.speaker ?? '')
  const legacyPending =
    legacySpeaker === getIdentifyingSpeakerName(config) ||
    legacySpeaker === String(config?.ui?.pendingSpeakerLabel || '').trim() ||
    legacySpeaker === 'Procesando...'

  const speakerId = isValidSpeakerId(entry.speakerId)
    ? String(entry.speakerId).trim()
    : legacyPending
      ? SPEAKER_ID_CALCULATING
      : labelToSpeakerId(legacySpeaker)

  const speakerName = legacySpeaker || resolveSpeakerNameFromId(speakerId, [], config)

  let timestamp = entry.timestamp
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(entry.createdAt || entry.timestamp)
    timestamp = Number.isFinite(parsed) ? parsed : Date.now()
  } else if (!Number.isFinite(timestamp)) {
    const parsed = Date.parse(entry.createdAt || '')
    timestamp = Number.isFinite(parsed) ? parsed : Date.now()
  }

  const core = createConversationRow({
    id: entry.id,
    text: text || cleanForSpeech(entry.response || ''),
    speakerId,
    speakerName,
    timestamp,
    isFinal: entry.isFinal !== false,
    signature: entry.signature,
  })
  if (entry.meta && typeof entry.meta === 'object') {
    return { ...core, meta: entry.meta }
  }
  if (entry.response || entry.navigation || entry.phase) {
    return {
      ...core,
      meta: {
        ...(entry.response ? { response: String(entry.response) } : {}),
        ...(entry.navigation ? { navigation: entry.navigation } : {}),
        ...(entry.phase ? { phase: entry.phase } : {}),
      },
    }
  }
  return core
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

export function shouldPatchRowSpeaker(row, { speakerId, speakerName }) {
  if (!row?.id) return false
  const sid = String(speakerId || '').trim()
  const sname = cleanForSpeech(speakerName)
  if (!sid || !sname || sid === SPEAKER_ID_CALCULATING) return false
  return row.speakerId !== sid || row.speakerName !== sname
}

export function isResolvedConversationRow(row = {}) {
  return Boolean(row?.id) && !isCalculatingSpeakerId(row.speakerId)
}
