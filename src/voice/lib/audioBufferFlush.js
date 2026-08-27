/**
 * Vaciado sincronizado del búfer PCM al recibir FINAL (STT o Chrome).
 */
export function flushAudioAccumulationOnFinal({
  audioBuffer = null,
  chunksRef = null,
  chunkTotalSamplesRef = null,
  turnAudioStartSampleRef = null,
  micBridgeRef = null,
  streamSttClient = null,
} = {}) {
  if (streamSttClient && typeof streamSttClient.flushPcm === 'function') {
    streamSttClient.flushPcm()
  }

  if (micBridgeRef?.current && typeof micBridgeRef.current.resetSampleIndex === 'function') {
    micBridgeRef.current.resetSampleIndex()
  }

  if (audioBuffer && typeof audioBuffer.flushToZero === 'function') {
    const result = audioBuffer.flushToZero()
    if (chunkTotalSamplesRef) chunkTotalSamplesRef.current = 0
    if (turnAudioStartSampleRef) turnAudioStartSampleRef.current = result.turnStartSample ?? 0
    if (chunksRef) chunksRef.current = audioBuffer.chunks
    return result
  }

  if (chunksRef) chunksRef.current = []
  if (chunkTotalSamplesRef) chunkTotalSamplesRef.current = 0
  if (turnAudioStartSampleRef) turnAudioStartSampleRef.current = 0
  return { flushed: true, totalSamples: 0, turnStartSample: 0 }
}
