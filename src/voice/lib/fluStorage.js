import { fluDb } from '../../core/db/fluDatabase'
import { buildSyncTuple } from '../../core/db/syncTuple'
import {
  deleteVoiceProfile,
  findVoiceProfileRecordByLabel,
  listVoiceProfileRecords,
} from '../../hooks/useVoiceProfiles'


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

/** Fila de sesión con borrado lógico (uso exclusivo de sessionState). */
function softDeleted(record, at = Date.now()) {
  return {
    ...record,
    timestamp: at,
    sync: { ...buildSyncTuple(record.sync, at), deleted: true },
  }
}


/** Fachada de lectura: el dueño único es useVoiceProfiles. */
export async function listVoiceProfiles() {
  const rows = await listVoiceProfileRecords()
  return rows.map(voiceRecordToProfile)
}

/** Fachada de búsqueda: normaliza y decide el dueño (trim + más antiguo). */
export async function findVoiceProfileByLabel(label) {
  const record = await findVoiceProfileRecordByLabel(label)
  return record ? voiceRecordToProfile(record) : null
}

export { deleteVoiceProfile }
async function persistSessionState(session = {}) {
  // El HISTORIAL no se persiste aqui: su fuente canonica es fluDb.conversations
  // (useConversationPersistence). Esta copia no tenia lector y era la misma entidad
  // guardada en dos sistemas (ruta doble de datos, AGENTS 6.3).
  const value = { ...session }
  delete value.history
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
  return { ...value }
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
  await fluDb.sessionState.put(softDeleted(existing))
}