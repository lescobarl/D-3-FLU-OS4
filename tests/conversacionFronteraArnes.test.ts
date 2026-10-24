// @vitest-environment node
/**
 * FRONTERA DE AUDIO sobre el ARNES REAL del replay (`buildHarness` de
 * `scripts/replay/eventsRunner.mjs`): ingress REAL (`createConversationIngressRuntime`) +
 * commit REAL (`handleConversationStreamSync`) + CAJA real (una sola instancia, la que mide
 * el runner). No hay doble del escritor de filas: lo que se mide es la tuberia que corre en
 * `npm run replay`.
 *
 * Fija las TRES mutaciones del cierre por frontera:
 *  1. captura vacia -> NO escribe fila (la caja no es fuente de una fila por si misma).
 *  2. final tardio del MISMO tramo -> UNA fila (reemplaza; no abre otra).
 *  3. final de OTRO tramo -> DOS filas (la frontera separo dos locuciones).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildHarness } from '../scripts/replay/eventsRunner.mjs'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import { pushMicSpeechEvent, pushRecognitionEndEvent } from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import {
  crearCajaDeLaFrase,
  handleConversationStreamSync,
} from '../src/voice/lib/conversationStreamCommit.js'
import { readTurnLive, utterancesSameRevision } from '../src/voice/lib/conversationStream.js'
import { scheduleTurnSpeakerPreflight, resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const LOCUCION_1 =
  'voy a decir El Comando para que sustituya todos los nombres todos mis intervenciones con con nombre propio Okay flu Soy Luis'
const LOCUCION_2 =
  'magistrado Luis ya le puso Luis a todo a todas las intervenciones Eso es correcto hasta aqui vamos bien voy a poner ahora a la mujer a hablar cedo la palabra'

const requireWakeAlwaysBefore = FLU_CONFIG.voiceCommands.requireWakeAlways
beforeEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false
  // Estado GLOBAL de medidas de voz: cada caso parte limpio.
  resetTurnSpeakerPreflights()
})
afterEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = requireWakeAlwaysBefore
})

/** Evento con forma de SpeechRecognitionEvent de Chrome. */
function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>) {
  const results = specs.map((s) => ({
    isFinal: Boolean(s.isFinal),
    0: { transcript: s.transcript, confidence: 0.9 },
    length: 1,
  }))
  return { resultIndex: 0, results }
}

/** Lo observable que este test consume del arnes del replay (el resto es `unknown`). */
type ArnésReplay = {
  deps: never
  bindings: {
    publishedLiveRef: { current: string }
    getIngressVoiceContext?: unknown
    nowMs?: () => number
    scheduleIdentityPreflight?: (payload?: { utterance?: string }) => void
  }
  observed: {
    rows: Array<{ text: string; speaker: string }>
    commits: Array<{ turnId: number | null; text: string }>
  }
  refs: {
    preflightScheduledForTurnRef: { current: boolean }
    activeTurnIdRef: { current: number }
    openPreviewTurnRef: { current: boolean }
  }
}

/**
 * Arnes REAL del replay con reloj controlado: el `nowMs` que decide la quietud de la linea
 * es el MISMO que usa el runner (`bindings.nowMs`).
 */
function createArnés() {
  let ahora = Date.now()
  const clock = { now: () => ahora }
  const app = {
    handleConversationStreamSync,
    crearCajaDeLaFrase,
    createActiveListenState,
    readTurnLive,
    utterancesSameRevision,
  }
  const { deps, bindings, observed, refs } = buildHarness(app as never, clock) as unknown as ArnésReplay
  bindings.getIngressVoiceContext = () => ({ audioFrontera: 0 })
  bindings.nowMs = () => ahora
  /** Avisos de medida de voz pedidos (una entrada por VENTANA medida). */
  const medidas: Array<{ utterance: string }> = []
  const runtime = createConversationIngressRuntime({ getBindings: () => bindings })
  return {
    deps,
    bindings,
    observed,
    refs,
    medidas,
    /** Enciende el aviso de identidad con la MISMA guarda que el hook (`preflightScheduledForTurnRef`). */
    activarMedidaDeVoz() {
      refs.preflightScheduledForTurnRef.current = false
      bindings.scheduleIdentityPreflight = (payload = {}) => {
        if (refs.preflightScheduledForTurnRef.current) return
        refs.preflightScheduledForTurnRef.current = true
        medidas.push({ utterance: String(payload.utterance || '') })
      }
    },
    avanzar(ms: number) {
      ahora += ms
    },
    interim(texto: string) {
      pushMicSpeechEvent(chromeEvent([{ isFinal: false, transcript: texto }]) as never, runtime.queue)
      runtime.drainAll()
    },
    final(texto: string) {
      pushMicSpeechEvent(chromeEvent([{ isFinal: true, transcript: texto }]) as never, runtime.queue)
      runtime.drainAll()
    },
    end() {
      pushRecognitionEndEvent(runtime.queue)
      runtime.drainAll()
    },
  }
}

