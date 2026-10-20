// ============================================================
// duplicadosMergeD4c1c8f3 - EVIDENCIA sobre el log REAL del dueno (sesion d4c1c8f3,
// 2026-10-20) de los duplicados del merge, por las FUNCIONES REALES (sin mocks de regla):
//
//   Medido (filas reales del log):
//   - turn 2  (seq 288): "…nos dijo cla Cloud Cloud de que ya esta ya todo resuelto"
//   - turn 8  (seq 531): "puso Cloud Cloud"            (final limpio: "puso Cloud")
//   - turn 25 (seq 1486): "…pero tampoco tanto tanto porque" (final limpio: "…tanto porque")
//
//   Causa A (caja): el interino/interino o la union re-entregan la palabra que la caja
//   YA muestra ("cla Cloud" + "Cloud de que" -> "cla Cloud Cloud de que").
//   Causa B (variante): Chrome emite en el MISMO result una variante con la palabra
//   repetida y "la mas completa gana" la conserva ("tanto tanto porque" 73 > 72).
// ============================================================
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import { colaNuevaTrasSolape } from '../src/voice/lib/conversationStreamCommit.js'
import { collapseAdjacentWordRepeat, resolveMicFragmentMerge, pickBestMicInterim } from '../src/voice/lib/speechMerge.js'
import { processMicConversationIngress } from '../src/voice/lib/transcriptIngress.js'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { readStreamDisplay } from '../src/voice/lib/conversationStream.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const T0_BOX_ANTES = 'bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cierto lo que nos dijo cla Cloud'

describe('SONDA: que produce la caja con las cadenas MEDIDAS', () => {
  it('trace de la cadena real del turno 0', () => {
    const chunk220 = pickBestMicInterim([
      'bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie',
      ' de que',
    ])
    console.log('[sonda] chunk220 =', JSON.stringify(chunk220), 'len', chunk220.length)
    const openLine = resolveMicFragmentMerge(T0_BOX_ANTES, chunk220)
    console.log('[sonda] openLine tras chunk220 =', JSON.stringify(openLine.slice(-50)), 'len', openLine.length)

    // interino real del turno 8: Chrome emitio " Cloud Cloud" como interino
    const ch438 = pickBestMicInterim([' puso', ' Cloud Cloud'])
    console.log('[sonda] chunk438 =', JSON.stringify(ch438))
    const openLinePuso = resolveMicFragmentMerge('puso Cloud', 'Cloud Cloud')
    console.log('[sonda] openLinePuso =', JSON.stringify(openLinePuso))

    // variantes reales del turno 24 (finales limpios, fila tartamudeada)
    const chT24 = pickBestMicInterim(['súper rico A mí me encanta ese', ' polvito como ahí para que tenga saborcito pero tampoco tanto porque'])
    console.log('[sonda] chunkT24 =', JSON.stringify(chT24.slice(-40)))

    // EXACTO medido C1:13/14 (eventos "está ya" -> "está ya está")
    const box13 = 'bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie lo que nos dijo cla Cloud de que ya está ya'
    const cap14 = 'bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie está ya está'
    console.log('[sonda] union14 =', JSON.stringify(colaNuevaTrasSolape(box13, cap14).slice(-40)))
    console.log('[sonda] union14FULL =', JSON.stringify(colaNuevaTrasSolape(box13, cap14)))

    expect(true).toBe(true)
  })
})

describe('A. COSTURA de la caja (colaNuevaTrasSolape)', () => {
  it('A1 medido turn 0: la union NO re-entrega la palabra que la caja ya muestra', () => {
    const mostrado = T0_BOX_ANTES
    const capture = 'bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cierto lo que nos dijo cla Cloud Cloud de que'
    const union = colaNuevaTrasSolape(mostrado, capture)
    console.log('[A1] union =', JSON.stringify(union.slice(-50)))
    expect(union.toLowerCase()).not.toContain('cloud cloud')
  })

  it('A2 doble LEGITIMO de la emision sobrevive (no se colapsa a ciegas)', () => {
    const union = colaNuevaTrasSolape('lo que nos dijo no', 'lo que nos dijo no no pasa')
    expect(union).toBe('lo que nos dijo no no pasa')
  })

  it('A3 append normal sin solape no cambia de conducta', () => {
    const union = colaNuevaTrasSolape('hola buenas tardes', 'hola buenas tardes como estas')
    expect(union).toBe('hola buenas tardes como estas')
  })
})

