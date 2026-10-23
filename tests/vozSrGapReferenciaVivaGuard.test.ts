// ============================================================
// vozSrGapReferenciaVivaGuard - el cierre por srGap retiene la REFERENCIA VIVA
// ------------------------------------------------------------
// MEDIDO 2026-10-13 (funciones REALES: flushSrGapSegmentThroughIngress ->
// handleConversationStreamSync -> emitConversationLog):
//   T1 estado crudo = TROZO de 54 chars ya escrito como fila, linea viva = 235
//      chars -> el EVAL contesta 'already-committed' y NO se escribe nada: la cola
//      de la locucion se pierde en el evento que debia cerrarla.
//   T2 estado crudo VACIO (Chrome limpio el buffer) y linea viva con la locucion
//      -> 'empty-openline' y NO se escribe nada: la referencia viva no se retiene.
//   T3 linea viva == ultima fila -> NO se duplica (freno que se conserva).
//   T4 trozo distinto de la ultima fila -> ya se escribia la locucion completa
//      (b3e8541); se fija como regresion.
// ARREGLO: la locucion viva acumulada (publishedLiveRef) se escribe EN EL OBJETO
// del estado (mutacion in-place: la identidad de la referencia que comparten los
// consumidores NO cambia) ANTES del EVAL, para que el EVAL, sus portones y el
// commit vean la locucion COMPLETA y no el trozo del ASR.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { flushSrGapSegmentThroughIngress } from '../src/voice/lib/transcriptIngress.js'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const requireWakeAlwaysBefore = FLU_CONFIG.voiceCommands.requireWakeAlways
beforeEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false
})
afterEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = requireWakeAlwaysBefore
})

// Locucion viva de 235 chars (el defecto medido hablaba de 242: el numero exacto no
// importa; lo que importa es que el TROZO del ASR es mucho mas corto).
const LOCUCION =
  'quiero que me expliques con calma todos los pasos de la receta de pan casero y ademas como preparar la masa madre para que quede esponjoso con buen sabor y una corteza dorada que cruja al partirse y quiero saber cuantas porciones salen'
const TROZO = LOCUCION.slice(0, 54)

/** Estado de escucha + relojes de la linea viva (los escribe conversationStream). */
type EstadoDeEscuchaConRelojes = {
  openLine: string
  pendingInterim: string
  pendingFinal: string
  openLineStartedAtMs: number
  openLineLastTouchMs: number
}

/**
 * Arnes: el cierre REAL por srGap sobre el estado y las filas del caso. Los
 * colaboradores (EVAL, portones y escritor de la fila) son los de produccion.
 */
