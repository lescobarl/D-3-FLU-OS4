import { fluDb, newId } from '../../core/db/fluDatabase'
import { buildSyncTuple } from '../../core/db/syncTuple'
import { persistVoiceProfile } from '../../hooks/useVoiceProfiles'
import { putConversationRecord } from '../../hooks/useConversationPersistence'


function voiceRecordToProfile(record) {
  return {
    id: record.id,
    label: record.label,
    speakerId: record.speakerId,
    signature: record.signature,
    embedding: record.embedding,
    updatedAt: new Date(record.timestamp).toISOString(),
  }
}

export async function saveVoiceProfile(profile = {}) {
  const label = String(profile.label || '').trim()
  let id = String(profile.id || '').trim()
  const existing = id ? await fluDb.voiceProfiles.get(id) : undefined
  if (!id) {
    id = newId()
  }
  const record = {
    id,
    label,
    speakerId: String(profile.speakerId || existing?.speakerId || ''),
    signature: Array.isArray(profile.signature) ? profile.signature : existing?.signature ?? null,
    embedding: Array.isArray(profile.embedding) ? profile.embedding : existing?.embedding ?? null,
    timestamp: Date.now(),
    sync: buildSyncTuple(existing?.sync, Date.now()),
  }
  await persistVoiceProfile(record)
  return voiceRecordToProfile(record)
}

export async function listVoiceProfiles() {
  const rows = await fluDb.voiceProfiles.toArray()
  return rows.filter((row) => !row.sync?.deleted).map(voiceRecordToProfile)
}

export async function findVoiceProfileByLabel(label) {
  const normalized = String(label || '').trim()
  if (!normalized) return null
  const rows = await listVoiceProfiles()
  return rows.find((row) => String(row?.label || '').trim() === normalized) || null
}

export async function deleteVoiceProfile(profileId) {
  const id = String(profileId || '').trim()
  if (!id) return false
  const existing = await fluDb.voiceProfiles.get(id)
  if (!existing) return false
  await persistVoiceProfile({
    ...existing,
    timestamp: Date.now(),
    sync: { ...buildSyncTuple(existing.sync, Date.now()), deleted: true },
  })
  return true
}

export async function deleteAuditLogsBySpeaker(speaker, { speakerId } = {}) {
  const label = String(speaker || '').trim()
  const sid = String(speakerId || '').trim()
  if (!label && !sid) return []

  const rows = await fluDb.conversations.toArray()
  const updated = []

  for (const row of rows) {
    if (row.sync?.deleted) continue
    const nameMatch = label && row.speakerName === label
    const idMatch = sid && row.speakerId === sid
    if (!nameMatch && !idMatch) continue
    const next = {
      ...row,
      sync: { ...buildSyncTuple(row.sync, Date.now()), deleted: true },
    }
    await putConversationRecord(next)
    updated.push(next)
  }

  return updated
}

async function persistSessionState(session = {}) {
  const value = {
    ...session,
    history: Array.isArray(session?.history) ? session.history : [],
  }
  const existing = await fluDb.sessionState.get('current')
  await fluDb.sessionState.put({
    id: 'current',
    key: 'current',
    value,
    timestamp: Date.now(),
    sync: buildSyncTuple(existing?.sync, Date.now()),
  })
  return value
}

export async function saveSessionState(session = {}) {
  const value = await persistSessionState(session)
  return { id: 'current', ...value, updatedAt: new Date(Date.now()).toISOString() }
}

/**
 * Recupera el estado de sesión persistido en `flu-os3`.
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function loadSessionState() {
  const record = await fluDb.sessionState.get('current')
  if (!record) return null
  const value = record.value && typeof record.value === 'object' ? record.value : {}
  return { ...value, history: Array.isArray(value.history) ? value.history : [] }
}

/**
 * UI session state (estado de interfaz: tab/idioma/frames) en el MISMO backend
 * Dexie que la sesión de voz (C9: un solo backend; se elimina el localStorage
 * duplicado). Fila propia `id: 'ui'` para no pisar la sesión de voz ('current').
 */
const UI_SESSION_ID = 'ui'

export async function loadUiSessionState() {
  const record = await fluDb.sessionState.get(UI_SESSION_ID)
  const value = record?.value
  return value && typeof value === 'object' ? value : null
}

export async function saveUiSessionState(state = {}) {
  const existing = await fluDb.sessionState.get(UI_SESSION_ID)
  await fluDb.sessionState.put({
    id: UI_SESSION_ID,
    key: UI_SESSION_ID,
    value: state && typeof state === 'object' ? state : {},
    timestamp: Date.now(),
    sync: buildSyncTuple(existing?.sync, Date.now()),
  })
}

export async function clearUiSessionState() {
  const existing = await fluDb.sessionState.get(UI_SESSION_ID)
  if (!existing) return
  await fluDb.sessionState.put({
    ...existing,
    timestamp: Date.now(),
    sync: { ...buildSyncTuple(existing.sync, Date.now()), deleted: true },
  })
}