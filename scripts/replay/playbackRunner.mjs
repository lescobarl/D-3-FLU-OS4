/**
 * RUNNER del modo `playback`: la GRABACION (audio) pasa por la MISMA tuberia que en vivo.
 *
 * Diferencia con el modo `events`: aqui el ASR es un STUB DETERMINISTA (reemite los
 * resultados grabados) y el AUDIO es real: se empuja por el segmentador de voz, que es el
 * dueño de las FRONTERAS de locución (VAD por evento). Asi se mide lo que el texto no puede
 * demostrar: donde acaba una locución y empieza la siguiente.
 *
 * No tiene reglas propias: el arnes y el comparador son los del modo `events`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildHarness } from './eventsRunner.mjs'

const SPEECH = 'chrome-raw'
const SR_GAP = 'sr-gap'
const RECOGNITION_END = 'recognition-end'

/**
 * Decodifica el audio de la sesion: WAV PCM mono 16-bit o PCM crudo 16-bit.
 * @param {string} dir carpeta de la sesion
 * @param {number} tasaDeclarada tasa del manifiesto (respaldo)
 * @returns {{ samples: Float32Array, sampleRate: number, file: string }}
 */
export function decodeSessionAudio(dir, tasaDeclarada = 0) {
  const wav = join(dir, 'audio.wav')
  const pcm = join(dir, 'audio.pcm')
  if (existsSync(wav)) {
    const buf = readFileSync(wav)
    // RIFF/WAVE: 'RIFF' size 'WAVE' 'fmt ' ... 'data' size <pcm>
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error(`audio.wav no es RIFF/WAVE: ${wav}`)
    }
    let offset = 12
    let sampleRate = Number(tasaDeclarada) || 0
    let bits = 16
    let channels = 1
    let dataOffset = -1
    let dataLength = 0
    while (offset + 8 <= buf.length) {
      const id = buf.toString('ascii', offset, offset + 4)
      const size = buf.readUInt32LE(offset + 4)
      const body = offset + 8
      if (id === 'fmt ') {
        channels = buf.readUInt16LE(body + 2)
        sampleRate = buf.readUInt32LE(body + 4)
        bits = buf.readUInt16LE(body + 14)
      } else if (id === 'data') {
        dataOffset = body
        dataLength = Math.min(size, buf.length - body)
        break
      }
      offset = body + size + (size % 2)
    }
    if (dataOffset < 0) throw new Error(`audio.wav sin bloque data: ${wav}`)
    if (bits !== 16) throw new Error(`audio.wav con ${bits} bits (solo 16-bit): ${wav}`)
    const total = Math.floor(dataLength / (2 * Math.max(1, channels)))
    const samples = new Float32Array(total)
    for (let i = 0; i < total; i += 1) {
      samples[i] = buf.readInt16LE(dataOffset + i * 2 * channels) / 32768
    }
    return { samples, sampleRate: sampleRate || Number(tasaDeclarada) || 48000, file: wav }
  }
  if (existsSync(pcm)) {
    const buf = readFileSync(pcm)
    const total = Math.floor(buf.length / 2)
    const samples = new Float32Array(total)
    for (let i = 0; i < total; i += 1) samples[i] = buf.readInt16LE(i * 2) / 32768
    return { samples, sampleRate: Number(tasaDeclarada) || 48000, file: pcm }
  }
  throw new Error(`la sesion no tiene audio (audio.wav / audio.pcm): ${dir}`)
}

/**
 * Reinyecta una sesion en modo `playback` (audio real + ASR stub).
 * @param {{ session: object, clock: object, inferMarks?: boolean, srGapCommitMs?: number }} options
 * @returns {Promise<object>} observado
 */
