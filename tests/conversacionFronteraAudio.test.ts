// @vitest-environment node
/**
 * FRONTERA DE AUDIO POR LOCUCIÓN (cierra L1 y el defecto A).
 *
 * Medido en la sesión 8f3112c2: dos locuciones SIN pausa suficiente (la pausa era 2440 ms,
 * por debajo de `srGapCommitMs` 3500) caían en UNA fila (ids de fuente 1792789182623 de 22
 * palabras y 1792789202635 de 32). El texto NO puede separarlas (cortar por texto produjo
 * 57 filas: el ASR reinicia su hipótesis a media frase). El AUDIO sí: el segmentador cierra
 * la locución en cuanto hay `minSilenceMs` de silencio.
 *
 * Aquí se fija: (1) el detector devuelve una posición de frontera en muestras, (2) el
 * ingress cierra la locución abierta en esa frontera y abre la siguiente, y (3) la mutación
 * con el tramo por evento APAGADO vuelve a pegar las dos locuciones en una fila.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crearDetectorDeFronteras, hayFronteraDeAudio } from '../src/voice/core/tramoDeLocucion.js'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import { pushMicSpeechEvent, pushRecognitionEndEvent } from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { resolveLogRowAction } from '../src/voice/lib/conversationStream.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

/** Las dos locuciones reales de la fila 5 del replay (fuente: los dos ids medidos). */
const LOCUCION_1 =
  'voy a decir El Comando para que sustituya todos los nombres todos mis intervenciones con con nombre propio Okay flu Soy Luis'
const LOCUCION_2 =
  'magistrado Luis ya le puso Luis a todo a todas las intervenciones Eso es correcto hasta aquí vamos bien voy a poner ahora a la mujer a hablar cedo la palabra'

const requireWakeAlwaysBefore = FLU_CONFIG.voiceCommands.requireWakeAlways
beforeEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false
})
afterEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = requireWakeAlwaysBefore
})

/** Evento con forma de SpeechRecognitionEvent de Chrome. */
function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
  const results = specs.map((s) => ({
    isFinal: Boolean(s.isFinal),
    0: { transcript: s.transcript, confidence: 0.9 },
    length: 1,
  }))
  return { resultIndex, results }
}

/**
 * Arnés REAL del ingress: `pushMicSpeechEvent` -> `processMicConversationIngress` -> commit.
 * El único doble es el escritor de filas (el hook), con las MISMAS reglas de fila.
 */
function createHarness({ fronteraActiva = true }: { fronteraActiva?: boolean } = {}) {
  const listenStateRef = { current: createActiveListenState() }
  const publishedLiveRef = { current: '' }
  const lastStreamPreviewRef = { current: '' }
  const rows: string[] = []
  const lastEmittedTranscriptRef = { current: '' }
  const lastCommitAtRef = { current: 0 }
  /** Posición (muestras) que el segmentador de voz ya cerró. La escribe el detector real. */
  const fronteraRef = { current: 0 }

  const bindings = {
    conversationActiveRef: { current: true },
    listenStateRef,
    publishedLiveRef,
    lastStreamPreviewRef,
    logRowsTextRef: { current: rows },
    logRowSpeakersRef: { current: [] as string[] },
    lastEmittedTranscriptRef,
    lastLoggedSpeakerRef: { current: 'Hablante 1' },
    lastCommitAtRef,
    preflightScheduledForTurnRef: { current: true },
    openPreviewTurnRef: { current: false },
    debugHotPath: false,
    fluDebugHot: () => {},
    getIngressVoiceContext: () => ({ audioFrontera: fronteraActiva ? fronteraRef.current : 0 }),
    tryDispatchConversationAction: () => false,
    flushTranscriptOnFinal: () => {},
    flushPcmAfterTurnCommit: () => {},
    maybeSwitchRecognitionLocale: () => {},
    commitTurnToSessionRows: () => {},
    syncConversationStream: (payload: { capture?: string; turnCommit?: boolean; newParagraph?: boolean } = {}) => {
      const capture = payload?.capture || ''
      if (!capture) return
      if (payload?.turnCommit) {
        const action = resolveLogRowAction({
          activeLogStream: false,
          newParagraph: Boolean(payload.newParagraph),
          turnBoundary: true,
          turnCommit: true,
          lastEmitted: lastEmittedTranscriptRef.current,
          lastCommitted: rows.at(-1) || '',
          capture,
          logRowContext: { msSinceLastCommit: Date.now() - lastCommitAtRef.current },
        })
        if (action.replaceLast && rows.length) rows[rows.length - 1] = capture
        else rows.push(capture)
        lastEmittedTranscriptRef.current = capture
        publishedLiveRef.current = capture
        lastCommitAtRef.current = Date.now()
      } else {
        publishedLiveRef.current = capture
      }
    },
    markAudioSegmentStart: () => {},
    touchMeaningfulIngress: () => {},
    scheduleIdentityPreflight: () => {},
    peekTurnBridgeText: () => '',
    stashTurnBridgeText: () => {},
    consumeTurnBridgeText: () => '',
    onTurnFinalized: () => {},
  }

  const runtime = createConversationIngressRuntime({ getBindings: () => bindings })
  return {
    rows,
    fronteraRef,
    listenStateRef,
    publishedLiveRef,
    inject(event: unknown) {
      pushMicSpeechEvent(event as never, runtime.queue)
      runtime.drainAll()
    },
    end() {
      pushRecognitionEndEvent(runtime.queue)
      runtime.drainAll()
    },
  }
}

