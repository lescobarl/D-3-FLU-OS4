/**
 * Runtime productor → consumidor para transcripción en conversación activa.
 * Centraliza el contexto de ingress y evita duplicar lógica en el hook.
 */
import { readCommandText, matchesListeningAck } from './activeListen.js'
import { createEventQueue } from './eventQueue.js'
import {
  pushBrowserSpeechEvent,
  pushRecognitionEndEvent,
  pushStreamSpeechEvent,
  pushSrGapEvent,
} from './micEventProducer.js'
import { createTranscriptConsumer } from './transcriptEventConsumer.js'
import {
  shouldIngestBrowserConversation,
  shouldIngestStreamTranscript,
  getTranscriptSource,
} from './transcriptConfig.js'
import { FLU_CONFIG } from './fluConfig.js'

/**
 * @param {object} bindings — refs y callbacks del hook (lectura en cada evento).
 */
export function buildConversationIngressCtx(bindings = {}) {
  const conversationActive = Boolean(bindings.conversationActiveRef?.current)
  const transcriptSource = bindings.transcriptSource || getTranscriptSource(FLU_CONFIG)
  const streamConnected = Boolean(bindings.streamSttConnected)
  const streamProvider = bindings.streamSttProvider || FLU_CONFIG.transcript?.streamProvider || 'mock'

  return {
    conversationActive,
    ingressSource: 'browser',
    streamConnected,
    streamProvider,
    listenState: bindings.listenStateRef?.current,
    publishedLiveRef: bindings.publishedLiveRef,
    openPreviewTurnRef: bindings.openPreviewTurnRef,
    logRowsTextRef: bindings.logRowsTextRef,
    logRowSpeakersRef: bindings.logRowSpeakersRef,
    lastEmittedTranscriptRef: bindings.lastEmittedTranscriptRef,
    lastLoggedSpeakerRef: bindings.lastLoggedSpeakerRef,
    lastStreamPreviewRef: bindings.lastStreamPreviewRef,
    lastCommitAtRef: bindings.lastCommitAtRef,
    preflightScheduledForTurnRef: bindings.preflightScheduledForTurnRef,
    skipConversationLog: !shouldIngestBrowserConversation(
      FLU_CONFIG,
      streamConnected,
      streamProvider,
    ),
    ingestStream: shouldIngestStreamTranscript(FLU_CONFIG, streamConnected, streamProvider),
    ingestBrowser: shouldIngestBrowserConversation(FLU_CONFIG, streamConnected, streamProvider),
    tryDispatch: (text, opts) => bindings.tryDispatchConversationAction?.(text, opts) === true,
    maybeSwitchLocale: (text) => bindings.maybeSwitchRecognitionLocale?.(text),
    syncConversationStream: (payload) => bindings.syncConversationStream?.(payload),
    scheduleTurnCommit: (payload) =>
      bindings.syncConversationStream?.({
        ...payload,
        turnCommit: true,
      }),
    flushTranscriptOnFinal: () => bindings.flushTranscriptOnFinal?.(),
    flushRecognitionOnFinal: () => bindings.flushPcmAfterTurnCommit?.(),
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
    transcriptSource,
    streamProvider,
  }
}

/**
 * @param {{ getBindings: () => object, onAfterBrowserEvent?: (event: object) => void }} options
 */
export function createConversationIngressRuntime({ getBindings, onAfterBrowserEvent } = {}) {
  const queue = createEventQueue()
  const consumer = createTranscriptConsumer({
    getCtx: () => buildConversationIngressCtx(getBindings()),
    onAfterEvent: (event) => {
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
    pushBrowserRecognitionEvent(event) {
      const pushed = pushBrowserSpeechEvent(event, queue)
      if (pushed) {
        consumer.scheduleDrain(queue)
      }
      return pushed
    },
    pushStreamTranscriptEvent({ text = '', isFinal = false } = {}) {
      const pushed = pushStreamSpeechEvent({ text, isFinal }, queue)
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
    pushSrGapEvent({ sinceLastResultMs = 0 } = {}) {
      const pushed = pushSrGapEvent({ sinceLastResultMs }, queue)
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
