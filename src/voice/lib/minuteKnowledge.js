import { cleanForSpeech, normalizeSpaces } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import {
  parseMinuteHistoryCode,
  parseMinuteSequenceFromQuery,
  findMinuteRecordBySequence,
  formatMinuteDraftText,
  createMinuteDraftFromSummary,
  isGenericMinuteSessionTheme,
  resolveMinuteThemeForSpeech,
} from '../../lib/minuteKnowledgeHelpers'

// D3: dueño canónico de estos parsers/helpers es src/lib/minuteKnowledgeHelpers.ts.
// Se re-exportan (y se importan arriba para el uso interno del módulo).
export {
  parseMinuteHistoryCode,
  parseMinuteSequenceFromQuery,
  findMinuteRecordBySequence,
  formatMinuteDraftText,
  createMinuteDraftFromSummary,
  isGenericMinuteSessionTheme,
  resolveMinuteThemeForSpeech,
}

export const MINUTE_DESCRIPTION_LIMIT = 10

function minuteTextLabels() {
  return FLU_CONFIG.ui.minuteFields
}

export function parseMinuteDraftText(text = '', baseDraft = {}) {
  const labels = minuteTextLabels()
  const draft = createMinuteDraftFromSummary(baseDraft, baseDraft?.tema_sesion, baseDraft?.id)
  const sections = {
    [labels.title.toLowerCase()]: 'titulo',
    [labels.participants.toLowerCase()]: 'participantes',
    [labels.summary.toLowerCase()]: 'resumen',
    [labels.agreements.toLowerCase()]: 'acuerdos',
    [labels.pending.toLowerCase()]: 'pendientes',
    [labels.nextSteps.toLowerCase()]: 'siguientes_pasos',
  }

  let currentSection = ''
  const resumenLines = []

  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim()
    const header = Object.entries(sections).find(([label]) => line.toLowerCase().startsWith(`${label}:`))

    if (header) {
      currentSection = header[1]
      const value = line.slice(header[0].length + 1).trim()

      if (currentSection === 'titulo') draft.titulo = value
      if (currentSection === 'participantes') {
        draft.participantes = value
          .split(',')
          .map((item) => normalizeSpaces(item))
          .filter(Boolean)
      }
      if (currentSection === 'resumen') {
        resumenLines.length = 0
        if (value) resumenLines.push(value)
      }
      if (['acuerdos', 'pendientes', 'siguientes_pasos'].includes(currentSection)) {
        draft[currentSection] = value ? [normalizeSpaces(value.replace(/^-\s*/, ''))] : []
      }
      continue
    }

    if (!line) continue

    if (line.startsWith('- ')) {
      if (['acuerdos', 'pendientes', 'siguientes_pasos'].includes(currentSection)) {
        draft[currentSection].push(normalizeSpaces(line.slice(2)))
      }
      continue
    }

    if (currentSection === 'resumen') {
      resumenLines.push(line)
    }
  }

  draft.resumen = normalizeSpaces(resumenLines.join(' '))
  return draft
}

export function buildMinuteKey(summary = {}) {
  const title = normalizeSpaces(summary?.titulo || '')
  const sessionTheme = normalizeSpaces(summary?.tema_sesion || '')
  return cleanForSpeech(`${title}|${sessionTheme}`).toLowerCase()
}

