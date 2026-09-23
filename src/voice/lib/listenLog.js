/**
 * Traza consola (dev) + ring opcional (__FLU_LISTEN_DEBUG).
 * Panel mic: solo vía micIngressLog.js (texto publicado en ingress).
 * Consola chrome-raw: opcional, no alimenta el panel.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { fluAsyncErrorHandler } from './fluAsyncError.js'
import { snapshotChromeSpeechResult } from './chromeSpeechSnapshot.js'

export { snapshotChromeSpeechResult } from './chromeSpeechSnapshot.js'
import { logCaughtError } from '../../lib/caughtError';

const IS_DEV = import.meta.env.DEV
const RING_MAX = 200
const SIM_STAGES = new Set(['sim-start', 'sim-done', 'sim-abort'])
const FILE_STAGES = new Set(['chrome-raw', 'final', 'mic-ingress'])

const ring = new Array(RING_MAX)
let ringHead = 0
let ringCount = 0
let devFlushTimer = null
const devPending = []
let chromeRawSeq = 0

function syncListenLogGlobals() {
  if (!IS_DEV || typeof window === 'undefined') return
  window.__fluListenLog = getListenLogRing()
  window.__fluListenLogStats = getListenStats()
}

export function isListenTraceEnabled() {
  if (!IS_DEV || typeof window === 'undefined') return false
  if (window.__FLU_LISTEN_DEBUG === false) return false
  if (window.__FLU_LISTEN_DEBUG === true) return true
  return FLU_CONFIG.debug?.listenTrace !== false
}

export function isChromeRawConsoleEnabled() {
  if (!IS_DEV || typeof window === 'undefined') return false
  if (window.__FLU_CHROME_RAW_CONSOLE === false) return false
  if (window.__FLU_MIC_RAW_CONSOLE === false) return false
  if (window.__FLU_CHROME_RAW_CONSOLE === true) return true
  if (window.__FLU_MIC_RAW_CONSOLE === true) return true
  return FLU_CONFIG.debug?.chromeRawConsole !== false
}

function shouldRecord(stage) {
  if (!IS_DEV || typeof window === 'undefined') return false
  if (SIM_STAGES.has(stage)) return true
  return isListenTraceEnabled()
}

function serialize(entry) {
  try {
    return JSON.stringify(entry)
  } catch (e) {
        logCaughtError('[catch] src/voice/lib/listenLog.js', e);
    return JSON.stringify({ t: Date.now(), stage: 'log-serialize-error' })
  }
}

function pushRing(entry) {
  if (!shouldRecord(entry.stage)) return

  ring[ringHead] = entry
  ringHead = (ringHead + 1) % RING_MAX
  if (ringCount < RING_MAX) ringCount += 1
  syncListenLogGlobals()

  if (isListenTraceEnabled() && FILE_STAGES.has(entry.stage)) {
    devPending.push(serialize(entry))
    if (!devFlushTimer) {
      devFlushTimer = window.setTimeout(flushDevLogs, 200)
    }
  }
}

function flushDevLogs() {
  devFlushTimer = null
  if (!devPending.length || typeof window === 'undefined') return
  const batch = devPending.splice(0, devPending.length).join('\n')
  void fetch('/__flu_listen_log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body: `${batch}\n`,
  }).catch(fluAsyncErrorHandler('listenLog'))
}

export function fluEvent(stage, data = {}) {
  pushRing({ t: Date.now(), stage: String(stage || ''), ...data })
}


function logChromeRawConsole(channel, kind, text, seq) {
  console.info(`[Flu][chrome-raw] #${seq} ${kind} ${text}`)
}

/** Consola dev: fragmentos Chrome sin procesar (no alimenta panel ingress). */
export function logChromeSpeechResult(event) {
  if (typeof window === 'undefined' || !isChromeRawConsoleEnabled()) return

  const snapshot = snapshotChromeSpeechResult(event)
  if (!snapshot?.newResults?.length) return

  chromeRawSeq += 1

  for (const row of snapshot.newResults) {
    const kind = row.isFinal ? 'final' : 'interim'
    for (const alt of row.alternatives) {
      if (alt.transcript == null || alt.transcript === '') continue
      logChromeRawConsole('chrome-raw', kind, alt.transcript, chromeRawSeq)
      pushRing({
        t: Date.now(),
        stage: 'chrome-raw',
        seq: chromeRawSeq,
        kind,
        text: alt.transcript,
      })
    }
  }
}

export function getListenLogRing() {
  if (!ringCount) return []
  if (ringCount < RING_MAX) return ring.slice(0, ringCount)
  return ring.slice(ringHead).concat(ring.slice(0, ringHead))
}

export function clearListenLogRing() {
  ringHead = 0
  ringCount = 0
  syncListenLogGlobals()
}

export function getListenStats() {
  return { chromeRawSeq }
}
