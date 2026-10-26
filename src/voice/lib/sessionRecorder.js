/**
 * DUEÑO ÚNICO de la grabación de sesión para diagnóstico (audio + eventos).
 *
 * QUÉ GRABA (solo con la bandera encendida):
 *   • El PCM real del micrófono, capturado en `micCaptureBridge` ANTES del
 *     throttle de `processEvery` (si se grabara después, el WAV tendría huecos).
 *   • Los eventos que ya recorren el sistema: ASR crudo (`listenLog.pushRing`)
 *     y logs relayados (`relayLog`).
 *
 * BANDERA (igual que los logs: config + override + API de consola):
 *   • `FLU_CONFIG.recorder.enabled` — default APAGADO (el audio es sensible).
 *   • `localSet('flu.recorder', '1' | '0')` — override persistente.
 *   • `__fluDev.recorder.enable()` / `.disable()` / `.status()` / `.download()`.
 *
 * EXPORTACIÓN: dos archivos con el mismo sello de tiempo —
 *   `flu-session-<ts>.wav` (16-bit mono a la tasa real del micrófono) y
 *   `flu-session-<ts>.json` (eventos + marcadores de audio + metadatos).
 *
 * PERSISTENCIA CONTINUA (`configureSessionSink`): además de la copia en memoria,
 * la grabación se vuelca a disco EN VIVO por el sumidero inyectado (el middleware
 * de desarrollo `src/server/recorderSink.ts`). Es lo que permite reconstruir el
 * escenario aunque la pestaña se recargue: PCM a `audio.pcm`, eventos a
 * `events.ndjson` y las instantáneas de turno/base (VECTORES COMPLETOS, sin el
 * recorte de `safeData`) a `turns.ndjson`. Sin sumidero configurado todo esto es
 * un no-op: el módulo sigue funcionando igual en pruebas y en producción.
 *
 * MEMORIA ACOTADA: el WAV local se corta al llegar a `maxMinutes` (se marca
 * `truncated`) y los eventos usan un ring de `maxEvents`. El sumidero a disco
 * recibe la sesión COMPLETA (audio con silencios), sin el tope de memoria.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { float32ToInt16, resampleLinear } from './pcmAudio.js'
import { logCaughtError } from '../../lib/caughtError.ts'
import { hasLocalStorage, localGet, localSet } from '../../core/storage/localStore.ts'
import { writeAscii } from '../../lib/dataViewAscii.ts'

const IS_DEV = Boolean(import.meta.env?.DEV)
const STORAGE_KEY = 'flu.recorder'
const DEFAULT_MAX_MINUTES = 10
const DEFAULT_MAX_EVENTS = 20000
const MARKER_INTERVAL_MS = 1000
const STRING_MAX = 1000
const ARRAY_MAX = 50
const OBJECT_KEYS_MAX = 30
const DEPTH_MAX = 3

// Persistencia continua: el volcado va por lotes para no hacer una petición por
// bloque PCM (micCapture entrega ~50/s) ni por evento (el ASR emite decenas/s).
// El lote de audio se mantiene POR DEBAJO de 64 KiB: Chromium rechaza con
// `TypeError: Failed to fetch` todo fetch `keepalive` (y todo `sendBeacon`) cuyo
// cuerpo pase de 64 KiB. Medido 2026-10-19 en la última prueba del dueño: el
// volcado de 1 s (96 KB a 48 kHz) se rechazaba SIEMPRE y `audio.pcm` quedó en 0
// mientras los eventos (texto, pequeño) sí llegaban.
const PERSIST_FLUSH_MS = 1000
const PERSIST_AUDIO_BYTES = 32 * 1024
const PERSIST_EVENT_ROWS = 400
const PERSIST_TURN_ROWS = 40

/**
 * @typedef {{ sampleRate: number, samples: number, seconds: number, truncated: boolean, markers: Array<{ t: number, sample: number }> }} SessionAudioExport
 * @typedef {{ enabled: boolean, startedAt: string|null, durationMs: number, audioSeconds: number, sampleRate: number, audioTruncated: boolean, events: number, droppedEvents: number, maxMinutes: number, maxEvents: number, persisted: boolean, channelsDown: string[], sessionId: string, pendingPersist: number }} SessionRecorderStatus
 * @typedef {{ seq: number, t: number, iso: string, category: string, event: string, data: unknown }} SessionEventRow
 * @typedef {{ exportedAt: string, status: SessionRecorderStatus, audio: SessionAudioExport, events: SessionEventRow[] }} SessionRecordingSnapshot
 */

