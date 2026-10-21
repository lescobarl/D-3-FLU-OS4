// ============================================================
// REINYECCION DE LA GRABACION REAL d4c1c8f3 (2026-10-20)
// ------------------------------------------------------------
// NO usa cadenas escritas a mano: lee events.ndjson del directorio de la
// grabacion y reinyecta los 618 eventos chrome-raw (interims y finals REALES
// de Chrome, en el orden y con los timestamps reales) por el CONSUMIDOR REAL
// (createTranscriptConsumer, el mismo que usa el hook). Los sr-gap se disparan
// en los 7 silencios REALES >= srGapCommitMs (3500ms) medidos entre eventos,
// igual que el timer real (fluTranscriptPause). Imprime la conversacion
// resultante fila por fila, junto a las filas REALES grabadas en turns.ndjson.
// ============================================================
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import { createTranscriptConsumer } from '../src/voice/lib/transcriptEventConsumer.js'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const DIR = join(tmpdir(), 'flu-recordings', 'd4c1c8f3-76f8-400b-b89e-e8e428cfdff7')
const SR_GAP_COMMIT_MS = Number(FLU_CONFIG.transcript.pauseAndWeakAsr.srGapCommitMs) || 3500

type ChromeRaw = { kind: 'interim' | 'final'; text: string; t: number }

/** Lee la grabacion REAL del disco (misma fuente del log del dueno). */
function leerGrabacion(): { raws: ChromeRaw[]; filasReales: string[] } {
  const raws: ChromeRaw[] = readFileSync(join(DIR, 'events.ndjson'), 'utf8')
    .trim().split('\n')
    .map((l) => JSON.parse(l))
    .filter((e) => e.event === 'chrome-raw')
    .map((e) => ({ kind: e.data.kind, text: e.data.text, t: Number(e.data.t) }))
  const filasReales: string[] = readFileSync(join(DIR, 'turns.ndjson'), 'utf8')
    .trim().split('\n')
    .map((l) => JSON.parse(l))
    .filter((t) => t.kind === 'commit')
    .map((t) => String(t.text || ''))
  return { raws, filasReales }
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
    // Como el hook real: el commit de fila actualiza la vista del store (logRowsTextRef)
    // y el reloj del ultimo commit; las puertas de dedupe ('already-committed') se miden
    // contra esa vista.
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

describe('REINYECCION COMPLETA de la grabacion d4c1c8f3', () => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false

  it('reproduce los 618 eventos reales por el consumidor REAL y la conversacion sale sin los 3 duplicados', () => {
    const { raws, filasReales } = leerGrabacion()
    expect(raws.length).toBeGreaterThan(0)

    // RELOJ VIRTUAL = timestamps reales de la grabacion. El pipeline mide el tiempo
    // con Date.now() (cooldown post-commit, edad de la linea, silencio); un replay
    // instantaneo con reloj real haria que todos los cierres se negaran por
    // 'post-commit-cooldown'. Con el reloj virtual los portones de tiempo ven los
    // mismos silencios que midio la sesion en vivo.
    let virtualNow = raws[0].t
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => virtualNow)

    const e = montarDeps()
    const consumer = createTranscriptConsumer({ getCtx: () => e.ctx as never })

    let srGaps = 0
    for (let i = 0; i < raws.length; i += 1) {
      const ev = raws[i]
      const prev = i > 0 ? raws[i - 1] : null
      // Timer REAL del silencio (fluTranscriptPause): >= srGapCommitMs sin onresult
      // dispara sr-gap ANTES del siguiente evento, con el silencio REAL medido.
      if (prev && ev.t - prev.t >= SR_GAP_COMMIT_MS) {
        virtualNow = ev.t
        consumer.processEvent({ source: 'browser', kind: 'sr-gap', sinceLastResultMs: ev.t - prev.t })
        srGaps += 1
      }
      virtualNow = ev.t
      consumer.processEvent({ source: 'browser', kind: ev.kind, text: ev.text })
    }
    // Cierre real al final: el silencio final dispara sr-gap y el onend de Chrome
    // dispara recognition-end (el hook real encola ambos).
    virtualNow = raws[raws.length - 1].t + SR_GAP_COMMIT_MS
    consumer.processEvent({ source: 'browser', kind: 'sr-gap', sinceLastResultMs: SR_GAP_COMMIT_MS })
    consumer.processEvent({ source: 'browser', kind: 'recognition-end' })

    dateSpy.mockRestore()

    // Volcado para el VISOR: filas producidas con su instante real de commit, mas el
    // t0 del audio (startedAt del meta de la grabacion). El visor lee estos archivos
    // del disco; aqui no se embebe ningun dato a mano.
    const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf8'))
    writeFileSync(join(DIR, 'replay-filas.json'), JSON.stringify({
      audioT0: Date.parse(meta.startedAt),
      rawFirst: raws[0].t,
      filas: e.filasConTiempo,
    }, null, 2))

    console.log(`[REINY] eventos chrome-raw reales: ${raws.length} | sr-gap disparados por silencio real: ${srGaps}`)
    console.log('[REINY] === FILAS REALES grabadas (turns.ndjson) ===')
    filasReales.forEach((f, i) => console.log(`[REAL-${i}] ${JSON.stringify(f)}`))
    console.log('[REINY] === FILAS PRODUCIDAS por la reinyeccion (codigo actual) ===')
    e.filas.forEach((f, i) => console.log(`[REINY-${i}] ${JSON.stringify(f)}`))

    const todas = e.filas.map((f) => f.toLowerCase())
    // Defecto 1 y 2: ninguna fila con el par duplicado.
    expect(todas.some((f) => f.includes('cloud cloud'))).toBe(false)
    // Defecto 3: ninguna fila con "tanto tanto".
    expect(todas.some((f) => f.includes('tanto tanto'))).toBe(false)
    // Los finales limpios reales SI estan.
    expect(todas.some((f) => f.includes('puso cloud'))).toBe(true)
    expect(todas.some((f) => f.includes('tanto porque'))).toBe(true)
  })
})
