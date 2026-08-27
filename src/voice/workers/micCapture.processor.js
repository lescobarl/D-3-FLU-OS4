/**
 * Captura PCM en hilo de audio (sin ScriptProcessorNode en main thread).
 */
class MicCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel?.length) return true
    const copy = new Float32Array(channel.length)
    copy.set(channel)
    this.port.postMessage({ type: 'pcm', samples: copy }, [copy.buffer])
    return true
  }
}

registerProcessor('flu-mic-capture', MicCaptureProcessor)
