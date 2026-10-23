/**
 * Runtime productor → consumidor para transcripción en conversación activa.
 * Centraliza el contexto de ingress y evita duplicar lógica en el hook.
 */
import { logCaughtError } from '../../lib/caughtError'
import { readCommandText, matchesListeningAck } from './activeListen.js'
import { createEventQueue } from './eventQueue.js'
import {
  pushMicSpeechEvent,
  pushRecognitionEndEvent,
  pushSrGapEvent,
} from './micEventProducer.js'
import { createTranscriptConsumer } from './transcriptEventConsumer.js'

/**
 * @param {object} bindings — refs y callbacks del hook (lectura en cada evento).
 */
export function buildConversationIngressCtx(bindings = {}) {
  const conversationActive = Boolean(bindings.conversationActiveRef?.current)

  return {
    conversationActive,
    ingressSource: 'mic',
    listenState: bindings.listenStateRef?.current,
    publishedLiveRef: bindings.publishedLiveRef,
    getTurnId: () => bindings.activeTurnIdRef?.current ?? null,
    openPreviewTurnRef: bindings.openPreviewTurnRef,
    logRowsTextRef: bindings.logRowsTextRef,
    logRowSpeakersRef: bindings.logRowSpeakersRef,
    lastEmittedTranscriptRef: bindings.lastEmittedTranscriptRef,
    lastLoggedSpeakerRef: bindings.lastLoggedSpeakerRef,
    lastStreamPreviewRef: bindings.lastStreamPreviewRef,
    lastCommitAtRef: bindings.lastCommitAtRef,
    preflightScheduledForTurnRef: bindings.preflightScheduledForTurnRef,
    // DESPACHO EN SEGUNDO PLANO (contrato fire-and-forget): el despacho real es
    // ASINCRONO y devuelve una Promise. Compararla con `=== true` era SIEMPRE falso
    // y dejaba muertas las ramas que dependian de ese valor; ademas un rechazo
    // quedaba como promesa suelta. El resultado NO decide nada: el commit de la fila
    // lo gobierna su escritor unico (scheduleTurnCommit o el fallback del ingress).
    tryDispatch: (text, opts) => {
      try {
        const pending = bindings.tryDispatchConversationAction?.(text, opts)
        void Promise.resolve(pending).catch((err) =>
          logCaughtError('conversationIngressBridge.tryDispatch', err, { text, opts }),
        )
      } catch (err) {
        logCaughtError('conversationIngressBridge.tryDispatch', err, { text, opts })
      }
    },
    maybeSwitchLocale: (text) => bindings.maybeSwitchRecognitionLocale?.(text),
    syncConversationStream: (payload) => bindings.syncConversationStream?.(payload),
    scheduleTurnCommit: (payload) =>
      bindings.syncConversationStream?.({
        ...payload,
        turnCommit: true,
      }),
    flushTranscriptOnFinal: () => bindings.flushTranscriptOnFinal?.(),
    // El ingress vacia TRANSCRIPCION, nunca PCM: el audio del turno sigue siendo la
    // medida de la identidad hasta el cierre real (dueño del vaciado: finalizeTurnCommit).
    flushRecognitionOnFinal: () => bindings.flushTranscriptOnFinal?.(),
    commitTurnToSessionRows: (text, speaker, opts) =>
      bindings.commitTurnToSessionRows?.(text, speaker, opts),
    debugHotPath: Boolean(import.meta.env?.DEV && bindings.debugHotPath),
    fluDebugHot: bindings.fluDebugHot || (() => {}),
    getIngressVoiceContext: () =>
      typeof bindings.getIngressVoiceContext === 'function'
        ? bindings.getIngressVoiceContext()
        : {},
    markAudioSegmentStart: (atMs) => bindings.markAudioSegmentStart?.(atMs),
    onTurnFinalized: () => bindings.onTurnFinalized?.(),
    peekTurnBridgeText: () => bindings.peekTurnBridgeText?.() || '',
    stashTurnBridgeText: (text) => bindings.stashTurnBridgeText?.(text),
    consumeTurnBridgeText: () => bindings.consumeTurnBridgeText?.() || '',
    touchMeaningfulIngress: (payload) => bindings.touchMeaningfulIngress?.(payload),
    scheduleIdentityPreflight: (payload) => bindings.scheduleIdentityPreflight?.(payload),
  }
}

/**
 * @param {{ getBindings: () => object, onAfterBrowserEvent?: (event: object) => void }} options
 */
export function createConversationIngressRuntime({ getBindings, onAfterBrowserEvent } = {}) {
  const queue = createEventQueue()
  const consumer = createTranscriptConsumer({
    getCtx: () => buildConversationIngressCtx(getBindings()),
    onAfterEvent: (event, result) => {
      // CIERRE QUE NO CERRÓ: si el sr-gap no flusho, la locucion sigue ABIERTA y el flag que
      // evita repetir el sr-gap no puede quedarse armado: el silencio posterior tiene que
      // poder cerrarla (auditoria 2026-10-22).
      if (event?.kind === 'sr-gap' && result && result.flushed === false) {
        const ref = getBindings?.()?.srGapFiredForOpenLineRef
        if (ref) ref.current = false
      }
      if (event?.source !== 'browser') return
      onAfterBrowserEvent?.(event, getBindings())
      const bindings = getBindings()
      const ackPhrase = readCommandText(bindings.listenStateRef?.current)
      if (ackPhrase && matchesListeningAck(ackPhrase)) {
        bindings.showListeningAck?.()
      }
    },
  })

  return Object.freeze({
    queue,
    consumer,
    pushMicRecognitionEvent(event) {
      const pushed = pushMicSpeechEvent(event, queue)
      if (pushed) {
        consumer.scheduleDrain(queue)
      }
      return pushed
    },
    pushRecognitionEndEvent({ immediate = false } = {}) {
      const pushed = pushRecognitionEndEvent(queue)
      if (!pushed) return null
      if (immediate) {
        consumer.drainAll(queue)
      } else {
        consumer.scheduleDrain(queue)
      }
      return pushed
    },
    pushSrGapEvent({ sinceLastResultMs = 0, reason = '' } = {}) {
      const pushed = pushSrGapEvent({ sinceLastResultMs, reason }, queue)
      if (pushed) {
        consumer.scheduleDrain(queue)
      }
      return pushed
    },
    scheduleSttConsumerDrain() {
      consumer.scheduleDrain(queue)
    },
    drainAll(options) {
      return consumer.drainAll(queue, options)
    },
    reset() {
      queue.clear()
    },
  })
}