function cerrarPorSrGap({ openLine = '', live = '', final = '', filas = [] as string[] }) {
  // El estado REAL de escucha + los dos relojes que usa el EVAL del srGap (el
  // tipo publico del modulo no los declara porque los escribe conversationStream).
  const listenState = createActiveListenState() as unknown as EstadoDeEscuchaConRelojes
  const hace4s = Date.now() - 4000
  listenState.openLine = openLine
  listenState.pendingFinal = final
  listenState.openLineStartedAtMs = hace4s
  listenState.openLineLastTouchMs = hace4s

  const logRowsTextRef = { current: [...filas] }
  const publishedLiveRef = { current: live }
  const refs = {
    publishedLiveRef,
    listenStateRef: { current: listenState },
    lastStreamPreviewRef: { current: '' },
    logRowsTextRef,
    logRowSpeakersRef: { current: filas.map(() => 'Hablante 1') },
    lastEmittedTranscriptRef: { current: filas.at(-1) || '' },
    lastLoggedSpeakerRef: { current: 'Hablante 1' },
    lastCommitAtRef: { current: 0 },
    preflightScheduledForTurnRef: { current: true },
    openPreviewTurnRef: { current: false },
    lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null as number[] | null },
    lastLogLineTextRef: { current: '' },
    sessionPrimarySpeakerRef: { current: '' },
    speakerClustersRef: { current: [] as object[] },
    activeTurnIdRef: { current: 0 },
    lastRequestRef: { current: { text: '', at: 0 } },
    processConversationFluQueryRef: { current: vi.fn() },
    fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
    srGapFiredForOpenLineRef: { current: true },
  }

  const deps = {
    conversationActiveRef: { current: true },
    publishedLiveRef: refs.publishedLiveRef,
    listenStateRef: refs.listenStateRef,
    openPreviewTurnRef: refs.openPreviewTurnRef,
    setLiveTranscript: vi.fn(),
    scheduleLiveTranscriptUpdate: vi.fn(),
    applyConversationSpeaker: vi.fn(),
    flushPendingStreamLog: vi.fn(),
    logRowsTextRef: refs.logRowsTextRef,
    activeTurnIdRef: refs.activeTurnIdRef,
    captureTurnAudio: vi.fn(),
    flushPcmAfterTurnCommit: vi.fn(),
    lastCommitAtRef: refs.lastCommitAtRef,
    lastOnresultAtRef: { current: 0 },
    turnAudioStartSampleRef: { current: 0 },
    chunkTotalSamplesRef: { current: 0 },
    preflightScheduledForTurnRef: refs.preflightScheduledForTurnRef,
    srGapFiredForOpenLineRef: refs.srGapFiredForOpenLineRef,
    processConversationFluQueryRef: refs.processConversationFluQueryRef,
    lastEmittedTranscriptRef: refs.lastEmittedTranscriptRef,
    // Fiel al escritor real: la fila del turno se REEMPLAZA cuando el porton lo
    // decide (`replaceLastRawLog`), no se duplica (medido: resolveMicCommitAction
    // devuelve replaceLast=true para trozo -> locucion completa).
    emitConversationLog: vi.fn((text: string, options?: { replaceLastRawLog?: boolean }) => {
      const filas = refs.logRowsTextRef.current
      if (options?.replaceLastRawLog && filas.length) filas[filas.length - 1] = text
      else filas.push(text)
      return true
    }),
    createSpeakerAudioResolver: () => () => Promise.resolve({ speakerName: 'Hablante 1' }),
    sessionPrimarySpeakerRef: refs.sessionPrimarySpeakerRef,
    lastLoggedSpeakerRef: refs.lastLoggedSpeakerRef,
    logRowSpeakersRef: refs.logRowSpeakersRef,
    speakerClustersRef: refs.speakerClustersRef,
    setSpeakerClusters: vi.fn(),
    lastSpeakerRef: refs.lastSpeakerRef,
    lastTurnSignatureRef: refs.lastTurnSignatureRef,
    lastLogLineTextRef: refs.lastLogLineTextRef,
    commitTurnToSessionRows: vi.fn(),
    fluParticipantRef: refs.fluParticipantRef,
    lastRequestRef: refs.lastRequestRef,
    isTurnLive: () => false,
  }

  const ctx = {
    conversationActive: true,
    ingressSource: 'mic',
    listenState,
    publishedLiveRef: refs.publishedLiveRef,
    openPreviewTurnRef: refs.openPreviewTurnRef,
    logRowsTextRef: refs.logRowsTextRef,
    logRowSpeakersRef: refs.logRowSpeakersRef,
    lastEmittedTranscriptRef: refs.lastEmittedTranscriptRef,
    lastLoggedSpeakerRef: refs.lastLoggedSpeakerRef,
    lastStreamPreviewRef: refs.lastStreamPreviewRef,
    lastCommitAtRef: refs.lastCommitAtRef,
    preflightScheduledForTurnRef: refs.preflightScheduledForTurnRef,
    tryDispatch: () => false,
    maybeSwitchLocale: () => {},
    syncConversationStream: (payload: object) =>
      handleConversationStreamSync(deps as never, payload as never),
    scheduleTurnCommit: (payload: object) =>
      handleConversationStreamSync(deps as never, { ...payload, turnCommit: true } as never),
    flushTranscriptOnFinal: () => {},
    flushRecognitionOnFinal: () => {},
    commitTurnToSessionRows: () => {},
    debugHotPath: false,
    fluDebugHot: () => {},
    getIngressVoiceContext: () => ({}),
    markAudioSegmentStart: () => {},
    onTurnFinalized: () => {},
    peekTurnBridgeText: () => '',
    stashTurnBridgeText: () => {},
    consumeTurnBridgeText: () => '',
    touchMeaningfulIngress: () => {},
    scheduleIdentityPreflight: () => {},
  }

  const result = flushSrGapSegmentThroughIngress(ctx as never, { sinceLastResultMs: 4000 })
  return { result, filas: refs.logRowsTextRef.current, listenState }
}

