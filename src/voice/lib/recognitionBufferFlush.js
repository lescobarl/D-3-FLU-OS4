/**
 * Flush por fases al FINAL:
 * 1) Transcripción (sync, sin PCM) — inmediato en ingress
 * 2) PCM (post-commit) — tras consumir preflight/embedding
 */
import { flushAudioAccumulationOnFinal } from './audioBufferFlush.js'
import { clearPendingFinal } from './activeListen.js'

export function flushTranscriptStateOnFinal({
  listenState = null,
  publishedLiveRef = null,
  openPreviewTurnRef = null,
  lastStreamPreviewRef = null,
} = {}) {
  if (publishedLiveRef) publishedLiveRef.current = ''
  if (lastStreamPreviewRef) lastStreamPreviewRef.current = ''
  if (openPreviewTurnRef) openPreviewTurnRef.current = false
  if (listenState) {
    listenState.openLine = ''
    listenState.pendingInterim = ''
    clearPendingFinal(listenState)
  }
}

export function flushPcmStateAfterCommit({
  audioBuffer = null,
  chunksRef = null,
  chunkTotalSamplesRef = null,
  turnAudioStartSampleRef = null,
  micBridgeRef = null,
} = {}) {
  return flushAudioAccumulationOnFinal({
    audioBuffer,
    chunksRef,
    chunkTotalSamplesRef,
    turnAudioStartSampleRef,
    micBridgeRef,
  })
}