describe('frontera de audio sobre el arnes real del replay', () => {
  it('MUTACION 1: captura vacia NO escribe fila (la caja no es fuente de una fila)', () => {
    const h = createArnés()

    // Puerta REAL del commit, sin captura y sin locucion abierta: la caja puede mostrar una
    // locucion a medias, y eso NO es una fila.
    handleConversationStreamSync(h.deps, {
      turnCommit: true,
      settlesTurn: true,
      locutionClosed: true,
    })

    expect(h.observed.rows, 'sin captura no hay fila').toHaveLength(0)
  })

  it('la frontera escribe la fila de la locucion cerrada con la linea COMPLETA', () => {
    const h = createArnés()
    h.interim(LOCUCION_1)
    h.avanzar(2000)
    h.interim(LOCUCION_2)

    expect(h.observed.rows).toHaveLength(1)
    expect(h.observed.rows[0].text).toBe(LOCUCION_1)
    expect(
      h.bindings.publishedLiveRef.current,
      'la caja de la locucion cerrada NO se queda: muestra la locucion SIGUIENTE',
    ).toBe(LOCUCION_2)
  })

  it('MUTACION 2: final tardio del MISMO tramo -> UNA fila (reemplaza, no abre otra)', () => {
    const h = createArnés()
    h.interim(LOCUCION_1)
    h.avanzar(2000)
    h.interim(LOCUCION_2) // frontera: fila de la locucion 1
    const tardio = `${LOCUCION_1} y la cola que llego despues`
    h.final(tardio) // el ASR confirma DESPUES la misma locucion, mas completa
    h.end()

    expect(h.observed.rows, 'mismo tramo = una fila').toHaveLength(1)
    expect(h.observed.rows[0].text, 'la fila se queda con el texto confirmado completo').toContain(
      'y la cola que llego despues',
    )
  })

  it('MUTACION 3: final de OTRO tramo -> DOS filas', () => {
    const h = createArnés()
    h.interim(LOCUCION_1)
    h.avanzar(2000)
    h.interim(LOCUCION_2) // frontera: fila de la locucion 1
    h.final(LOCUCION_2) // el final es de la locucion SIGUIENTE
    h.end()

    expect(h.observed.rows, 'dos locuciones = dos filas').toHaveLength(2)
    expect(h.observed.rows[0].text).toBe(LOCUCION_1)
    expect(h.observed.rows[1].text).toBe(LOCUCION_2)
  })
})

describe('una locucion = un id de turno (minteo) y una medida de voz', () => {
  it('el dictado con frontera acuña DOS ids: la frontera cierra el turno vivo', () => {
    const h = createArnés()
    h.interim(LOCUCION_1)
    h.avanzar(2000)
    h.interim(LOCUCION_2) // frontera: cierra el turno de la locucion 1
    h.end() // cierra la locucion 2

    expect(h.observed.rows, 'dos locuciones = dos filas').toHaveLength(2)
    const ids = h.observed.commits.map((commit) => commit.turnId)
    expect(ids.every((id) => Number(id) > 0), 'cada fila viaja con su id de turno').toBe(true)
    expect(ids[0], 'la locucion 2 NO reutiliza el id de la 1').not.toBe(ids[1])
  })

  // L1 DECLARADA (medida de voz): el aviso de identidad se pide UNA vez por dictado
  // (`preflightScheduledForTurnRef`), no una vez por locucion. La locucion 2 NO tiene
  // medida propia: hereda la firma/etiqueta de la 1. Cuando exista la medida por locucion
  // este test se pone ROJO y hay que pasarlo a `it` (protocolo del repo, como el `it.fails`
  // del tramo real). NO se declara diarizacion cerrada.
  it.fails('L1: cada locucion pide SU medida de voz (dos firmas distintas)', () => {
    const h = createArnés()
    h.activarMedidaDeVoz()
    h.interim(LOCUCION_1)
    h.avanzar(2000)
    h.interim(LOCUCION_2) // frontera
    h.avanzar(500)
    h.interim(`${LOCUCION_2} otra vez`) // la locucion 2 sigue dictandose
    h.end()

    expect(h.medidas, 'una medida por LOCUCION, no una por dictado').toHaveLength(2)
  })

  it('con una medida por locucion, dos firmas distintas dan DOS etiquetas', async () => {
    const flush = async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    resetTurnSpeakerPreflights()
    const h = createArnés()
    // Sin resolutor de audio: la medida la aportan las dos instantaneas sembradas (una por
    // locucion), que es lo que el pipeline produciria si midiera por locucion.
    delete (h.deps as unknown as { createSpeakerAudioResolver?: unknown }).createSpeakerAudioResolver
    const sembrar = async (turnId: number, nombre: string, vector: number[]) => {
      scheduleTurnSpeakerPreflight(turnId, () =>
        Promise.resolve({
          speakerId: `spk-${turnId}`,
          speakerName: nombre,
          signatureVector: vector,
          workingClusters: [{ label: nombre, signature: vector }],
          evidence: true,
          reason: 'resolved-idle',
        }),
      )
      await flush()
    }
    await sembrar(1, 'Luis', [1, 0, 0])
    await sembrar(2, 'Marta', [0, 1, 0])
    const commit = (texto: string, turnId: number) => {
      h.refs.activeTurnIdRef.current = turnId
      h.refs.openPreviewTurnRef.current = true
      handleConversationStreamSync(h.deps, { capture: texto, utterance: texto, turnCommit: true, settlesTurn: true })
    }
    commit(LOCUCION_1, 1)
    commit(LOCUCION_2, 2)
    resetTurnSpeakerPreflights()

    expect(h.observed.rows).toHaveLength(2)
    expect(h.observed.rows[0].speaker, 'la voz medida de la locucion 1').toBe('Luis')
    expect(h.observed.rows[1].speaker, 'la voz medida de la locucion 2').toBe('Marta')
  })
})
