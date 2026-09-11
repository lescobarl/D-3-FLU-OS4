/**
 * Productor ciego: captura STT crudo y lo encola. Sin lógica de negocio.
 */
import { buildCurrentPhraseFromResults } from './audioMath.js'
import { logMicProducerRaw } from './micIngressLog.js'
import { collectRecognitionResultChunks } from './transcriptIngress.js'

export function pushMicSpeechEvent(event, queue) {
  if (!queue || !event?.results?.length) return null

  const { interimChunks, finalChunks } = collectRecognitionResultChunks(event)
  const text = buildCurrentPhraseFromResults(event.results, event.resultIndex)
  const kind = finalChunks.length ? 'final' : 'interim'
  const chunks = kind === 'final' ? finalChunks : interimChunks
  if (!chunks.length && !text) return null

  logMicProducerRaw({ source: 'browser', kind, text })
  return queue.push({
    source: 'browser',
    kind,
    text,
    interimChunks,
    finalChunks,
  })
}

export function buildMicBurstEvent({ interim = '', final = '' } = {}) {
  const results = []
  const inter = String(interim ?? '').trim()
  const fin = String(final ?? '').trim()
  if (inter && inter !== fin) {
    results.push({ isFinal: false, 0: { transcript: inter }, length: 1 })
  }
  if (fin) {
    results.push({ isFinal: true, 0: { transcript: fin }, length: 1 })
  }
  if (!results.length) return null
  return { resultIndex: 0, results }
}

export function convertSimEventsToMicBursts(events = []) {
  const bursts = []
  let lastInterim = ''

  for (const event of events) {
    if (event?.type === 'pause') continue
    if (event?.type === 'interim') {
      lastInterim = String(event.text ?? '').trim()
      continue
    }
    if (event?.type === 'final') {
      const fin = String(event.text ?? '').trim()
      const mock = buildMicBurstEvent({ interim: lastInterim, final: fin })
      if (mock) bursts.push(mock)
      lastInterim = ''
    }
  }

  if (lastInterim) {
    const mock = buildMicBurstEvent({ interim: lastInterim })
    if (mock) bursts.push(mock)
  }

  return bursts
}

export function pushRecognitionEndEvent(queue) {
  if (!queue) return null
  return queue.push({
    source: 'browser',
    kind: 'recognition-end',
  })
}

export function pushSrGapEvent({ sinceLastResultMs = 0 }, queue) {
  if (!queue) return null
  return queue.push({
    source: 'browser',
    kind: 'sr-gap',
    sinceLastResultMs: Number(sinceLastResultMs) || 0,
  })
}
