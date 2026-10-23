/**
 * Productor ciego: captura STT crudo y lo encola. Sin lógica de negocio.
 */
import { buildCurrentPhraseFromResults } from './audioMath.js'
import { logMicProducerRaw } from './micIngressLog.js'
import { voiceProbe } from './voiceProbe'
import { collectRecognitionResultChunks } from './transcriptIngress.js'

export function pushMicSpeechEvent(event, queue) {
  // SIN TEXTO UTIL no hay nada que encolar, pero es justo el caso que hay que
  // poder MEDIR: un onresult vacio (Chrome "escuchando" sin reconocer) dejaba el
  // pipeline sin traza y se confundia con "el micro no alimenta".
  if (!queue) return null
  const total = Number(event?.results?.length) || 0
  if (!total) {
    voiceProbe('asrEmpty', { results: 0, idx: null, finals: 0, interims: 0 })
    return null
  }

  const { interimChunks, finalChunks } = collectRecognitionResultChunks(event)
  const text = buildCurrentPhraseFromResults(event.results, event.resultIndex)
  const kind = finalChunks.length ? 'final' : 'interim'
  const chunks = kind === 'final' ? finalChunks : interimChunks
  if (!chunks.length && !text) {
    voiceProbe('asrEmpty', {
      results: total,
      idx: event.resultIndex ?? null,
      finals: finalChunks.length,
      interims: interimChunks.length,
    })
    return null
  }

  logMicProducerRaw({ source: 'browser', kind, text })
  return queue.push({
    source: 'browser',
    kind,
    text,
    interimChunks,
    finalChunks,
  })
}

/**
 * Construye el evento del motor con SUS RESULTADOS, en orden: Chrome entrega VARIOS
 * resultados en UN evento (el sink escribe una fila por resultado, todas con el MISMO `t`).
 * Acepta uno (`interim`/`final`) o la LISTA real (`interims`/`finals`): reconstruir la lista
 * es lo que evita inventar hipotesis que el motor nunca emitio juntas.
 * @param {{ interim?: string, final?: string, interims?: string[], finals?: string[] }} [parts]
 * @returns {{ resultIndex: number, results: object[] } | null}
 */
export function buildMicBurstEvent({ interim = '', final = '', interims = [], finals = [] } = {}) {
  const results = []
  const listaFinales = (Array.isArray(finals) && finals.length ? finals : [final])
    .map((texto) => String(texto ?? '').trim())
    .filter(Boolean)
  const listaInterinos = (Array.isArray(interims) && interims.length ? interims : [interim])
    .map((texto) => String(texto ?? '').trim())
    .filter((texto) => Boolean(texto) && !listaFinales.includes(texto))
  for (const texto of listaInterinos) {
    results.push({ isFinal: false, 0: { transcript: texto }, length: 1 })
  }
  for (const texto of listaFinales) {
    results.push({ isFinal: true, 0: { transcript: texto }, length: 1 })
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

export function pushSrGapEvent({ sinceLastResultMs = 0, reason = '' } = {}, queue) {
  if (!queue) return null
  return queue.push({
    source: 'browser',
    kind: 'sr-gap',
    sinceLastResultMs: Number(sinceLastResultMs) || 0,
    reason: String(reason || ''),
  })
}
