import { normalizeConversationRow } from './conversationRow.js'

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
      createObjectStoreIfNeeded(db, 'minute_knowledge', { keyPath: 'id' }, (store) => {
        store.createIndex('profileId', 'profileId', { unique: false })
        store.createIndex('userId', 'userId', { unique: false })
        store.createIndex('minuteKey', 'minuteKey', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      })
      createObjectStoreIfNeeded(db, 'speaker_clusters', { keyPath: 'id' })
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

function readAllFromIndex(store, indexName, value) {
  return new Promise((resolve, reject) => {
    const index = store.index(indexName)
    const request = value === undefined ? index.getAll() : index.getAll(value)
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

function readLatestFromIndex(store, indexName, limit) {
  return new Promise((resolve, reject) => {
    const index = store.index(indexName)
    const rows = []
    const request = index.openCursor(null, 'prev')

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(rows)
        return
      }
      const row = cursor.value
      if (row) rows.push(row)
      if (rows.length >= limit) {
        resolve(rows.reverse())
        return
      }
      cursor.continue()
    }

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

function isStoredRowVisible(row = {}) {
  return row?.deleted !== true
}

export async function saveVoiceProfile(profile) {
  const id = profile.id || crypto.randomUUID()
  const payload = {
    ...profile,
    id,
    updatedAt: new Date().toISOString(),
  }

  return withStore('voice_profiles', 'readwrite', (store) => {
    store.put(payload)
    return payload
  })
}

export async function listVoiceProfiles() {
  return withStore('voice_profiles', 'readonly', (store) => readAllFromStore(store))
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
  return withStore('voice_profiles', 'readwrite', (store) => {
    store.delete(id)
    return true
  })
}

export async function renameVoiceProfile(profileId, label) {
  const id = String(profileId || '').trim()
  const nextLabel = String(label || '').trim()
  if (!id || !nextLabel) return null

  return withStore('voice_profiles', 'readwrite', async (store) => {
    const current = await new Promise((resolve, reject) => {
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
    if (!current) return null

    const payload = {
      ...current,
      label: nextLabel,
      updatedAt: new Date().toISOString(),
    }
    store.put(payload)
    return payload
  })
}

/** Persiste fila con contrato estricto { id, text, speakerId, speakerName, timestamp, isFinal }. */
export async function addConversationRow(row) {
  const payload = migrateStoredRow(row)
  if (!payload?.text) return null

  return withStore('audit_logs', 'readwrite', (store) => {
    store.put(payload)
    return payload
  })
}

export async function getLatestAuditLogs(limit = null) {
  if (Number.isFinite(limit) && limit > 0) {
    const rows = await withStore('audit_logs', 'readonly', (store) =>
      readLatestFromIndex(store, 'timestamp', limit),
    )
    return rows.map(migrateStoredRow).filter(Boolean).filter(isStoredRowVisible)
  }

  const rows = await withStore('audit_logs', 'readonly', (store) => readAllFromStore(store))
  return rows
    .map(migrateStoredRow)
    .filter(Boolean)
    .filter(isStoredRowVisible)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}

export async function renameAuditLogSpeaker(fromSpeaker, toSpeaker, { fromSpeakerId, toSpeakerId } = {}) {
  const sourceName = String(fromSpeaker || '').trim()
  const targetName = String(toSpeaker || '').trim()
  const sourceId = String(fromSpeakerId || '').trim()
  const targetId = String(toSpeakerId || '').trim()
  if ((!sourceName && !sourceId) || (!targetName && !targetId)) return []

  return withStore('audit_logs', 'readwrite', async (store) => {
    const rows = await readAllFromStore(store)
    const updated = rows.map((row) => {
      const normalized = migrateStoredRow(row)
      if (!normalized) return row
      const nameMatch = sourceName && normalized.speakerName === sourceName
      const idMatch = sourceId && normalized.speakerId === sourceId
      if (!nameMatch && !idMatch) return normalized
      return {
        ...normalized,
        speakerName: targetName || normalized.speakerName,
        speakerId: targetId || normalized.speakerId,
      }
    })

    updated.forEach((row) => {
      if (row?.id) store.put(row)
    })

    return updated
  })
}

export async function deleteAuditLogsBySpeaker(speaker, { speakerId } = {}) {
  const label = String(speaker || '').trim()
  const sid = String(speakerId || '').trim()
  if (!label && !sid) return []

  const deletedAt = new Date().toISOString()

  return withStore('audit_logs', 'readwrite', async (store) => {
    const rows = await readAllFromStore(store)
    const visible = []

    rows.forEach((row) => {
      const normalized = migrateStoredRow(row)
      if (!normalized?.id) return
      const nameMatch = label && normalized.speakerName === label
      const idMatch = sid && normalized.speakerId === sid
      if (nameMatch || idMatch) {
        store.put({
          ...normalized,
          deleted: true,
          revision: (Number(normalized.revision) || 1) + 1,
          updated_at: deletedAt,
        })
        return
      }
      if (isStoredRowVisible(normalized)) visible.push(normalized)
    })

    return visible
  })
}

export async function saveSessionState(session) {
  const payload = {
    id: 'current',
    ...session,
    history: Array.isArray(session?.history) ? session.history : [],
    updatedAt: new Date().toISOString(),
  }

  return withStore('session_state', 'readwrite', (store) => {
    store.put(payload)
    return payload
  })
}

export async function loadSessionState() {
  return withStore('session_state', 'readonly', (store) =>
    new Promise((resolve, reject) => {
      const request = store.get('current')
      request.onsuccess = () => {
        const result = request.result || null
        if (!result) {
          resolve(null)
          return
        }

        resolve({
          ...result,
          history: Array.isArray(result.history) ? result.history : [],
        })
      }
      request.onerror = () => reject(request.error)
    }),
  )
}

export async function listStoreRecords(storeName) {
  return withStore(storeName, 'readonly', (store) => readAllFromStore(store))
}

export async function listStoreRecordsByIndex(storeName, indexName, value) {
  return withStore(storeName, 'readonly', (store) => readAllFromIndex(store, indexName, value))
}

export async function saveStoreRecord(storeName, payload) {
  return withStore(storeName, 'readwrite', (store) => {
    store.put(payload)
    return payload
  })
}
