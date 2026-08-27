/**
 * STT mock: guion por mensaje simulate o cierre por silencio (dev / tests).
 */
import { pcmRms } from '../../src/lib/pcmAudio.js'

function int16ToFloat32(buffer) {
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = samples[i] / 0x8000
  }
  return out
}

export function createMockStreamSttProvider({
  utteranceSilenceMs = 900,
  minVoicedRms = 0.0025,
} = {}) {
  let scriptQueue = []
  let replayTimer = null
  let partial = ''
  let lastVoicedAt = 0
  let hadVoice = false

  function clearReplay() {
    if (replayTimer) {
      clearTimeout(replayTimer)
      replayTimer = null
    }
  }

  function onSimulate(events = [], send) {
    clearReplay()
    scriptQueue = Array.isArray(events) ? [...events] : []
    const play = () => {
      const step = scriptQueue.shift()
      if (!step) return
      const text = String(step.text ?? '')
      const final = Boolean(step.final)
      send({ text, final, partial: !final })
      if (!final) {
        partial = text
      }
      if (scriptQueue.length) {
        replayTimer = setTimeout(play, Number(step.delayMs) || 40)
      }
    }
    play()
  }

  function onAudio(buffer, send) {
    if (scriptQueue.length) return
    const rms = pcmRms(int16ToFloat32(buffer))
    const now = Date.now()
    if (rms >= minVoicedRms) {
      hadVoice = true
      lastVoicedAt = now
      if (!partial) {
        partial = '…'
        send({ text: partial, final: false, partial: true })
      }
      return
    }
    if (hadVoice && now - lastVoicedAt >= utteranceSilenceMs) {
      hadVoice = false
      const text = partial === '…' ? '' : partial
      partial = ''
      if (text) {
        send({ text, final: true, partial: false })
      }
    }
  }

  return {
    onConfig() {},
    onSimulate,
    onAudio,
    close: clearReplay,
  }
}