describe('B. VARIANTES del final (canon sin tartamudeo)', () => {
  it('B1 medido turn 8: la variante tartamudeada NO desplaza a la limpia', () => {
    const fin = ['puso Cloud', 'puso Cloud Cloud'].map((t) => collapseAdjacentWordRepeat(t.split(/\s+/), { datosNumericos: true, longitudMinima: 4 }).join(''))
    expect(fin[0]).toBe(fin[1])
  })

  it('B2 medido turn 25: "tanto tanto" no gana por longitud', () => {
    const fin = ['tanto porque', 'tanto tanto porque'].map((t) => collapseAdjacentWordRepeat(t.split(/\s+/), { datosNumericos: true, longitudMinima: 4 }).join(''))
    expect(fin[0]).toBe(fin[1])
  })

  it('B3 falsificacion: palabra corta de enfasis NO se colapsa', () => {
    const col = collapseAdjacentWordRepeat('dijo no no'.split(/\s+/), { datosNumericos: true, longitudMinima: 4 })
    expect(col.join(' ')).toBe('dijo no no')
  })

  it('B4 falsificacion: dictado numerico NO se colapsa', () => {
    const col = collapseAdjacentWordRepeat('el 2 2'.split(/\s+/), { datosNumericos: true, longitudMinima: 4 })
    expect(col.join(' ')).toBe('el 2 2')
  })
})

/** Deps minimas de la puerta real (mismo cableado que reinyeccionTodos). */
function montarDeps() {
  const serie: string[] = []
  const filas: string[] = []
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
    commitTurnToSessionRows: vi.fn((text: string) => { if (text) filas.push(String(text)) }),
    scheduleTurnCommit: vi.fn((p: { capture?: string; utterance?: string }) => {
      const t = String(p?.capture || p?.utterance || '')
      if (t) filas.push(t)
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
  return { deps, ctx, serie, filas }
}

describe('C. REINYECCION turn 0 COMPLETO por la puerta real (processMicConversationIngress)', () => {
  it('C1 la caja del turno 0 nunca contiene "Cloud Cloud"', () => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false
    const e = montarDeps()
    const asr: Array<{ interims: string[]; finals: string[] }> = [
      // item1 fijo (interino) + item2 que crece (medido, seq 185-269 del log)
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' lo que nos dijo'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' que nos dijo'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' nos dijo'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' dijo'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' cla'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' Cloud'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' de'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' de que'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' ya'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' ya está'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' está'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' está ya'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' está ya está'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' ya está'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' ya está todo'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' está todo resu'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' está todo resuelto'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' todo resuelto'], finals: [] },
      { interims: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cie', ' resuelto'], finals: [] },
      { interims: [], finals: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cierto lo que nos dijo Cloud de que ya está ya está todo resuelto'] },
    ]
    for (const ev of asr) {
      processMicConversationIngress({ interimChunks: ev.interims, finalChunks: ev.finals, ctx: e.ctx as never })
    }
    const caja = String(e.deps.publishedLiveRef.current)
    console.log('[C1] caja final =', JSON.stringify(caja.slice(-80)), 'len', caja.length)
    console.log('[C1] openLine =', JSON.stringify(readStreamDisplay(e.deps.listenStateRef.current).slice(-80)))
    console.log('[C1] filas =', JSON.stringify(e.filas))
    expect(caja.toLowerCase()).not.toContain('cloud cloud')
    expect(caja.toLowerCase()).toContain('cloud de que')
    const fila = e.filas.at(-1) || ''
    expect(fila.toLowerCase()).not.toContain('cloud cloud')
  })
})

describe('E. PUERTAS DE FILA (canon en las dos puertas que sellan)', () => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false

  it('E1 medido turn 8: caja "puso Cloud Cloud" + final limpio "puso Cloud" -> fila "puso Cloud"', () => {
    const e = montarDeps()
    e.deps.publishedLiveRef.current = 'puso Cloud Cloud'
    processMicConversationIngress({ finalChunks: ['puso Cloud'], ctx: e.ctx as never })
    const fila = e.filas.at(-1) || ''
    console.log('[E1] fila =', JSON.stringify(fila))
    expect(fila.toLowerCase()).not.toContain('cloud cloud')
    expect(fila.toLowerCase()).toContain('puso cloud')
  })

  it('E2 medido turn 25: caja "…tanto tanto porque" + final limpio -> fila sin "tanto tanto"', () => {
    const e = montarDeps()
    e.deps.publishedLiveRef.current = 'como ahí para que tenga saborcito pero tampoco tanto tanto porque'
    processMicConversationIngress({ finalChunks: ['como ahí para que tenga saborcito pero tampoco tanto porque'], ctx: e.ctx as never })
    const fila = e.filas.at(-1) || ''
    console.log('[E2] fila =', JSON.stringify(fila.slice(-60)))
    expect(fila.toLowerCase()).not.toContain('tanto tanto')
    expect(fila.toLowerCase()).toContain('tanto porque')
  })

  it('E3 medido turn 2: caja "…cla Cloud Cloud de que…" + final limpio -> fila sin "Cloud Cloud"', () => {
    const e = montarDeps()
    e.deps.publishedLiveRef.current = 'bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cierto lo que nos dijo cla Cloud Cloud de que ya está ya todo resuelto'
    processMicConversationIngress({
      finalChunks: ['bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cierto lo que nos dijo Cloud de que ya está ya está todo resuelto'],
      ctx: e.ctx as never,
    })
    const fila = e.filas.at(-1) || ''
    console.log('[E3] fila =', JSON.stringify(fila.slice(-80)))
    expect(fila.toLowerCase()).not.toContain('cloud cloud')
  })

  it('E4 legitimo: el doble corto de enfasis "no no" SOBREVIVE en la fila', () => {
    const e = montarDeps()
    e.deps.publishedLiveRef.current = 'lo que nos dijo no no pasa'
    processMicConversationIngress({ finalChunks: ['lo que nos dijo no no pasa'], ctx: e.ctx as never })
    const fila = e.filas.at(-1) || ''
    console.log('[E4] fila =', JSON.stringify(fila))
    expect(fila.toLowerCase()).toContain('no no pasa')
  })

  it('E5 legitimo: el doble genuino de PARES "ya está ya está" SOBREVIVE en la fila', () => {
    const e = montarDeps()
    e.deps.publishedLiveRef.current = 'de que ya está ya está todo resuelto'
    processMicConversationIngress({ finalChunks: ['de que ya está ya está todo resuelto'], ctx: e.ctx as never })
    const fila = e.filas.at(-1) || ''
    console.log('[E5] fila =', JSON.stringify(fila))
    expect(fila.toLowerCase()).toContain('ya está ya está')
  })
})

