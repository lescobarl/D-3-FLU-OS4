/**
 * Consumidor: extrae eventos de la cola y ejecuta clasificación, diarización y despacho.
 * Único lugar con lógica de negocio de transcripción en conversación.
 */
import {
  processBrowserConversationIngress,
  processStreamConversationIngress,
  flushSrGapSegmentThroughIngress,
  flushRecognitionEndThroughIngress,
} from './transcriptIngress.js'

export function createTranscriptConsumer({ getCtx, onAfterEvent } = {}) {
  let draining = false

  function processEvent(event, { force = false } = {}) {
    if (!event) return { handled: false }
    const ctx = typeof getCtx === 'function' ? getCtx() : null
    if (!force && !ctx?.conversationActive) return { handled: false, skipped: true }

    if (event.kind === 'sr-gap') {
      return flushSrGapSegmentThroughIngress(ctx, {
        sinceLastResultMs: event.sinceLastResultMs,
      })
    }

    if (event.kind === 'recognition-end') {
      return flushRecognitionEndThroughIngress(ctx)
    }

    if (event.source === 'stream') {
      return processStreamConversationIngress({
        text: event.text || '',
        isFinal: Boolean(event.isFinal),
        ctx,
      })
    }

    return processBrowserConversationIngress({
      interimChunks: event.interimChunks || (event.kind === 'interim' && event.text ? [event.text] : []),
      finalChunks: event.finalChunks || (event.kind === 'final' && event.text ? [event.text] : []),
      ctx,
    })
  }

  function drainOne(queue, { force = false } = {}) {
    const event = queue.peek()
    if (!event) return false

    if (!force) {
      const ctx = typeof getCtx === 'function' ? getCtx() : null
      if (!ctx?.conversationActive) return false
    }

    queue.shift()
    const result = processEvent(event, { force })
    if (typeof onAfterEvent === 'function') {
      onAfterEvent(event, result)
    }
    return true
  }

  function scheduleDrain(queue) {
    if (draining || !queue?.length) return
    draining = true
    const batchSize = 32

    const step = () => {
      let processedCount = 0
      while (queue.length && processedCount < batchSize) {
        const processed = drainOne(queue)
        if (!processed) {
          draining = false
          return
        }
        processedCount += 1
      }

      if (!queue.length) {
        draining = false
        return
      }
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(step)
      } else {
        setTimeout(step, 0)
      }
    }

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(step)
    } else {
      setTimeout(step, 0)
    }
  }

  /** Vacía la cola de forma síncrona mientras la conversación sigue activa. */
  function drainAll(queue, { force = false } = {}) {
    draining = true
    let count = 0
    try {
      while (queue.length) {
        if (!drainOne(queue, { force })) break
        count += 1
      }
    } finally {
      draining = false
    }
    return count
  }

  async function waitForDrain(queue, { timeoutMs = 1500 } = {}) {
    const deadline = Date.now() + timeoutMs
    while (queue.length && Date.now() < deadline) {
      drainAll(queue)
      if (!queue.length) return 0
      await new Promise((resolve) => {
        if (typeof queueMicrotask === 'function') queueMicrotask(resolve)
        else setTimeout(resolve, 0)
      })
    }
    if (queue.length) drainAll(queue, { force: true })
    return queue.length
  }

  return Object.freeze({
    processEvent,
    drainOne,
    scheduleDrain,
    drainAll,
    waitForDrain,
    get isDraining() {
      return draining
    },
  })
}