/**
 * @typedef {{
 *   start?: (sessionId: string, meta: Record<string, unknown>) => unknown,
 *   audio?: (sessionId: string, chunk: Uint8Array) => unknown,
 *   events?: (sessionId: string, lines: string) => unknown,
 *   turns?: (sessionId: string, lines: string) => unknown,
 *   finalize?: (sessionId: string, info?: { sampleRate?: number }) => unknown
 * }} SessionSink
 */
/** @type {SessionSink | null} */
let sink = null
let persistChain = Promise.resolve()
let sessionId = ''
let sessionStarted = false
let persistedSampleRate = 0
let persistFlushTimer = 0
/** @type {Uint8Array[]} */
let pendingAudio = []
let pendingAudioBytes = 0
/** @type {string[]} */
let pendingEvents = []
/** @type {string[]} */
let pendingTurns = []
let lastBaseCaptureAt = 0
/**
 * Fallos CONSECUTIVOS por canal (`audio`, `events`, `turns`, `start`, `finalize`).
 * Por canal y no global: antes un éxito de `events` borraba el contador y el
 * fallo permanente de `audio` quedaba invisible (medido 2026-10-19: audio.pcm=0
 * durante 30 min sin una sola línea de error).
 * @type {Map<string, number>}
 */
const persistFailures = new Map()
/** Canales detenidos tras 5 fallos consecutivos: no se reintentan ni se registran. */
/** @type {Set<string>} */
const persistChannelsDown = new Set()
/**
 * HUECOS DE AUDIO declarados: el audio NUNCA se apaga (un canal roto de audio deja la
 * grabación sin la locución que se quiere medir). Si un lote se pierde, se anota dónde
 * faltó y se sigue: la grabación queda marcada como incompleta en vez de truncada en
 * silencio (medido 2026-10-23: el PCM terminaba antes que la sesión y los últimos
 * `final` del ASR caían sobre "silencio" que en realidad nunca se guardó).
 * @type {Array<{ sample: number, at: number }>}
 */
const audioGaps = []
// Tras cerrar la sesión no se abre otra por eventos tardíos (los logs siguen
// corriendo después de `finalize`): la captura queda cerrada hasta un enable.
let persistClosed = false

/** @type {boolean} */
let enabled = IS_DEV && FLU_CONFIG.recorder?.enabled === true
let flagRead = false
let startedAt = 0

/** @type {Int16Array[]} */
let audioBlocks = []
let audioSamples = 0
let recordingSampleRate = 0
let audioTruncated = false
/** @type {Array<{ t: number, sample: number }>} */
let audioMarkers = []
let lastMarkerAt = 0

/** @type {Array<Record<string, unknown>>} */
let events = []
let eventSeq = 0
let droppedEvents = 0

function readStorageFlag() {
  if (flagRead) return
  flagRead = true
  if (!IS_DEV || !hasLocalStorage()) return
  try {
    const value = localGet(STORAGE_KEY)
    if (value === '1') enabled = true
    if (value === '0') enabled = false
  } catch (error) {
    logCaughtError('sessionRecorder.readStorageFlag', error)
  }
}

function resolveMaxMinutes() {
  const value = Number(FLU_CONFIG.recorder?.maxMinutes)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_MINUTES
}

function resolveMaxEvents() {
  const value = Number(FLU_CONFIG.recorder?.maxEvents)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_EVENTS
}

function maxAudioSamples() {
  const rate = recordingSampleRate || DEFAULT_SAMPLE_RATE
  return Math.max(1, Math.round(resolveMaxMinutes() * 60 * rate))
}

