/**
 * Productor ciego: captura STT crudo y lo encola. Sin lógica de negocio.
 */
import { buildCurrentPhraseFromResults } from './audioMath.js'
import { logMicProducerRaw } from './micIngressLog.js'
import { collectBrowserResultChunks } from './transcriptIngress.js'

export function pushBrowserSpeechEvent(event, queue) {
  if (!queue || !event?.results?.length) return null

  const { interimChunks, finalChunks } = collectBrowserResultChunks(event)
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

export function buildBrowserBurstEvent({ interim = '', final = '' } = {}) {
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

export function convertSimEventsToBrowserBursts(events = []) {
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
      const mock = buildBrowserBurstEvent({ interim: lastInterim, final: fin })
      if (mock) bursts.push(mock)
      lastInterim = ''
    }
  }

  if (lastInterim) {
    const mock = buildBrowserBurstEvent({ interim: lastInterim })
    if (mock) bursts.push(mock)
  }

  return bursts
}

export function buildMockBrowserSpeechEvent({ text = '', isFinal = false } = {}) {
  const phrase = String(text ?? '').trim()
  if (!phrase) return null
  return {
    resultIndex: 0,
    results: [
      {
        isFinal: Boolean(isFinal),
        0: { transcript: phrase },
        length: 1,
      },
    ],
  }
}

export function pushStreamSpeechEvent({ text = '', isFinal = false }, queue) {
  if (!queue) return null
  const phrase = String(text ?? '').trim()
  if (!phrase) return null

  logMicProducerRaw({
    source: 'stream',
    kind: isFinal ? 'final' : 'interim',
    text: phrase,
  })

  return queue.push({
    source: 'stream',
    kind: isFinal ? 'final' : 'interim',
    text: phrase,
    isFinal: Boolean(isFinal),
  })
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