describe('srGap: el cierre retiene la referencia viva completa', () => {
  it('T1: el buffer crudo quedo en el TROZO ya escrito como fila -> escribe la locucion COMPLETA', () => {
    const { result, filas } = cerrarPorSrGap({
      openLine: TROZO,
      live: LOCUCION,
      filas: [TROZO],
    })
    console.log(`  T1 flushed=${(result as { flushed?: boolean }).flushed} reason=${(result as { reason?: string }).reason} filas=${filas.map((t) => t.length).join(',')}`)
    expect(filas.length, 'la fila del trozo se REEMPLAZA por la completa, no se duplica').toBe(1)
    expect(
      filas.at(-1),
      'la locucion viva completa tiene que llegar a la fila, no el trozo del ASR',
    ).toBe(LOCUCION)
  })

  it('T2: el buffer crudo esta VACIO y la linea viva trae la locucion -> la escribe', () => {
    const { filas } = cerrarPorSrGap({ openLine: '', live: LOCUCION, filas: [] })
    console.log(`  T2 filas=${filas.map((t) => t.length).join(',')}`)
    expect(filas.at(-1), 'la referencia viva no se puede quedar sin fila').toBe(LOCUCION)
  })

  it('T3: la linea viva YA es la ultima fila -> NO se duplica', () => {
    const { result, filas } = cerrarPorSrGap({ openLine: '', live: LOCUCION, filas: [LOCUCION] })
    console.log(`  T3 flushed=${(result as { flushed?: boolean }).flushed} reason=${(result as { reason?: string }).reason} filas=${filas.length}`)
    expect(filas.length, 'una locucion ya escrita no se escribe dos veces').toBe(1)
    expect(filas.at(-1)).toBe(LOCUCION)
  })

  it('T4: trozo del ASR distinto de la ultima fila -> la fila lleva la locucion completa', () => {
    const { filas } = cerrarPorSrGap({ openLine: TROZO, live: LOCUCION, filas: ['hola como estas'] })
    console.log(`  T4 filas=${filas.map((t) => t.length).join(',')}`)
    expect(filas.at(-1)).toBe(LOCUCION)
  })

  it('P11.9: caja CORTA + FINAL confirmado mas completo -> la fila lleva el final y la caja crece', () => {
    // Mutacion: si el cierre borra el texto vivo (o commitea la caja a secas), esta
    // expectativa falla. Es el defecto medido: la caja habia bloqueado una emision mas
    // completa y el final confirmado se perdia al cerrar por silencio.
    const corta = 'quiero que me expliques con calma todos los pasos'
    const { filas } = cerrarPorSrGap({ openLine: LOCUCION, live: corta, final: LOCUCION, filas: [] })
    console.log(`  DET frame=${filas.map((t) => t.length).join(',')}`)
    expect(filas.at(-1), 'la fila lleva el FINAL confirmado, no la caja corta').toBe(LOCUCION)
  })

  it('P11.9b: caja CORTA + viva de la MISMA revision que CONSERVA el bloque y trae mas texto -> la fila lleva la completa (sin final)', () => {
    const corta = 'quiero que me expliques con calma'
    const { filas } = cerrarPorSrGap({ openLine: LOCUCION, live: corta, filas: [] })
    // La viva conserva TODAS las palabras de la caja: la fila puede crecer sin perder nada.
    expect(filas.at(-1)).toBe(LOCUCION)
  })

  it('P11.9c: viva mas larga que NO conserva el bloque de la caja -> manda la caja (no hay perdida)', () => {
    const caja = 'vamos a preparar la receta'
    const ajena = 'pon la mesa y trae los platos y los cubiertos para la cena'
    const { filas } = cerrarPorSrGap({ openLine: ajena, live: caja, filas: [] })
    // Otra hipotesis no puede llevarse la fila: la caja es la verdad visible.
    expect(filas.at(-1)).toBe(caja)
  })

  it('B.3: otra HIPOTESIS (arranque distinto) no se mezcla: manda la caja', () => {
    const ajena = 'buenos dias a todos los presentes'
    const { filas } = cerrarPorSrGap({ openLine: LOCUCION, live: ajena, filas: [] })
    // Nunca se concatenan dos hipotesis: la fila es UNA emision entera, la que muestra la caja.
    expect(filas.at(-1)).toBe(ajena)
    expect(filas.at(-1)).not.toContain('quiero que me expliques')
  })
})