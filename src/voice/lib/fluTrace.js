/**
 * Traza estructurada para diagnóstico (dev): ring buffer exportable.
 * Activar: localStorage.setItem('flu.trace','1') o __fluDev.trace.enable()
 * Volcar: __fluDev.trace.dump() / __fluDev.trace.download()
 */
import { FLU_CONFIG } from './fluConfig.js'
import { logCaughtError } from '../../lib/caughtError';

const IS_DEV = Boolean(import.meta.env?.DEV)
const DEFAULT_MAX = Number(FLU_CONFIG.trace?.ringSize) || 800

/** @type {boolean} */
let enabled = IS_DEV && FLU_CONFIG.trace?.enabled !== false

/** @type {Array<Record<string, unknown>>} */
const ring = []

/** @type {(() => Record<string, unknown>) | null} */
let sessionProvider = null

/** @type {ReturnType<typeof setTimeout> | null} */
let agentSinkTimer = null
const AGENT_SINK_MS = Number(FLU_CONFIG.trace?.agentSinkMs) || 1200

/** Conteo acumulado de eventos ya enviados al agente (para enviar deltas). */
let sentEventCount = 0

function readStorageFlag() {
  if (!IS_DEV || typeof localStorage === 'undefined') return
  try {
    const value = localStorage.getItem('flu.trace')
    if (value === '1') enabled = true
    if (value === '0') enabled = false
  } catch (e) {
        logCaughtError('[catch] src/voice/lib/fluTrace.js', e);
    /* ignore */
  }
}

function trimText(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function sanitize(data) {
  if (!data || typeof data !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue
    if (typeof value === 'string') out[key] = trimText(value, key === 'capture' ? 400 : 200)
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
    else if (Array.isArray(value)) out[key] = value.slice(0, 12)
    else out[key] = value
  }
  return out
}

export function initFluTrace() {
  if (!IS_DEV) {
    enabled = false
    return false
  }
  readStorageFlag()
  if (enabled && typeof window !== 'undefined') {
    window.__FLU_LISTEN_DEBUG = true
    console.info(
      '[Flu][trace] Activo — agente lee logs/agent-trace.json · dump: __fluDev.trace.dump()',
    )
  }
  return enabled
}

function scheduleAgentSink() {
  if (!IS_DEV || !enabled || typeof window === 'undefined') return
  if (agentSinkTimer) return
  agentSinkTimer = window.setTimeout(() => {
    agentSinkTimer = null
    try {
      const snapshot = getFluTraceSnapshot()
      const events = snapshot.events
      // El ring se recorta por el frente (splice) al llegar a max: si el
      // contador ya supera la longitud actual, reenviar lo que quede.
      if (sentEventCount > events.length) sentEventCount = 0
      // Enviar SOLO los eventos nuevos desde el último flush (delta), no el
      // ring completo. Re-serializar el ring entero (hasta 800 eventos con
      // capturas largas) en cada flush provocaba jank del hilo principal en
      // dev y una re-subida repetida del mismo payload en crecimiento.
      const newEvents = events.slice(sentEventCount)
      sentEventCount = events.length
      const body = JSON.stringify({
        exportedAt: snapshot.exportedAt,
        enabled: snapshot.enabled,
        count: snapshot.count,
        max: snapshot.max,
        session: snapshot.session,
        summary: snapshot.summary,
        delta: true,
        events: newEvents.slice(-50),
      })
      void fetch('/__flu_agent_trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch((error) => {
        if (IS_DEV) console.warn('[Flu][trace] agent sink failed:', error?.message || error)
      })
    } catch (e) {
        logCaughtError('[catch] src/voice/lib/fluTrace.js', e);
      // ignore
    }
  }, AGENT_SINK_MS)
}

export function isFluTraceEnabled() {
  return IS_DEV && enabled
}

export function enableFluTrace() {
  if (!IS_DEV) return false
  enabled = true
  try {
    localStorage.setItem('flu.trace', '1')
  } catch (e) {
        logCaughtError('[catch] src/voice/lib/fluTrace.js', e);
    /* ignore */
  }
  console.info('[Flu][trace] Encendido')
  return true
}

export function disableFluTrace() {
  enabled = false
  try {
    localStorage.setItem('flu.trace', '0')
  } catch (e) {
        logCaughtError('[catch] src/voice/lib/fluTrace.js', e);
    /* ignore */
  }
  console.info('[Flu][trace] Apagado')
  return false
}

export function clearFluTrace() {
  ring.length = 0
  sentEventCount = 0
}

/** @param {() => Record<string, unknown>} provider */
export function setFluTraceSessionProvider(provider) {
  sessionProvider = typeof provider === 'function' ? provider : null
}

/**
 * @param {'ingress'|'stream'|'speaker'|'log'|'recognition'|'command'|'skip'} category
 * @param {string} event
 * @param {Record<string, unknown>} [data]
 */
export function fluTrace(category, event, data = {}) {
  if (!IS_DEV || !enabled) return
  const row = {
    t: Date.now(),
    iso: new Date().toISOString().slice(11, 23),
    category,
    event,
    ...sanitize(data),
  }
  ring.push(row)
  const max = DEFAULT_MAX
  if (ring.length > max) ring.splice(0, ring.length - max)
  if (FLU_CONFIG.trace?.mirrorConsole) {
    console.info(`[Flu][trace] ${category}/${event}`, row)
  }
  if (FLU_CONFIG.trace?.agentSink !== false) {
    scheduleAgentSink()
  }
}

export function getFluTraceSnapshot() {
  let session = {}
  try {
    session = sessionProvider?.() || {}
  } catch (e) {
        logCaughtError('[catch] src/voice/lib/fluTrace.js', e);
    session = { sessionError: true }
  }
  return {
    exportedAt: new Date().toISOString(),
    enabled,
    count: ring.length,
    max: DEFAULT_MAX,
    session: sanitize(session),
    events: ring.slice(),
    summary: summarizeTrace(ring),
  }
}

function summarizeTrace(events) {
  const byEvent = {}
  for (const row of events) {
    const key = `${row.category}/${row.event}`
    byEvent[key] = (byEvent[key] || 0) + 1
  }
  const top = Object.entries(byEvent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([k, n]) => `${k}:${n}`)
  return { top, total: events.length }
}

export function dumpFluTrace() {
  const snapshot = getFluTraceSnapshot()
  console.info('[Flu][trace] dump', snapshot.summary)
  return snapshot
}

export function downloadFluTrace(filename) {
  const snapshot = getFluTraceSnapshot()
  const name =
    filename ||
    `flu-trace-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
  return snapshot
}

export function getFluTraceApi() {
  return {
    enabled: () => enabled,
    enable: enableFluTrace,
    disable: disableFluTrace,
    clear: clearFluTrace,
    dump: dumpFluTrace,
    download: downloadFluTrace,
    snapshot: getFluTraceSnapshot,
    events: () => ring.slice(),
  }
}

export function mountFluTraceDev() {
  if (!IS_DEV || typeof window === 'undefined') return
  const api = getFluTraceApi()
  window.__fluDev = window.__fluDev || {}
  window.__fluDev.trace = api
}
