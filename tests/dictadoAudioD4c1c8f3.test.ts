// ============================================================
// DICTADO POR VOZ de la grabacion real d4c1c8f3 (2026-10-20)
// ------------------------------------------------------------
// La transcripcion la dicta la VOZ: se lee el audio REAL (audio.wav, 48kHz PCM16)
// y se alimenta al MOTOR REAL de escucha (createWhisperRecognitionEngine: VAD real
// + modelo Whisper REAL del proyecto, Xenova/whisper-tiny, dtype/idioma/initialPrompt
// de FLU_CONFIG.transcript.asr, sin hardcode). Los onresult reales del motor caen en
// el CONSUMIDOR REAL (createTranscriptConsumer) con el reloj virtual = tiempo real
// del audio, y los sr-gap se disparan en los silencios REALES >= srGapCommitMs.
// Imprime: cada final dictado por Whisper y las filas de conversacion resultantes.
// ============================================================
import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import { createWhisperRecognitionEngine } from '../src/voice/lib/asr/whisperRecognitionEngine.js'
import { getAsrConfig } from '../src/voice/lib/asr/asrConfig.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { collectRecognitionResultChunks } from '../src/voice/lib/transcriptIngress.js'
import { createTranscriptConsumer } from '../src/voice/lib/transcriptEventConsumer.js'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'

const DIR = join(tmpdir(), 'flu-recordings', 'd4c1c8f3-76f8-400b-b89e-e8e428cfdff7')
const SR_GAP_COMMIT_MS = Number(FLU_CONFIG.transcript.pauseAndWeakAsr.srGapCommitMs) || 3500

/**
 * La grabacion real vive en la carpeta de grabaciones del navegador (no en el
 * repo: 14 MB). Sin ella el DICTADO no se puede medir: el bloque se SALTA, no se
 * finge. Declarado: en CI no hay grabacion, asi que este camino se mide en local.
 */
const HAY_GRABACION = existsSync(join(DIR, 'audio.wav')) && existsSync(join(DIR, 'meta.json'))

/** PCM16 de un WAV: localiza el chunk 'data' y devuelve Float32Array [-1,1]. */
function leerPcmWav(ruta: string): { muestras: Float32Array; sampleRate: number } {
  const buf = readFileSync(ruta)
  let off = 12
  let sampleRate = 16000
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      sampleRate = buf.readUInt32LE(off + 12)
    }
    if (id === 'data') {
      const n = Math.floor(size / 2)
      const muestras = new Float32Array(n)
      for (let i = 0; i < n; i += 1) muestras[i] = buf.readInt16LE(off + 8 + i * 2) / 32768
      return { muestras, sampleRate }
    }
    off += 8 + size + (size % 2)
  }
  throw new Error('chunk data no encontrado en ' + ruta)
}

/** Deps minimas de la puerta real (mismo cableado que reinyeccionTodos). */
function montarDeps() {
  const serie: string[] = []
  const filas: string[] = []
  const filasConTiempo: { t: number; text: string }[] = []
  const deps = {
    conversationActiveRef: { current: true }, publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() }, openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn((v: string) => serie.push(String(v))),
    scheduleLiveTranscriptUpdate: vi.fn((v: string) => serie.push(String(v))),
    applyConversationSpeaker: vi.fn(), flushPendingStreamLog: vi.fn(),
    logRowsTextRef: { current: [] as string[] }, activeTurnIdRef: { current: 0 },
    flushPcmAfterTurnCommit: vi.fn(), lastCommitAtRef: { current: 0 }, lastOnresultAtRef: { current: 0 },
    turnAudioStartSampleRef: { current: 0 }, chunkTotalSamplesRef: { current: 0 },
    preflightScheduledForTurnRef: { current: true }, srGapFiredForOpenLineRef: { current: true },
    processConversationFluQueryRef: { current: vi.fn() }, lastEmittedTranscriptRef: { current: '' },
    emitConversationLog: vi.fn(() => true),
    createSpeakerAudioResolver: vi.fn(() => () => Promise.resolve({ speakerName: 'Hablante 1' })),
    sessionPrimarySpeakerRef: { current: '' }, lastLoggedSpeakerRef: { current: '' },
    logRowSpeakersRef: { current: [] as string[] }, speakerClustersRef: { current: [] as object[] },
    setSpeakerClusters: vi.fn(), lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null as number[] | null }, lastLogLineTextRef: { current: '' },
    commitTurnToSessionRows: vi.fn((text: string) => {
      if (text) {
        filas.push(String(text))
        filasConTiempo.push({ t: Date.now(), text: String(text) })
        deps.logRowsTextRef.current.push(String(text)); deps.lastCommitAtRef.current = Date.now()
      }
    }),
    scheduleTurnCommit: vi.fn((p: { capture?: string; utterance?: string }) => {
      const t = String(p?.capture || p?.utterance || '')
      if (t) {
        filas.push(t)
        filasConTiempo.push({ t: Date.now(), text: t })
        deps.logRowsTextRef.current.push(t); deps.lastCommitAtRef.current = Date.now()
      }
    }),
    lastRequestRef: { current: { text: '', at: 0 } },
    fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
  }
  const ctx = {
    ...deps, conversationActive: true, listenState: deps.listenStateRef.current, lastStreamPreviewRef: { current: '' },
    tryDispatch: vi.fn(() => false),
    syncConversationStream: (payload: object) => handleConversationStreamSync(deps as never, payload as never),
    maybeSwitchLocale: vi.fn(), peekTurnBridgeText: vi.fn(() => ''), stashTurnBridgeText: vi.fn(),
    consumeTurnBridgeText: vi.fn(), markAudioSegmentStart: vi.fn(), scheduleIdentityPreflight: vi.fn(),
    getIngressVoiceContext: vi.fn(() => ({ lastAssistantText: '', lastAssistantAtMs: 0 })),
    touchMeaningfulIngress: vi.fn(), onTurnFinalized: vi.fn(), flushTranscriptOnFinal: vi.fn(), debugHotPath: false,
  }
  return { deps, ctx, serie, filas, filasConTiempo }
}

