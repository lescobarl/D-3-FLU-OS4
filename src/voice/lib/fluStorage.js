import { normalizeConversationRow } from './conversationRow.js'
import { fluDb } from '../../core/db/fluDatabase'
import { buildSyncTuple } from '../../core/db/syncTuple'
import { persistVoiceProfile } from '../../hooks/useVoiceProfiles'

const DB_NAME = 'flu-voz-local'
const DB_VERSION = 4

let databasePromise = null

function createObjectStoreIfNeeded(db, name, options, seed) {
  if (db.objectStoreNames.contains(name)) return
  const store = db.createObjectStore(name, options)
  if (typeof seed === 'function') seed(store)
}

function openDatabase() {
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = request.result
      const oldVersion = event.oldVersion

      createObjectStoreIfNeeded(db, 'voice_profiles', { keyPath: 'id' }, (store) => {
        store.createIndex('label', 'label', { unique: false })
      })

      if (!db.objectStoreNames.contains('audit_logs')) {
        const store = db.createObjectStore('audit_logs', { keyPath: 'id' })
        store.createIndex('timestamp', 'timestamp', { unique: false })
        store.createIndex('speakerId', 'speakerId', { unique: false })
        store.createIndex('speakerName', 'speakerName', { unique: false })
        store.createIndex('isFinal', 'isFinal', { unique: false })
      } else if (oldVersion < 4) {
        const tx = event.target.transaction
        const store = tx.objectStore('audit_logs')
        const names = Array.from(store.indexNames)
        if (!names.includes('speakerId')) store.createIndex('speakerId', 'speakerId', { unique: false })
        if (!names.includes('speakerName')) store.createIndex('speakerName', 'speakerName', { unique: false })
        if (!names.includes('isFinal')) store.createIndex('isFinal', 'isFinal', { unique: false })
      }

      createObjectStoreIfNeeded(db, 'session_state', { keyPath: 'id' })
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      databasePromise = null
      reject(request.error)
    }
    request.onblocked = () => {
      databasePromise = null
    }
  })

  return databasePromise
}

async function withStore(storeName, mode, callback) {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    let result

    try {
      result = callback(store)
    } catch (error) {
      reject(error)
      return
    }

    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function readAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

function migrateStoredRow(row = {}) {
  const normalized = normalizeConversationRow(row)
  if (!normalized) return null
  const meta = {}
  if (row.response) meta.response = String(row.response)
  if (row.navigation) meta.navigation = row.navigation
  if (row.phase) meta.phase = row.phase
  const merged = Object.keys(meta).length ? { ...normalized, meta } : normalized
  return {
    ...merged,
    deleted: row.deleted === true,
    revision: Number.isFinite(row.revision) ? row.revision : merged.revision || 1,
    updated_at: row.updated_at || merged.updated_at || new Date().toISOString(),
  }
}

let legacyMigrated = false

function legacyToVoiceRecord(row = {}) {
  const t = Number(row.timestamp) || Date.now()
  return {
    id: String(row.id),
    label: String(row.label || ''),
    speakerId: String(row.speakerId || ''),
    signature: Array.isArray(row.signature) ? row.signature : null,
    embedding: Array.isArray(row.embedding) ? row.embedding : null,
    timestamp: t,
    sync: buildSyncTuple(undefined, Date.now()),
  }
}

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

/**
 * Migración one-shot y NO destructiva desde `flu-voz-local` a `flu-os3` (F4).
 * Copia solo filas cuyo id no exista ya; NUNCA borra la DB vieja.
 */
async function migrateLegacyVoiceData() {
  if (legacyMigrated) return
  legacyMigrated = true
  try {
    const existing = await fluDb.voiceProfiles.toArray()
    const known = new Set(existing.map((row) => row.id))
    const legacyProfiles = await listStoreRecords('voice_profiles')
    for (const row of legacyProfiles) {
      if (!row?.id || known.has(row.id)) continue
      await persistVoiceProfile(legacyToVoiceRecord(row))
    }
    if (!(await fluDb.sessionState.get('current'))) {
      const legacySessions = await listStoreRecords('session_state')
      const current = legacySessions.find((row) => row?.id === 'current')
      if (current) await persistSessionState(current)
    }
    const knownConversations = new Set((await fluDb.conversations.toArray()).map((row) => row.id))
    const legacyAudit = await listStoreRecords('audit_logs')
    for (const row of legacyAudit) {
      const normalized = migrateStoredRow(row)
      if (!normalized?.id || normalized.deleted === true || knownConversations.has(normalized.id)) {
        continue
      }
      await fluDb.conversations.put({
        id: normalized.id,
        role: 'user',
        text: String(normalized.text || ''),
        speakerId: String(normalized.speakerId || ''),
        speakerName: String(normalized.speakerName || ''),
        timestamp: Number(normalized.timestamp) || Date.now(),
        signature: Array.isArray(normalized.signature) ? normalized.signature : null,
        phase: normalized.phase,
        response: normalized.response,
        navigation: normalized.navigation,
        meta: normalized.meta || null,
        sync: buildSyncTuple(undefined, Date.now()),
      })
    }
  } catch (error) {
    console.warn('[fluStorage] migración legacy→flu-os3 omitida:', error)
  }
}

export async function saveVoiceProfile(profile = {}) {
  await migrateLegacyVoiceData()
  const label = String(profile.label || '').trim()
  let id = String(profile.id || '').trim()
  const existing = id ? await fluDb.voiceProfiles.get(id) : undefined
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `voice-${Date.now()}`
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
  await migrateLegacyVoiceData()
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
  await migrateLegacyVoiceData()
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
    await fluDb.conversations.put(next)
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
  await migrateLegacyVoiceData()
  const value = await persistSessionState(session)
  return { id: 'current', ...value, updatedAt: new Date(Date.now()).toISOString() }
}

/**
 * Recupera el estado de sesión persistido en `flu-os3`.
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function loadSessionState() {
  await migrateLegacyVoiceData()
  const record = await fluDb.sessionState.get('current')
  if (!record) return null
  const value = record.value && typeof record.value === 'object' ? record.value : {}
  return { ...value, history: Array.isArray(value.history) ? value.history : [] }
}

export async function listStoreRecords(storeName) {
  return withStore(storeName, 'readonly', (store) => readAllFromStore(store))
}