export function formatMinuteHistoryCode(date = new Date(), sequence = 1) {
  const year = String(date.getFullYear()).slice(-2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const seq = String(sequence).padStart(2, '0')
  return `${year}${month}${day}-${seq}`
}

function formatMinuteKnowledgeEntry(record = {}, { fallbackIndex = 0 } = {}) {
  const snapshot = record?.summarySnapshot || record
  const code = normalizeSpaces(record?.historyCode || '')
  const { sequence } = parseMinuteHistoryCode(code)
  const seqLabel = sequence > 0 ? String(sequence) : String(fallbackIndex + 1)
  const header = code
    ? `[Minuta ${seqLabel} · ${code}] ${record?.description || snapshot?.titulo || ''}`.trim()
    : `[Minuta ${seqLabel}] ${record?.description || snapshot?.titulo || ''}`.trim()
  const speechTheme = resolveMinuteThemeForSpeech(snapshot, record, {
    defaultTheme: FLU_CONFIG.sessionDefaults?.theme || '',
  })
  const body = [
    snapshot?.titulo ? `Titulo: ${snapshot.titulo}` : '',
    speechTheme ? `Tema: ${speechTheme}` : '',
    snapshot?.resumen ? `Resumen: ${snapshot.resumen}` : '',
    snapshot?.participantes?.length ? `Participantes: ${snapshot.participantes.join(', ')}` : '',
    snapshot?.acuerdos?.length ? `Acuerdos: ${snapshot.acuerdos.join(' | ')}` : '',
    snapshot?.pendientes?.length ? `Pendientes: ${snapshot.pendientes.join(' | ')}` : '',
    snapshot?.siguientes_pasos?.length ? `Siguientes pasos: ${snapshot.siguientes_pasos.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return `${header}\n${body}`.trim()
}

/** Al guardar minuta: tema real (titulo) si la sesion sigue en placeholder generico. */
export function resolveMinuteThemeForSave({ titulo = '', sessionTheme = '' } = {}) {
  const title = normalizeSpaces(titulo)
  const session = normalizeSpaces(sessionTheme)
  if (!isGenericMinuteSessionTheme(session, FLU_CONFIG.sessionDefaults?.theme || '')) return session
  return title
}

export function compareMinuteHistoryCodeDesc(left = {}, right = {}) {
  const leftCode = parseMinuteHistoryCode(left?.historyCode)
  const rightCode = parseMinuteHistoryCode(right?.historyCode)
  const dateCompare = rightCode.date.localeCompare(leftCode.date)
  if (dateCompare !== 0) return dateCompare
  return rightCode.sequence - leftCode.sequence
}

export function compareMinuteHistoryCodeAsc(left = {}, right = {}) {
  return compareMinuteHistoryCodeDesc(right, left)
}

function getNextUniversalHistorySequence(entries = []) {
  return entries.reduce((max, entry) => {
    const { sequence } = parseMinuteHistoryCode(entry?.historyCode)
    return Math.max(max, sequence)
  }, 0) + 1
}

export function formatMinuteHistoryLabel(entry = {}) {
  const code = normalizeSpaces(entry?.historyCode || '')
  const description = normalizeSpaces(
    entry?.description || entry?.summarySnapshot?.titulo || entry?.titulo || ''
  )
  if (!code) return description
  if (!description) return code
  return `${code}-${description}`
}

export function truncateMinuteDescription(text = '', limit = MINUTE_DESCRIPTION_LIMIT) {
  const normalized = normalizeSpaces(text)
  if (!normalized) return ''
  if (normalized.length <= limit) return normalized
  return normalized.slice(0, limit)
}

export function createEmptyMinuteDraft(theme = '') {
  return {
    id: '',
    titulo: '',
    participantes: [],
    resumen: '',
    acuerdos: [],
    pendientes: [],
    siguientes_pasos: [],
    tema_sesion: normalizeSpaces(theme),
  }
}

export function hasMinuteDraftContent(draft = {}) {
  const title = normalizeSpaces(draft?.titulo || '')
  const summary = normalizeSpaces(draft?.resumen || '')
  const participants = Array.isArray(draft?.participantes)
    ? draft.participantes.map((item) => normalizeSpaces(item)).filter(Boolean)
    : []
  const agreements = Array.isArray(draft?.acuerdos)
    ? draft.acuerdos.map((item) => normalizeSpaces(item)).filter(Boolean)
    : []
  const pending = Array.isArray(draft?.pendientes)
    ? draft.pendientes.map((item) => normalizeSpaces(item)).filter(Boolean)
    : []
  const nextSteps = Array.isArray(draft?.siguientes_pasos)
    ? draft.siguientes_pasos.map((item) => normalizeSpaces(item)).filter(Boolean)
    : []

  return Boolean(title || summary || participants.length || agreements.length || pending.length || nextSteps.length)
}

export function minuteDraftToSummarySnapshot(draft = {}) {
  return {
    titulo: normalizeSpaces(draft?.titulo || ''),
    participantes: Array.isArray(draft?.participantes)
      ? draft.participantes.map((item) => normalizeSpaces(item)).filter(Boolean)
      : [],
    resumen: normalizeSpaces(draft?.resumen || ''),
    acuerdos: Array.isArray(draft?.acuerdos)
      ? draft.acuerdos.map((item) => normalizeSpaces(item)).filter(Boolean)
      : [],
    pendientes: Array.isArray(draft?.pendientes)
      ? draft.pendientes.map((item) => normalizeSpaces(item)).filter(Boolean)
      : [],
    siguientes_pasos: Array.isArray(draft?.siguientes_pasos)
      ? draft.siguientes_pasos.map((item) => normalizeSpaces(item)).filter(Boolean)
      : [],
    tema_sesion: normalizeSpaces(draft?.tema_sesion || ''),
  }
}

export function buildMinuteKnowledgeId({ profileId = '', userId = '', minuteKey = '' } = {}) {
  return cleanForSpeech(`${profileId}|${userId}|${minuteKey}`).toLowerCase()
}

export function normalizeMinuteKnowledgeRecord(record = {}) {
  const summarySnapshot = minuteDraftToSummarySnapshot(record?.summarySnapshot || record)
  const minuteKey = buildMinuteKey(summarySnapshot)
  const profileId = normalizeSpaces(record?.profileId || '')
  const userId = normalizeSpaces(record?.userId || '')

  return {
    id: String(record?.id || '').trim(),
    profileId,
    userId,
    minuteKey,
    historyCode: normalizeSpaces(record?.historyCode || ''),
    description: normalizeSpaces(record?.description || summarySnapshot.titulo || ''),
    summarySnapshot,
    createdAt: record?.createdAt || new Date().toISOString(),
    updatedAt: record?.updatedAt || new Date().toISOString(),
  }
}

export function buildVoiceMinuteKnowledgeBase(records = []) {
  if (!Array.isArray(records) || !records.length) return ''

  const maxRows = Number(FLU_CONFIG.limits?.minuteKnowledgePromptMax)
  const windowSize = Number.isFinite(maxRows) && maxRows > 0 ? maxRows : records.length
  const windowRecords = windowSize > 0 ? records.slice(0, windowSize) : records

  return windowRecords
    .map((record, index) => formatMinuteKnowledgeEntry(record, { fallbackIndex: index }))
    .filter(Boolean)
    .join('\n\n')
}

export function buildMinuteHistoryEntries(records = []) {
  return records
    .map((record) => normalizeMinuteKnowledgeRecord(record))
    .sort(compareMinuteHistoryCodeDesc)
}

export function upsertMinuteHistoryEntry(entries = [], draft = {}, { profileId = '', userId = '' } = {}) {
  const summarySnapshot = minuteDraftToSummarySnapshot(draft)
  const minuteKey = buildMinuteKey(summarySnapshot)
  const existingIndex = entries.findIndex((entry) => entry.minuteKey === minuteKey)
  const now = new Date()
  const nextSequence = getNextUniversalHistorySequence(entries)

  const nextEntry = normalizeMinuteKnowledgeRecord({
    id: existingIndex >= 0 ? entries[existingIndex].id : draft?.id || '',
    profileId,
    userId,
    minuteKey,
    historyCode:
      existingIndex >= 0
        ? entries[existingIndex].historyCode
        : formatMinuteHistoryCode(now, nextSequence),
    description: normalizeSpaces(summarySnapshot.titulo || ''),
    summarySnapshot,
    createdAt: existingIndex >= 0 ? entries[existingIndex].createdAt : now.toISOString(),
    updatedAt: now.toISOString(),
  })

  if (existingIndex >= 0) {
    const updated = [...entries]
    updated[existingIndex] = { ...updated[existingIndex], ...nextEntry, id: updated[existingIndex].id || nextEntry.id }
    return {
      entries: buildMinuteHistoryEntries(updated),
      savedEntry: updated[existingIndex],
    }
  }

  const savedEntry = {
    ...nextEntry,
    id: nextEntry.id || crypto.randomUUID(),
  }

  return {
    entries: buildMinuteHistoryEntries([savedEntry, ...entries]),
    savedEntry,
  }
}