describe('D. GUARDS de fuente (la regla vive en su dueno)', () => {
  it('D1 la costura anti-tartamudeo vive en conversationStreamCommit.js', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../src/voice/lib/conversationStreamCommit.js', import.meta.url), 'utf8')
    expect(src).toMatch(/COSTURA ANTI-TARTAMUDEO \(medido d4c1c8f3\)/)
    expect(src).toMatch(/mismaPalabraClave\(/)
  })

  it('D2 el canon sin tartamudeo vive en speechMerge.js y sella AMBAS puertas de fila', async () => {
    const { readFileSync } = await import('node:fs')
    const merge = readFileSync(new URL('../src/voice/lib/speechMerge.js', import.meta.url), 'utf8')
    expect(merge).toMatch(/export function collapseAdjacentWordRepeat/)
    const ingress = readFileSync(new URL('../src/voice/lib/transcriptIngress.js', import.meta.url), 'utf8')
    expect(ingress).toMatch(/export function canonSinTartamudeo/)
    // puerta del final (ingestFinalChunk)
    expect(ingress).toMatch(/commitCapture = canonSinTartamudeo\(commitCapture\)/)
    // puerta del cierre real (flushSrGapSegmentThroughIngress)
    expect(ingress).toMatch(/captureFinal = canonSinTartamudeo\(/)
  })

  it('D3 la costura de la caja cubre AMBOS caminos con la guarda de enfasis', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../src/voice/lib/conversationStreamCommit.js', import.meta.url), 'utf8')
    // camino A (alineacion de sufijo) con la costura
    expect(src).toMatch(/const primeraColaA = crudasNuevas\[fin \+ 1\]/)
    expect(src).toMatch(/mismaA && primeraColaA\.length >= 4/)
    // camino B con la guarda de enfasis corto
    expect(src).toMatch(/primeraCola\.length >= 4/)
  })
})