function clipString(value, max = STRING_MAX) {
  const text = String(value)
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * Copia segura para exportar: acota profundidad, tamaño de cadenas y colecciones.
 * Evita que un objeto circular o gigantesco rompa el JSON de la grabación.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
function safeData(value, depth = 0) {
  if (value == null) return null
  const type = typeof value
  if (type === 'string') return clipString(value)
  if (type === 'number' || type === 'boolean') return value
  if (type === 'bigint') return String(value)
  if (type === 'function' || type === 'symbol') return `[${type}]`
  if (depth >= DEPTH_MAX) return '[depth]'
  if (Array.isArray(value)) return value.slice(0, ARRAY_MAX).map((item) => safeData(item, depth + 1))
  if (type === 'object') {
    try {
      const out = {}
      for (const [key, item] of Object.entries(value).slice(0, OBJECT_KEYS_MAX)) {
        out[key] = safeData(item, depth + 1)
      }
      return out
    } catch (error) {
      logCaughtError('sessionRecorder.safeData', error)
      return '[unserializable]'
    }
  }
  return String(value)
}

/**
 * Inyecta el sumidero de persistencia (dev-server). Sin él, la grabación sigue
 * siendo SOLO en memoria (pruebas y producción).
 * @param {SessionSink | null} nextSink
 * @returns {void}
 */
export function configureSessionSink(nextSink) {
  sink = nextSink || null
  persistFailures.clear()
  persistChannelsDown.clear()
  persistClosed = false
}

/**
 * Sumidero HTTP contra `/__flu/recorder` (middleware de desarrollo).
 * @param {{ base?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {SessionSink}
 */
export function createHttpSessionSink({ base = '/__flu/recorder', fetchImpl } = {}) {
  const send = (path, { json, text, body } = {}) => {
    const url = `${base}${path}`
    let payload = body
    let contentType = 'application/octet-stream'
    if (json !== undefined) {
      payload = JSON.stringify(json)
      contentType = 'application/json'
    } else if (text !== undefined) {
      payload = text
      contentType = 'text/plain;charset=utf-8'
    }
    // EN DESCARGA, `sendBeacon` es la vía que el navegador garantiza: un fetch
    // iniciado tras la importación dinámica del cierre no llega (medido en la
    // verificación real: la sesión quedó sin `manifest.json`).
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    if (hidden && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = payload === undefined ? undefined : new Blob([payload], { type: contentType })
        if (blob ? navigator.sendBeacon(url, blob) : navigator.sendBeacon(url)) return Promise.resolve(null)
      } catch (error) {
        logCaughtError('sessionRecorder.beacon', error)
      }
    }
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null)
    if (!doFetch) return Promise.resolve(null)
    // `keepalive` SOLO en el cierre (documento oculto): un fetch normal no necesita
    // sobrevivir a la página, y Chromium limita el cuerpo `keepalive` a 64 KiB; el
    // lote de audio de 1 s (96 KB) lo superaba y el navegador lo rechazaba.
    const init = { method: 'POST' }
    if (hidden) init.keepalive = true
    if (json !== undefined) {
      init.headers = { 'content-type': 'application/json' }
      init.body = JSON.stringify(json)
    } else if (text !== undefined) {
      init.headers = { 'content-type': 'text/plain;charset=utf-8' }
      init.body = text
    } else if (body !== undefined) {
      init.headers = { 'content-type': 'application/octet-stream' }
      init.body = body
    }
    return doFetch(url, init)
  }
  const q = (id) => `?session=${encodeURIComponent(id)}`
  return {
    start: (id, meta) => send('/start', { json: { sessionId: id, meta } }),
    audio: (id, chunk) => send(`/audio${q(id)}`, { body: chunk }),
    events: (id, lines) => send(`/events${q(id)}`, { text: lines }),
    turns: (id, lines) => send(`/turns${q(id)}`, { text: lines }),
    finalize: (id, info) => send(`/finalize${q(id)}`, { json: { sampleRate: info?.sampleRate || 0 } }),
  }
}