const sampleRate = 16000
/** Silencio / tono de 200 Hz: dos locuciones separadas por 1,5 s de silencio. */
function audio(cortes: Array<[number, number]>, segundos = 6): Float32Array {
  const total = Math.round(sampleRate * segundos)
  const muestras = new Float32Array(total)
  for (const [desde, hasta] of cortes) {
    for (let i = Math.round(desde * sampleRate); i < Math.round(hasta * sampleRate); i += 1) {
      muestras[i] = Math.sin((2 * Math.PI * 200 * i) / sampleRate) * 0.3
    }
  }
  return muestras
}

describe('detector de fronteras de audio (dueño único: tramoDeLocucion)', () => {
  it('devuelve la posición (en muestras) donde el segmentador cerró la voz', () => {
    const detector = crearDetectorDeFronteras({ sampleRate })
    const bloque = audio([[0.5, 2], [3.5, 5]])

    let primera = 0
    for (let i = 0; i < bloque.length; i += sampleRate / 2) {
      const marca = detector.push(bloque.subarray(i, Math.min(bloque.length, i + sampleRate / 2)))
      if (!primera && marca > 0) primera = marca
    }

    // La ULTIMA frontera es la que consume el ingress; la PRIMERA marca donde el audio
    // cerro la locucion abierta (el dato que separa dos locuciones).
    const frontera = primera
    expect(frontera, 'hay una frontera de audio').toBeGreaterThan(0)
    // La primera locución acaba antes del silencio: la frontera cae entre 2 s y 3,5 s.
    expect(frontera).toBeGreaterThan(Math.round(sampleRate * 2))
    expect(frontera).toBeLessThanOrEqual(Math.round(sampleRate * 3.5))
  })

  it('MUTACIÓN: sin voz no hay frontera (no se inventa silencio)', () => {
    const detector = crearDetectorDeFronteras({ sampleRate })
    detector.push(audio([]))
    expect(detector.frontera()).toBe(0)
    expect(hayFronteraDeAudio({ frontera: 0, consumida: 0, lineaAbierta: 'hola' })).toBe(false)
  })

  it('una frontera ya consumida no vuelve a partir la línea', () => {
    expect(hayFronteraDeAudio({ frontera: 900, consumida: 900, lineaAbierta: 'hola' })).toBe(false)
    expect(hayFronteraDeAudio({ frontera: 900, consumida: 100, lineaAbierta: 'hola', texto: 'magistrado Luis ya le puso' })).toBe(true);
    expect(hayFronteraDeAudio({ frontera: 900, consumida: 100, lineaAbierta: 'vamos a preparar la receta', texto: 'vamos a preparar la receta de pan' }), 'MISMA locucion: no hay frontera').toBe(false)
    expect(hayFronteraDeAudio({ frontera: 900, consumida: 100, lineaAbierta: '' })).toBe(false)
  })
})

describe('DEFECTO A — dos locuciones sin pausa = DOS filas (frontera de audio)', () => {
  it('con el tramo por evento la fila 5 se parte en dos (ids 1792789182623 / 1792789202635)', () => {
    const h = createHarness()
    h.inject(chromeEvent([{ isFinal: false, transcript: LOCUCION_1 }]))
    // El VAD cierra la primera locución: hay 1,2 s de silencio antes de la siguiente.
    h.fronteraRef.current = 192000
    // La linea lleva QUIETA el silencio del VAD (2 s): es la tercera evidencia.
    Object.assign(h.listenStateRef.current, { openLineLastTouchMs: 1 }) // la linea lleva quieta desde el inicio
    h.inject(chromeEvent([{ isFinal: false, transcript: LOCUCION_2 }]))
    h.end()

    expect(h.rows).toHaveLength(2)
    expect(h.rows[0]).toBe(LOCUCION_1)
    expect(h.rows[1]).toContain('magistrado Luis')
  })

  it('MUTACIÓN: con la linea ACTIVA (sin la quietud del VAD) las dos locuciones se pegan en UNA fila', () => {
    // La marca del VAD es CONTEXTO y no decide (`hayFronteraDeAudio`): la evidencia es la
    // QUIETUD de la linea + el texto ajeno. Se muta esa evidencia: la linea se toca con
    // cada interino (200 ms), asi que no hay silencio y NO hay frontera.
    const h = createHarness()
    h.inject(chromeEvent([{ isFinal: false, transcript: LOCUCION_1 }]))
    h.fronteraRef.current = 192000
    h.inject(chromeEvent([{ isFinal: false, transcript: LOCUCION_2 }]))
    h.end()

    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toContain(LOCUCION_1)
    expect(h.rows[0], 'el defecto A tal cual: dos locuciones en una fila').toContain('magistrado Luis')
  })

  it('una frontera DENTRO de la misma locución no la parte (el ASR sigue con el mismo dictado)', () => {
    const h = createHarness()
    h.inject(chromeEvent([{ isFinal: false, transcript: 'vamos a preparar la receta' }]))
    h.inject(chromeEvent([{ isFinal: false, transcript: 'vamos a preparar la receta de pan casero' }]))
    h.end()

    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toBe('vamos a preparar la receta de pan casero')
  })
})