export async function runPlaybackSession({ session, clock, inferMarks = true, srGapCommitMs = 0 }) {
  const commitModule = await import('../../src/voice/lib/conversationStreamCommit.js')
  const bridge = await import('../../src/voice/lib/conversationIngressBridge.js')
  const producer = await import('../../src/voice/lib/micEventProducer.js')
  const activeListen = await import('../../src/voice/lib/activeListen.js')
  const conversationStream = await import('../../src/voice/lib/conversationStream.js')
  const transcriptPause = await import('../../src/voice/lib/fluTranscriptPause.js')
  const config = await import('../../src/voice/lib/fluConfig.js')
  const { crearDetectorDeFronteras } = await import('../../src/voice/core/tramoDeLocucion.js')
  if (config.FLU_CONFIG?.debug) config.FLU_CONFIG.debug.micIngressConsole = false

  const app = {
    handleConversationStreamSync: commitModule.handleConversationStreamSync,
    crearCajaDeLaFrase: commitModule.crearCajaDeLaFrase,
    createActiveListenState: activeListen.createActiveListenState,
    readTurnLive: conversationStream.readTurnLive,
    utterancesSameRevision: conversationStream.utterancesSameRevision,
  }
  const { observed, bindings } = buildHarness(app, clock)

  // AUDIO -> segmentador de voz: la unica fuente de FRONTERAS de locucion.
  const rateDeclarada = Number(session?.manifest?.sampleRate) || Number(session?.meta?.sampleRate) || 0
  const { samples, sampleRate, file: audioFile } = decodeSessionAudio(session.dir, rateDeclarada)
  const detector = crearDetectorDeFronteras({ sampleRate })
  bindings.getIngressVoiceContext = () => ({ audioFrontera: detector.frontera() })

  const runtime = bridge.createConversationIngressRuntime({ getBindings: () => bindings })
  const { buildMicBurstEvent } = producer

  const speech = session.events.filter((row) => String(row?.event || '') === SPEECH)
  const t0 = Number(speech[0]?.t) || Number(session.events[0]?.t) || 0
  /** Posicion en muestras de un instante del ASR dentro de la grabacion. */
  const muestrasDe = (t) => Math.max(0, Math.round(((Number(t) - t0) / 1000) * sampleRate))
  let alimentado = 0
  /** Empuja el audio hasta `hasta` muestras (bloques de 0.5 s) para que el VAD vea el mismo tramo. */
  const alimentarHasta = (hasta) => {
    const bloque = Math.max(1, Math.round(sampleRate * 0.5))
    while (alimentado < hasta) {
      const fin = Math.min(samples.length, Math.min(hasta, alimentado + bloque))
      if (fin <= alimentado) break
      detector.push(samples.subarray(alimentado, fin))
      alimentado = fin
    }
  }

  const gapMs =
    Number(srGapCommitMs) > 0
      ? Number(srGapCommitMs)
      : Number(transcriptPause.getTranscriptPauseCfg?.()?.srGapCommitMs) || 0
  const applied = { speech: 0, srGap: 0, end: 0 }
  const marks = { inferred: 0, srGapInferred: 0, endInferred: 0 }
  const HANDLED = new Set([SPEECH, SR_GAP, RECOGNITION_END])
  const filas = session.events.filter((row) => HANDLED.has(String(row?.event || '')))
  let previousSpeechAt = null
  let grupo = null

  for (let idx = 0; idx < filas.length; idx += 1) {
    const row = filas[idx]
    const kind = String(row?.event || '')
    const t = Number(row?.t)
    const data = row?.data || {}
    if (kind === SPEECH && inferMarks && previousSpeechAt != null && Number.isFinite(t)) {
      const hueco = t - previousSpeechAt
      const silencio = gapMs > 0 ? hueco >= gapMs : transcriptPause.srGapSilenceReached(hueco)
      if (hueco > 0 && silencio) {
        // El silencio REAL esta en el audio: se alimenta hasta ese punto antes de cerrar.
        alimentarHasta(muestrasDe(previousSpeechAt + (gapMs > 0 ? gapMs : hueco)))
        if (gapMs > 0) clock.advanceTo(previousSpeechAt + gapMs)
        runtime.pushSrGapEvent({ sinceLastResultMs: hueco })
        applied.srGap += 1
        marks.inferred += 1
        marks.srGapInferred += 1
        runtime.drainAll()
        clock.runDue()
      }
    }
    if (Number.isFinite(t)) {
      alimentarHasta(muestrasDe(t))
      clock.advanceTo(t)
    }
    if (kind === SPEECH) {
      const tipo = String(data?.kind || '') === 'final' ? 'final' : 'interim'
      const siguiente = filas[idx + 1]
      const mismoEvento =
        String(siguiente?.event || '') === SPEECH &&
        Number(siguiente?.t) === t &&
        (String(siguiente?.data?.kind || '') === 'final' ? 'final' : 'interim') === tipo
      if (mismoEvento) {
        if (!grupo || grupo.t !== t || grupo.tipo !== tipo) grupo = { t, tipo, textos: [] }
        grupo.textos.push(String(data?.text ?? ''))
        previousSpeechAt = t
        continue
      }
      const textos =
        grupo && grupo.t === t && grupo.tipo === tipo ? [...grupo.textos, String(data?.text ?? '')] : [String(data?.text ?? '')]
      grupo = null
      const burst = tipo === 'final' ? buildMicBurstEvent({ finals: textos }) : buildMicBurstEvent({ interims: textos })
      if (burst) {
        runtime.pushMicRecognitionEvent(burst)
        applied.speech += 1
        previousSpeechAt = t
      }
      runtime.drainAll()
      clock.runDue()
    } else if (kind === SR_GAP) {
      runtime.pushSrGapEvent({ sinceLastResultMs: Number(data?.sinceLastResultMs) || 0 })
      applied.srGap += 1
      runtime.drainAll()
      clock.runDue()
    } else if (kind === RECOGNITION_END) {
      runtime.pushRecognitionEndEvent({ immediate: true })
      applied.end += 1
      runtime.drainAll()
      clock.runDue()
    }
  }

  if (inferMarks && speech.length) {
    const lastAt = Number(speech.at(-1)?.t)
    if (Number.isFinite(lastAt)) {
      alimentarHasta(muestrasDe(lastAt))
      clock.advanceTo(lastAt)
    }
    runtime.pushRecognitionEndEvent({ immediate: true })
    applied.end += 1
    marks.inferred += 1
    marks.endInferred += 1
    runtime.drainAll()
    clock.runDue()
  }

  observed.applied = applied
  observed.marks = marks
  observed.config = { srGapCommitMs: Number(transcriptPause.getTranscriptPauseCfg?.()?.srGapCommitMs) || 0 }
  // DECLARACION DEL RUNNER (no etiqueta de la heuristica): el ASR es un stub determinista
  // sobre el audio de la grabacion, asi que la corrida es COMPARABLE.
  observed.playback = {
    asr: 'stub',
    determinista: true,
    comparable: true,
    motivo: 'ASR stub sobre la grabacion + VAD real: misma entrada, misma salida',
  }
  observed.audio = {
    file: audioFile,
    sampleRate,
    samples: samples.length,
    seconds: Number((samples.length / sampleRate).toFixed(2)),
    frontiers: detector.frontera(),
  }
  const speakers = []
  for (const row of observed.rows) {
    const last = speakers[speakers.length - 1]
    if (last !== row.speaker) speakers.push(row.speaker)
  }
  observed.speakers = speakers
  observed.errors = []
  observed.window = {
    firstAt: Number(session.events[0]?.t) || 0,
    lastAt: Number(session.events.at(-1)?.t) || 0,
    speech: speech.length,
  }
  return observed
}
