/**
 * Monitoreo de diarización (dev): ring + traza estructurada.
 * Consola: __fluDev.speakerMonitor.dump()
 */
import { fluTrace } from './fluTrace.js'
import { getSpeakerEmbeddingModelStatus } from './speakerEmbedding.js'

const IS_DEV = Boolean(import.meta.env?.DEV)
const RING_MAX = 48

/** @type {Array<Record<string, unknown>>} */
const ring = []

function trim(value, max = 200) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} data
 */
export function traceSpeakerDiarize(event, data = {}) {
  if (!IS_DEV) return
  const row = {
    t: Date.now(),
    iso: new Date().toISOString().slice(11, 23),
    event,
    ...data,
  }
  if (row.utterance) row.utterance = trim(row.utterance, 280)
  if (row.capture) row.capture = trim(row.capture, 280)
  ring.push(row)
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
  fluTrace('speaker', event, data)
}

export function getSpeakerDiarizeMonitorSnapshot() {
  return {
    count: ring.length,
    max: RING_MAX,
    recent: ring.slice(),
  }
}

export function dumpSpeakerDiarizeMonitor() {
  const snapshot = getSpeakerDiarizeMonitorSnapshot()
  console.info('[Flu][speaker-monitor]', snapshot.recent.slice(-12))
  return snapshot
}

export function mountSpeakerDiarizeMonitorDev() {
  if (!IS_DEV || typeof window === 'undefined') return
  window.__fluDev = window.__fluDev || {}
  window.__fluDev.speakerMonitor = {
    dump: dumpSpeakerDiarizeMonitor,
    snapshot: getSpeakerDiarizeMonitorSnapshot,
    events: () => ring.slice(),
  }
  window.__fluDev.speakerModel = () => getSpeakerEmbeddingModelStatus()
}
