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
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const LOCUCION_1 =
  'voy a decir El Comando para que sustituya todos los nombres todos mis intervenciones con con nombre propio Okay flu Soy Luis'
const LOCUCION_2 =
  'magistrado Luis ya le puso Luis a todo a todas las intervenciones Eso es correcto hasta aqui vamos bien voy a poner ahora a la mujer a hablar cedo la palabra'

const requireWakeAlwaysBefore = FLU_CONFIG.voiceCommands.requireWakeAlways
beforeEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false
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
  }
  observed: { rows: Array<{ text: string; speaker: string }> }
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
  const { deps, bindings, observed } = buildHarness(app as never, clock) as unknown as ArnésReplay
  bindings.getIngressVoiceContext = () => ({ audioFrontera: 0 })
  bindings.nowMs = () => ahora
  const runtime = createConversationIngressRuntime({ getBindings: () => bindings })
  return {
    deps,
    bindings,
    observed,
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
