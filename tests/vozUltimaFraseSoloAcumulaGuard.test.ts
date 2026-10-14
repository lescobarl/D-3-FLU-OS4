// ============================================================
// vozUltimaFraseSoloAcumulaGuard - A) LA FRASE VIVA ("ultima frase") SOLO ACUMULA.
// ------------------------------------------------------------
// MEDIDO (log del dueno 2026-10-11 11:28, al dictar una frase larga):
//   el texto mostrado pasaba de la frase COMPLETA a "dos o tres palabras" (una COLA del
//   ASR) y luego volvia a aparecer entero: "de repente la borra completa ... y luego dejar
//   como unas dos o tres palabras y luego no se ve todo y luego ya se vuelve a ver".
//   CAUSA MEDIDA (lectura del dueno unico del preview, `conversationStreamCommit`): el
//   recorte solo se bloqueaba por PREFIJO (`wouldShrinkListenLog`), asi que una COLA
//   contigua (o un trozo del medio) SI reemplazaba lo mostrado; y el CIERRE borraba la
//   memoria de lo mostrado (`publishedLiveRef = ''`), con lo que el siguiente trozo ya no
//   tenia contra que compararse.
//
// REGLA: dentro de un dictado el texto mostrado NO acorta y NO se vacia. La transicion a
// una locucion NUEVA la decide el DUENO del trozo (`isFragmentOfLocution`): una frase que
// NO es trozo reemplaza; un trozo conserva la COMPLETA.
// ESTE GUARD mide LO QUE SE MUESTRA (`scheduleLiveTranscriptUpdate` / `setLiveTranscript`),
// no un campo interno.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import { voiceProbe } from '../src/voice/lib/voiceProbe'
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const FRASE = 'el mismo escenario en donde cuando es una frase larga de repente la borra completa de la transcripcion'
const COLA = 'de la transcripcion'
const MEDIO = 'cuando es una frase larga'

function makeDeps(over: Record<string, unknown> = {}) {
  const mostrado: string[] = []
  const deps = {
    conversationActiveRef: { current: true },
    publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() },
    openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn<(v: string) => void>((v: string) => mostrado.push(String(v))),
    scheduleLiveTranscriptUpdate: vi.fn<(v: string) => void>((v: string) => mostrado.push(String(v))),
    applyConversationSpeaker: vi.fn(),
    flushPendingStreamLog: vi.fn(),
    logRowsTextRef: { current: [] as string[] },
    activeTurnIdRef: { current: 0 },
    flushPcmAfterTurnCommit: vi.fn(),
    lastCommitAtRef: { current: 0 },
    lastOnresultAtRef: { current: 0 },
    turnAudioStartSampleRef: { current: 0 },
    chunkTotalSamplesRef: { current: 0 },
    preflightScheduledForTurnRef: { current: true },
    srGapFiredForOpenLineRef: { current: true },
    processConversationFluQueryRef: { current: vi.fn() },
    lastEmittedTranscriptRef: { current: '' },
    emitConversationLog: vi.fn(() => true),
    createSpeakerAudioResolver: vi.fn(() => () => Promise.resolve({ speakerName: 'Hablante 1' })),
    sessionPrimarySpeakerRef: { current: '' },
    lastLoggedSpeakerRef: { current: '' },
    logRowSpeakersRef: { current: [] as string[] },
    speakerClustersRef: { current: [] as object[] },
    setSpeakerClusters: vi.fn(),
    lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null as number[] | null },
    lastLogLineTextRef: { current: '' },
    commitTurnToSessionRows: vi.fn(),
    lastRequestRef: { current: { text: '', at: 0 } },
    fluParticipantRef: { current: { onTurnCommitted: vi.fn() } },
  }
  Object.assign(deps, over)
  return { deps, mostrado }
}

const ultimo = (mostrado: string[]) => mostrado[mostrado.length - 1] || ''