describe.skipIf(!HAY_GRABACION)('DICTADO POR VOZ de la grabacion d4c1c8f3', () => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false
  // Solo para acotar el tiempo del dictado: los parciales del motor (1s) no cambian
  // los FINALES, que son lo que sella filas. Declarado, no silencioso.
  FLU_CONFIG.transcript.asr.partialsEnabled = false

  it('el audio dicta: wav real -> Whisper real -> pipeline real', { timeout: 900000 }, async () => {
    const { muestras, sampleRate } = leerPcmWav(join(DIR, 'audio.wav'))
    expect(muestras.length).toBeGreaterThan(0)

    const cfg = getAsrConfig()
    console.log(`[DICTADO] modelo=${cfg.modelId} dtype=${cfg.dtype} language=${cfg.language} sampleRateWav=${sampleRate} muestras=${muestras.length} (${(muestras.length / sampleRate).toFixed(1)}s)`)

    // MODELO REAL del proyecto (mismo pipeline/opciones que whisperAsr.worker).
    const { pipeline } = await import('@huggingface/transformers')
    const asr = await pipeline('automatic-speech-recognition', cfg.modelId, { dtype: cfg.dtype as any })
    console.log('[DICTADO] modelo Whisper cargado. Transcribiendo...')
    const transcriber = {
      preload: async () => {},
      transcribe: async (audio: Float32Array) => {
        if (!audio?.length) return ''
        const res = await asr(audio, {
          task: 'transcribe',
          return_timestamps: false,
          condition_on_previous_text: false,
          no_repeat_ngram_size: 3,
          language: cfg.language,
          initial_prompt: cfg.initialPrompt,
        })
        return String(res?.text || '').trim()
      },
      dispose: () => {},
    }

    const e = montarDeps()
    const consumer = createTranscriptConsumer({ getCtx: () => e.ctx as never })
    const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf8'))
    const audioT0 = Date.parse(meta.startedAt)

    const engine = createWhisperRecognitionEngine({ sampleRate, transcriber, interimTranscriber: transcriber })
    let virtualNow = audioT0
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => virtualNow)
    let lastResultAt = -1
    const dictado: { t: number; text: string; final: boolean }[] = []

    engine.onresult = (ev: any) => {
      const { interimChunks, finalChunks } = collectRecognitionResultChunks(ev as never)
      for (const texto of finalChunks) {
        dictado.push({ t: virtualNow, text: texto, final: true })
        console.log(`[DICTADO final ${fmt(virtualNow, audioT0)}] ${JSON.stringify(texto)}`)
      }
      for (const texto of interimChunks) {
        dictado.push({ t: virtualNow, text: texto, final: false })
      }
      for (const texto of finalChunks) consumer.processEvent({ source: 'browser', kind: 'final', text: texto })
      for (const texto of interimChunks) consumer.processEvent({ source: 'browser', kind: 'interim', text: texto })
      lastResultAt = virtualNow
    }
    engine.onend = () => consumer.processEvent({ source: 'browser', kind: 'recognition-end' })
    engine.onerror = (err: any) => console.log('[DICTADO] error del motor:', String((err as { message?: string })?.message || err))

    engine.start()

    // Audio en tramos de 100ms con reloj virtual = tiempo real del audio.
    const tramo = Math.round(sampleRate / 10)
    for (let off = 0; off < muestras.length; off += tramo) {
      virtualNow = audioT0 + (off / sampleRate) * 1000
      engine.pushAudio(muestras.subarray(off, off + tramo), sampleRate)
      if (lastResultAt >= 0 && virtualNow - lastResultAt >= SR_GAP_COMMIT_MS) {
        consumer.processEvent({ source: 'browser', kind: 'sr-gap', sinceLastResultMs: virtualNow - lastResultAt })
        lastResultAt = virtualNow
      }
    }
    // El motor transcribe EN COLA: hay que dejarla vaciarse ANTES de stop().
    // Sin esto, stop() marca active=false y los finales encolados se descartan.
    await engine.whenIdle()
    engine.stop()
    dateSpy.mockRestore()

    const filasReales: string[] = readFileSync(join(DIR, 'turns.ndjson'), 'utf8')
      .trim().split('\n')
      .map((l) => JSON.parse(l))
      .filter((t) => t.kind === 'commit')
      .map((t) => String(t.text || ''))

    console.log('[DICTADO] === FILAS REALES grabadas ===')
    filasReales.forEach((f, i) => console.log(`[REAL-${i}] ${JSON.stringify(f)}`))
    console.log('[DICTADO] === FILAS DICTADAS por Whisper y selladas por el pipeline real ===')
    e.filas.forEach((f, i) => console.log(`[DICT-${i}] ${JSON.stringify(f)}`))

    writeFileSync(join(DIR, 'dictado-audio.json'), JSON.stringify({
      audioT0, rawFirst: audioT0, filas: e.filasConTiempo, dictado,
    }, null, 2))

    const todas = e.filas.map((f) => f.toLowerCase())
    expect(todas.some((f) => f.includes('cloud cloud'))).toBe(false)
    expect(todas.some((f) => f.includes('tanto tanto'))).toBe(false)
    expect(todas.length).toBeGreaterThan(0)
  })
})

function fmt(t: number, t0: number): string {
  const s = Math.max(0, (t - t0) / 1000)
  const m = Math.floor(s / 60)
  const ss = (s - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${ss}`
}