function newSessionId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch (error) {
    logCaughtError('sessionRecorder.newSessionId', error)
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function persistMeta() {
  return {
    startedAt: startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
    sampleRate: recordingSampleRate || 0,
    maxMinutes: resolveMaxMinutes(),
    maxEvents: resolveMaxEvents(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    url: typeof location !== 'undefined' ? location.href : '',
    language: typeof navigator !== 'undefined' ? navigator.language : '',
  }
}

/**
 * Encola una operación del sumidero en UNA sola cadena: el orden (audio, eventos,
 * turnos, finalize) se respeta aunque cada envío sea asíncrono.
 * @param {string} label
 * @param {() => unknown} task
 * @returns {Promise<unknown>}
 */
function enqueuePersist(label, task) {
  if (persistChannelsDown.has(label)) return persistChain
  persistChain = persistChain
    .then(() => (persistChannelsDown.has(label) ? undefined : Promise.resolve(task())))
    .then((result) => {
      // El éxito solo limpia SU canal: un canal sano no puede tapar el fallo de otro.
      persistFailures.delete(label)
      return result
    })
    .catch((error) => {
      const attempts = (persistFailures.get(label) || 0) + 1
      persistFailures.set(label, attempts)
      // AUDIO: nunca se apaga. Un lote perdido es un HUECO declarado, no el fin del audio
      // (sin audio fiel no hay tramo, ni medida, ni playback: ver PORTERO A1).
      if (label === 'audio') {
        audioGaps.push({ sample: audioSamples, at: Date.now() })
        if (attempts === 5) logCaughtError('sessionRecorder.audioGap', error, { attempts })
        return
      }
      if (attempts < 5) return
      persistChannelsDown.add(label)
      // CIRCUIT BREAKER por canal: se detiene el canal roto y se registra UNA vez.
      // `events` no se registra por sí mismo (el registro viaja por ese canal y se
      // re-alimentaría); su caída queda en `status().channelsDown`.
      if (label !== 'events') {
        logCaughtError('sessionRecorder.persistChannel', error, { label, attempts })
      }
    })
  return persistChain
}

/** Abre la sesión de persistencia la primera vez que hay algo que guardar. */
function ensurePersistSession() {
  if (!sink || !enabled || persistClosed) return false
  if (!sessionId) sessionId = newSessionId()
  const sampleRate = recordingSampleRate || 0
  const needsStart = !sessionStarted || (sampleRate > 0 && sampleRate !== persistedSampleRate)
  if (!needsStart) return true
  sessionStarted = true
  persistedSampleRate = sampleRate
  const id = sessionId
  enqueuePersist('start', () => sink?.start?.(id, persistMeta()))
  // La base de participantes se fotografía al abrir la sesión (vectores completos).
  if (!lastBaseCaptureAt) void captureBaseSnapshot('session-start')
  return true
}

/**
 * Copia íntegra para el NDJSON de la grabación: conserva arrays ENTEROS (los
 * vectores de 512 dimensiones no pueden pasar por `safeData`, que los corta a 50).
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
function fullCopy(value, depth = 0) {
  if (value == null) return null
  const type = typeof value
  if (type === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}…` : value
  if (type === 'number' || type === 'boolean') return value
  if (type === 'bigint') return String(value)
  if (type === 'function' || type === 'symbol') return undefined
  if (depth >= 8) return '[depth]'
  if (Array.isArray(value)) return value.map((item) => fullCopy(item, depth + 1))
  if (type === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      const copied = fullCopy(item, depth + 1)
      if (copied !== undefined) out[key] = copied
    }
    return out
  }
  return String(value)
}

/** Extrae el PCM pendiente como un único bloque (o null si no hay). */
function drainAudioChunk() {
  if (pendingAudioBytes <= 0) return null
  const chunk = new Uint8Array(pendingAudioBytes)
  let offset = 0
  for (const part of pendingAudio) {
    chunk.set(part, offset)
    offset += part.length
  }
  pendingAudio = []
  pendingAudioBytes = 0
  return chunk
}

/** Vacía los acumuladores hacia el sumidero (respeta orden con la cadena). */
function flushPersist() {
  if (persistFlushTimer) {
    clearTimeout(persistFlushTimer)
    persistFlushTimer = 0
  }
  const target = sink
  if (!target || !sessionId) return
  const id = sessionId
  const chunk = drainAudioChunk()
  if (chunk) enqueuePersist('audio', () => target.audio?.(id, chunk))
  if (pendingEvents.length) {
    const lines = pendingEvents.join('')
    pendingEvents = []
    enqueuePersist('events', () => target.events?.(id, lines))
  }
  if (pendingTurns.length) {
    const lines = pendingTurns.join('')
    pendingTurns = []
    enqueuePersist('turns', () => target.turns?.(id, lines))
  }
}

function schedulePersistFlush() {
  if (persistFlushTimer || typeof setTimeout === 'undefined') return
  persistFlushTimer = setTimeout(() => {
    persistFlushTimer = 0
    flushPersist()
  }, PERSIST_FLUSH_MS)
}

/**
 * Añade una instantánea (turno o base) al NDJSON de persistencia, sin recortar
 * vectores. `kind` distingue `turn`, `base` y `voice-directory`.
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function queuePersistSnapshot(row) {
  if (!isSessionRecordingEnabled() || !sink || persistChannelsDown.has('turns')) return false
  try {
    ensurePersistSession()
    if (!sessionId) return false
    const now = Date.now()
    const line = JSON.stringify({ t: now, iso: new Date(now).toISOString(), ...fullCopy(row) })
    pendingTurns.push(`${line}\n`)
    if (pendingTurns.length >= PERSIST_TURN_ROWS) flushPersist()
    else schedulePersistFlush()
    return true
  } catch (error) {
    logCaughtError('sessionRecorder.queuePersistSnapshot', error)
    return false
  }
}

/**
 * Instantánea de un turno emitido: texto, hablante resuelto, vector del turno,
 * clusters de la sesión y estado de identidad. Es el dato que permite recrear la
 * diarización sin adivinar.
 * @param {Record<string, unknown>} turn
 * @returns {boolean}
 */
export function recordSessionTurn(turn = {}) {
  if (!isSessionRecordingEnabled() || !sink) return false
  return queuePersistSnapshot({ kind: 'turn', ...turn })
}

/**
 * Fotografía la base de participantes y el directorio de voces (vectores
 * COMPLETOS). Se dispara al abrir la sesión y al cerrarla; nunca en producción.
 * @param {string} [reason]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function captureBaseSnapshot(reason = 'manual') {
  if (!isSessionRecordingEnabled() || !sink) return null
  // En Node/pruebas no hay IndexedDB: la instantánea no aplica.
  if (typeof indexedDB === 'undefined') return null
  try {
    const [{ fluDb }, directory] = await Promise.all([
      import('../../core/db/fluDatabase.ts'),
      import('./speakerDirectory.js'),
    ])
    const rows = await fluDb.participants.toArray()
    const participants = rows
      .filter((row) => !row.sync?.deleted)
      .map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        speakerLabel: row.speakerLabel || '',
        voiceVectorModel: row.voiceVectorModel || '',
        voiceAnchorVerified: row.voiceAnchorVerified === true,
        voiceVector: Array.isArray(row.voiceVector) ? row.voiceVector : null,
      }))
    lastBaseCaptureAt = Date.now()
    const snapshot = {
      kind: 'base',
      reason,
      model: directory.voiceVectorModel?.() || '',
      participants,
      directory: directory.getVoiceDirectorySnapshot?.() || [],
    }
    queuePersistSnapshot(snapshot)
    flushPersist()
    return snapshot
  } catch (error) {
    logCaughtError('sessionRecorder.captureBaseSnapshot', error, { reason })
    return null
  }
}

/**
 * Cierra la sesión de persistencia: vuelca lo pendiente y pide el WAV final.
 * La fotografía de la base es opcional porque en `pagehide` las importaciones
 * dinámicas se cancelan y retrasarían (o perderían) el cierre.
 * `sync` emite los envíos DENTRO del propio handler de `pagehide` (sin cadena de
 * promesas): es la única forma en que el navegador garantiza los `sendBeacon`
 * cuando la descarga ya empezó.
 * @param {{ withBase?: boolean, sync?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function finalizeSessionRecording({ withBase = true, sync = false } = {}) {
  const target = sink
  if (!target || !sessionId) return
  const id = sessionId
  // El cierre viaja con la tasa REAL del PCM: la actualización de tasa va en un
  // `start` encolado que puede no llegar antes de que la pestaña muera, y el
  // servidor construiría el WAV con una tasa supuesta (medido: 16 kHz → 48 kHz).
  const rateInfo = { sampleRate: recordingSampleRate || 0 }
  if (withBase) {
    try {
      await captureBaseSnapshot('finalize')
    } catch (error) {
      logCaughtError('sessionRecorder.finalize.base', error)
    }
  }
  if (sync) {
    const sendSync = (label, task) => {
      try {
        const result = task()
        if (result && typeof result.catch === 'function') {
          result.catch((error) => logCaughtError(`sessionRecorder.finalizeSync.${label}`, error))
        }
      } catch (error) {
        logCaughtError(`sessionRecorder.finalizeSync.${label}`, error)
      }
    }
    const chunk = drainAudioChunk()
    if (chunk) sendSync('audio', () => target.audio?.(id, chunk))
    if (pendingEvents.length) {
      const lines = pendingEvents.join('')
      pendingEvents = []
      sendSync('events', () => target.events?.(id, lines))
    }
    if (pendingTurns.length) {
      const lines = pendingTurns.join('')
      pendingTurns = []
      sendSync('turns', () => target.turns?.(id, lines))
    }
    persistClosed = true
    sessionId = ''
    sessionStarted = false
    persistedSampleRate = 0
    sendSync('finalize', () => target.finalize?.(id, rateInfo))
    return
  }
  flushPersist()
  persistClosed = true
  sessionId = ''
  sessionStarted = false
  persistedSampleRate = 0
  enqueuePersist('finalize', () => target.finalize?.(id, rateInfo))
  await persistChain
}

/**
 * @returns {boolean} true solo en desarrollo y con la bandera encendida.
 */
export function isSessionRecordingEnabled() {
  readStorageFlag()
  return IS_DEV && enabled
}

/**
 * Enciende la grabación y persiste la bandera.
 * @returns {boolean} estado efectivo
 */
export function enableSessionRecorder() {
  if (!IS_DEV) return false
  flagRead = true
  enabled = true
  persistClosed = false
  try {
    localSet(STORAGE_KEY, '1')
  } catch (error) {
    logCaughtError('sessionRecorder.enable', error)
  }
  if (!startedAt) startedAt = Date.now()
  ensurePersistSession()
  console.info('[Flu][recorder] Encendido — __fluDev.recorder.download()')
  return true
}

/**
 * Apaga la grabación (lo ya grabado se conserva para descargar) y persiste la bandera.
 * @returns {boolean} estado efectivo
 */
export function disableSessionRecorder() {
  flagRead = true
  enabled = false
  try {
    localSet(STORAGE_KEY, '0')
  } catch (error) {
    logCaughtError('sessionRecorder.disable', error)
  }
  if (sink && sessionId) void finalizeSessionRecording()
  console.info('[Flu][recorder] Apagado')
  return false
}

/**
 * Descarta audio y eventos de la sesión actual (no toca la bandera).
 * @returns {void}
 */
export function clearSessionRecording() {
  // Lo pendiente pertenece a la sesión anterior: se vuelca antes de soltar el id.
  if (sink && sessionId) flushPersist()
  if (persistFlushTimer) {
    clearTimeout(persistFlushTimer)
    persistFlushTimer = 0
  }
  pendingAudio = []
  pendingAudioBytes = 0
  pendingEvents = []
  pendingTurns = []
  sessionId = ''
  sessionStarted = false
  persistedSampleRate = 0
  persistClosed = false
  // Frontera de sesión: los canales detenidos vuelven a intentarlo en la nueva.
  persistFailures.clear()
  persistChannelsDown.clear()
  lastBaseCaptureAt = 0
  audioBlocks = []
  audioSamples = 0
  recordingSampleRate = 0
  audioTruncated = false
  audioGaps.length = 0
  audioMarkers = []
  lastMarkerAt = 0
  events = []
  eventSeq = 0
  droppedEvents = 0
  startedAt = 0
}

/**
 * Añade un bloque PCM del micrófono a la grabación.
 * @param {Float32Array} samples muestras a la tasa real del AudioContext
 * @param {number} sampleRate tasa de las muestras
 * @returns {boolean} true si el bloque se aceptó (memoria y/o sumidero)
 */
export function pushSessionAudio(samples, sampleRate) {
  if (!isSessionRecordingEnabled() || !samples?.length) return false
  try {
    const rate = Number(sampleRate) || DEFAULT_SAMPLE_RATE
    if (!recordingSampleRate) recordingSampleRate = rate
    // La tasa del AudioContext es estable; si cambiara, se adapta el bloque a la
    // tasa ya grabada para que el WAV tenga UNA sola tasa coherente.
    const adapted =
      rate === recordingSampleRate
        ? samples
        : resampleLinear(samples, rate, recordingSampleRate)
    const pcm = float32ToInt16(adapted)
    if (!pcm.length) return false

    // Memoria ACOTADA (WAV local / snapshot): solo los primeros `maxMinutes`.
    // Tras el tope, el bloque SIGUE volcándose al sumidero (disco): la sesión
    // completa — con silencios — vive en el server, no en la pestaña.
    const room = maxAudioSamples() - audioSamples
    if (room > 0) {
      const block = room >= pcm.length ? pcm : pcm.subarray(0, room)
      // Copia propia: un subarray mantendría vivo el buffer entero, y el audio
      // original puede reutilizarse aguas arriba.
      audioBlocks.push(new Int16Array(block))
      audioSamples += block.length
    }
    if (audioSamples >= maxAudioSamples()) audioTruncated = true

    // Volcado continuo a disco: el PCM se copia en el MISMO punto en que se
    // guarda en memoria (una sola fuente de audio, no dos capturas).
    if (sink && !persistChannelsDown.has('audio') && ensurePersistSession()) {
      const bytes = new Uint8Array(pcm.length * 2)
      bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
      pendingAudio.push(bytes)
      pendingAudioBytes += bytes.length
      if (pendingAudioBytes >= PERSIST_AUDIO_BYTES) flushPersist()
      else schedulePersistFlush()
    }

    const now = Date.now()
    if (!startedAt) startedAt = now
    if (now - lastMarkerAt >= MARKER_INTERVAL_MS) {
      audioMarkers.push({ t: now, sample: audioSamples })
      lastMarkerAt = now
    }
    return true
  } catch (error) {
    logCaughtError('sessionRecorder.pushSessionAudio', error)
    return false
  }
}

/**
 * Añade un evento de cualquier subsistema a la grabación.
 * @param {string} category familia del evento (`listen`, `trace`, `log`, ...)
 * @param {string} event nombre del evento o etapa
 * @param {unknown} [data] datos de diagnóstico (se copian con topes)
 * @returns {boolean} true si el evento se guardó
 */
export function recordSessionEvent(category, event, data = null) {
  if (!isSessionRecordingEnabled()) return false
  try {
    const now = Date.now()
    if (!startedAt) startedAt = now
    eventSeq += 1
    const row = {
      seq: eventSeq,
      t: now,
      iso: new Date(now).toISOString(),
      category: clipString(category, 80),
      event: clipString(event, 160),
      data: safeData(data),
    }
    events.push(row)
    const max = resolveMaxEvents()
    if (events.length > max) {
      const excess = events.length - max
      events.splice(0, excess)
      droppedEvents += excess
    }
    // Mismo evento, mismo caudal: se vuelca a disco lo que ya se guardó en memoria.
    if (sink && !persistChannelsDown.has('events')) {
      ensurePersistSession()
      pendingEvents.push(`${JSON.stringify(row)}\n`)
      if (pendingEvents.length >= PERSIST_EVENT_ROWS) flushPersist()
      else schedulePersistFlush()
    }
    return true
  } catch (error) {
    logCaughtError('sessionRecorder.recordSessionEvent', error)
    return false
  }
}

/**
 * WAV 16-bit mono de lo grabado (RIFF/WAVE canónico).
 * @returns {Blob}
 */
export function buildSessionWavBlob() {
  const rate = recordingSampleRate || DEFAULT_SAMPLE_RATE
  const dataSize = audioSamples * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM lineal
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (const block of audioBlocks) {
    for (let i = 0; i < block.length; i += 1) {
      view.setInt16(offset, block[i], true)
      offset += 2
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Estado legible para la consola (sin volcar audio ni eventos).
 * @returns {SessionRecorderStatus}
 */
export function getSessionRecordingStatus() {
  const rate = recordingSampleRate || DEFAULT_SAMPLE_RATE
  return {
    enabled: isSessionRecordingEnabled(),
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    durationMs: startedAt ? Date.now() - startedAt : 0,
    audioSeconds: Math.round((audioSamples / rate) * 100) / 100,
    sampleRate: rate,
    audioTruncated,
    audioGaps: audioGaps.length,
    events: events.length,
    droppedEvents,
    maxMinutes: resolveMaxMinutes(),
    maxEvents: resolveMaxEvents(),
    persisted: Boolean(sink) && persistChannelsDown.size === 0,
    channelsDown: [...persistChannelsDown],
    sessionId,
    pendingPersist: pendingAudioBytes + pendingEvents.length + pendingTurns.length,
  }
}

/**
 * Copia exportable: metadatos + marcadores + eventos (sin el PCM).
 * @returns {SessionRecordingSnapshot}
 */
export function getSessionRecordingSnapshot() {
  const rate = recordingSampleRate || DEFAULT_SAMPLE_RATE
  return {
    exportedAt: new Date().toISOString(),
    status: getSessionRecordingStatus(),
    audio: {
      sampleRate: rate,
      samples: audioSamples,
      seconds: Math.round((audioSamples / rate) * 100) / 100,
      truncated: audioTruncated,
      markers: audioMarkers.slice(),
    },
    events: events.slice(),
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Descarga WAV + JSON con el mismo sello temporal.
 * @param {string} [filenameBase] base opcional sin extensión
 * @returns {SessionRecordingSnapshot} snapshot exportado
 */
export function downloadSessionRecording(filenameBase) {
  const snapshot = getSessionRecordingSnapshot()
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return snapshot
  }
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const base = filenameBase || `flu-session-${stamp}`
    if (audioSamples > 0) downloadBlob(buildSessionWavBlob(), `${base}.wav`)
    const json = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    downloadBlob(json, `${base}.json`)
    console.info('[Flu][recorder] Descargado', { base, events: events.length, seconds: snapshot.audio.seconds })
  } catch (error) {
    logCaughtError('sessionRecorder.download', error)
  }
  return snapshot
}

/**
 * API de consola expuesta en `window.__fluDev.recorder`.
 * @returns {Record<string, unknown>}
 */
export function getSessionRecorderApi() {
  return {
    enabled: isSessionRecordingEnabled,
    enable: enableSessionRecorder,
    disable: disableSessionRecorder,
    status: getSessionRecordingStatus,
    snapshot: getSessionRecordingSnapshot,
    download: downloadSessionRecording,
    clear: clearSessionRecording,
    finalize: finalizeSessionRecording,
    captureBase: captureBaseSnapshot,
    configureSink: configureSessionSink,
    // Instrumentación dev: inyecta PCM sin micrófono (verifica la cadena audio→WAV).
    injectAudio: (samples, sampleRate) => pushSessionAudio(samples, sampleRate),
  }
}

if (IS_DEV && typeof window !== 'undefined') {
  window.__fluDev = window.__fluDev || {}
  window.__fluDev.recorder = getSessionRecorderApi()
  // Al cerrar o recargar la pestaña, lo pendiente se vuelca y se cierra el WAV.
  // En ese cierre el sumidero HTTP usa `sendBeacon`/`keepalive`; los lotes
  // continuos viajan con fetch normal (el `keepalive` tiene tope de 64 KiB).
  window.addEventListener('pagehide', () => {
    // Sin fotografía de base (sus `import()` no sobreviven) y con envío SÍNCRONO:
    // los `sendBeacon` se emiten dentro del propio handler de descarga.
    void finalizeSessionRecording({ withBase: false, sync: true })
  })
}