describe('A - la ultima frase SOLO acumula (lo que se ve)', () => {
  beforeEach(() => {
    FLU_CONFIG.voiceCommands.requireWakeAlways = false
    resetTurnSpeakerPreflights()
    vi.mocked(voiceProbe).mockClear()
  })
  afterEach(() => {
    resetTurnSpeakerPreflights()
  })

  it('un TROZO posterior (la COLA) NO acorta lo mostrado', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    expect(ultimo(mostrado)).toBe(FRASE)

    handleConversationStreamSync(deps as never, { capture: COLA })
    expect(ultimo(mostrado), 'la cola no puede reemplazar la frase mostrada').toBe(FRASE)

    handleConversationStreamSync(deps as never, { capture: MEDIO })
    expect(ultimo(mostrado), 'un trozo del medio tampoco').toBe(FRASE)
  })

  it('la sonda `live` registra el acortamiento CON antes/despues', () => {
    const { deps } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: COLA })
    const llamadas = vi.mocked(voiceProbe).mock.calls.filter((c) => c[0] === 'live')
    expect(llamadas.length, 'la sonda de la frase viva tiene que emitir').toBeGreaterThanOrEqual(2)
    const acorte = llamadas.find((c) => (c[1] as { acorta?: boolean })?.acorta === true)
    expect(acorte, 'el acortamiento se registra con su motivo').toBeTruthy()
    expect((acorte?.[1] as { previo?: number })?.previo).toBe(FRASE.length)
    expect((acorte?.[1] as { len?: number })?.len).toBe(COLA.length)
  })

  it('una locucion NUEVA tampoco reemplaza: la caja solo acumula (ni por otra locucion)', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: 'pon musica relajante para cenar y tambien una lista de compras larga para toda la semana completa del mes entero' })
    expect(ultimo(mostrado)).toBe(FRASE)
  })

  it('RACIONAL DEL DUENO: al VACIAR la locucion a la conversacion, la ultima frase arranca de CERO', () => {
    // "Nueva iteracion de transcripcion = nueva ultima frase. Ya vaciaste a la conversacion,
    //  entonces ultima frase = ''" (dueno, 2026-10-11). Es el reset que quita el congelamiento
    //  de raiz: la memoria vuelve a "" y el dictado siguiente no puede ser "mas corto" que nada.
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: FRASE, turnCommit: true, settlesTurn: true })
    expect(deps.emitConversationLog, 'la locucion se vacio a la conversacion').toHaveBeenCalled()
    expect(deps.publishedLiveRef.current, 'la memoria arranca de cero').toBe('')
    expect(mostrado[mostrado.length - 1], 'y la zona se vacia').toBe('')
    // El dictado NUEVO (mas corto) se ve.
    handleConversationStreamSync(deps as never, { capture: 'ya no transcribio nada' })
    expect(ultimo(mostrado), 'el dictado nuevo se ve desde cero').toBe('ya no transcribio nada')
  })

  it('el caso CRUDO del log del dueno: tras una locucion larga el dictado nuevo se VE', () => {
    // debug.log 16:11-16:12: la frase viva quedo congelada en la 1.a locucion (382 chars) mientras
    // el dueno dictaba "ya no transcribio ya nada a la ultima frase..." -> 543 bloqueos.
    const LARGA = 'vamos a validar otra vez esto esta haciendo cada vez mas tortuoso me desespera el equipo de kilo cody de ghost'
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: LARGA })
    expect(ultimo(mostrado)).toBe(LARGA)
    for (const t of ['no se', 'no se que', 'no se que construye', 'ya no transcribio nada a la ultima frase']) {
      handleConversationStreamSync(deps as never, { capture: t })
    }
    expect(ultimo(mostrado), 'LA CAJA SOLO ACUMULA: el dictado mas corto NO reemplaza (medido 2026-10-11 22:36 -> 356 acortamientos APLICADOS)').toBe(LARGA)
  })

  it('una locucion DISTINTA mas CORTA tampoco reemplaza (la caja solo acumula)', () => {
    // ANTI-CONGELAMIENTO (medido en el log del dueno 16:11-16:12: 543 bloqueos con previo=382
    // mientras dictaba OTRA frase): si el texto nuevo no se relaciona con lo mostrado, es una
    // locucion nueva y DEBE verse. Dentro de la locucion nada encoge (caso anterior).
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: 'ya no transcribio nada a la ultima frase' })
    expect(ultimo(mostrado), 'ni una locucion distinta puede encoger lo mostrado').toBe(FRASE)
  })

  it('el CIERRE vacia la zona (la locucion YA esta en la conversacion) y la iteracion nueva acumula desde cero', () => {
    const { deps, mostrado } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: FRASE, turnCommit: true, settlesTurn: true })
    expect(mostrado[mostrado.length - 1], 'el cierre vacia la zona').toBe('')
    // Iteracion NUEVA: se acumula desde cero (no puede quedar congelada por la anterior).
    handleConversationStreamSync(deps as never, { capture: 'otra cosa distinta que digo ahora' })
    expect(ultimo(mostrado)).toBe('otra cosa distinta que digo ahora')
  })

  it('un resultado NUEVO que ARRANCA en la cola de lo mostrado ANADE lo nuevo (no se congela)', () => {
    // MEDIDO 2026-10-14 16:04:34-16:05:08 (su log): Chrome confirmo el final TRUNCANDO la cola y
    // la reentrego como resultado NUEVO; cada emision (2..178 chars) era MAS CORTA que la caja
    // (previo=846) y quedo BLOQUEADA 40+ s: "esta congelado, no transcribe nada". La emision
    // arranca en la COLA de lo mostrado y sigue con texto nuevo: es la MISMA locucion creciendo
    // -> la caja ANADE la parte nueva (nunca encoge, nunca reemplaza).
    const { deps, mostrado } = makeDeps()
    const cola = FRASE.split(' ').slice(-5).join(' ')
    const nuevo = cola + ' y sigue hablando aqui'
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: nuevo })
    expect(ultimo(mostrado), 'la caja suma lo nuevo en vez de congelarse').toBe(FRASE + ' y sigue hablando aqui')
    const live = vi.mocked(voiceProbe).mock.calls.filter((c) => c[0] === 'live').map((c) => c[1] as { resultado?: string; acorta?: boolean })
    expect(live.filter((o) => o.resultado === 'aplicado' && o.acorta === true), 'acorta:true + aplicado = 0').toEqual([])
  })
  it('un resultado NUEVO que arranca EN MEDIO de lo mostrado ANADE su cola nueva (no se congela)', () => {
    // MEDIDO 2026-10-14 16:04:34-16:05:08 (su log): Chrome confirmo el final TRUNCANDO la cola y
    // la reentrego como resultado NUEVO que arranca en un trozo INTERIOR de la caja de 846
    // ("el avion se alejo..." estaba DENTRO, no al final) y sigue con texto nuevo; cada emision
    // (2..178 chars) era MAS CORTA y quedo bloqueada 40+ s ("esta congelado, no transcribe nada").
    // La caja ANADE su cola nueva: nunca encoge, nunca reemplaza, y un trozo puro no aNade nada.
    const { deps, mostrado } = makeDeps()
    const CABEZA = 'a la 1:40 de la madrugada del miercoles 31 de octubre de 1979 el vuelo numero 2605 de la hoy extinta empresa Western Airlines iniciaba su despegue'
    const INTERIOR = 'el avion se alejo perdiendose en el cielo negro de esa noche'
    const BOX = CABEZA + ' ' + INTERIOR + ' la aeronave era pilotada por el capitan'
    handleConversationStreamSync(deps as never, { capture: BOX })
    expect(ultimo(mostrado)).toBe(BOX)
    const NUEVO = INTERIOR + ' la aeronave era pilotada por el capitan un experimentado piloto de 53 anos de edad el primer oficial en el puesto que'
    handleConversationStreamSync(deps as never, { capture: NUEVO })
    expect(ultimo(mostrado), 'la caja suma la cola nueva en vez de congelarse').toBe(BOX + ' un experimentado piloto de 53 anos de edad el primer oficial en el puesto que')
  })
  it('la sonda DICE si el acortamiento fue BLOQUEADO o APLICADO (dato concluyente)', () => {
    const { deps } = makeDeps()
    handleConversationStreamSync(deps as never, { capture: FRASE })
    handleConversationStreamSync(deps as never, { capture: COLA })
    handleConversationStreamSync(deps as never, { capture: 'pon musica relajante para cenar' })
    const live = vi.mocked(voiceProbe).mock.calls.filter((c) => c[0] === 'live').map((c) => c[1] as { resultado?: string; acorta?: boolean; mismaLocucion?: boolean; len?: number; previo?: number; fresh?: boolean })
    expect(live.some((o) => o.resultado === 'bloqueado'), 'el recorte bloqueado se declara').toBe(true)
    expect(live.some((o) => o.resultado === 'aplicado'), 'la sustitucion aplicada se declara').toBe(true)
    // INVARIANTE: un TROZO contiguo de lo mostrado JAMAS se aplica (la locucion solo acumula).
    expect(live.filter((o) => o.resultado === 'aplicado' && o.mismaLocucion === true), 'un trozo de lo mostrado no se aplica').toEqual([])
    // Y lo aplicado que encoge es locucion DISTINTA (no una revision de lo mostrado).
    expect(live.filter((o) => o.resultado === 'aplicado' && o.acorta === true), 'nada encoge: acorta:true + aplicado = 0').toEqual([])
    // El bloqueado SIEMPRE acorta (es su motivo).
    expect(live.filter((o) => o.resultado === 'bloqueado').every((o) => o.acorta === true)).toBe(true)
    // El campo tiene que existir en TODA emision: sin el, el dato no es concluyente.
    expect(live.every((o) => o.resultado === 'bloqueado' || o.resultado === 'aplicado')).toBe(true)
  })

  it('control NEGATIVO (el detector no es decorativo): el criterio por PREFIJO dejaba pasar la cola', () => {
    // Implementacion VIEJA aislada: solo bloqueaba si el nuevo texto era PREFIJO del mostrado.
    const viejoBloquea = (nuevo: string, mostrado: string) =>
      Boolean(mostrado) && Boolean(nuevo) && nuevo.length < mostrado.length && mostrado.startsWith(nuevo)
    expect(viejoBloquea(COLA, FRASE), 'la COLA pasaba el filtro viejo (el defecto medido)').toBe(false)
    expect(viejoBloquea('el mismo escenario', FRASE), 'un prefijo si se bloqueaba').toBe(true)
  })
})
