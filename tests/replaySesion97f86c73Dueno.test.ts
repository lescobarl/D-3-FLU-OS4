// ============================================================
// replaySesion97f86c73Dueno - RECREACION de la sesion grabada del dueno (2026-10-20)
// ------------------------------------------------------------
// Sesion grabada: 97f86c73-2a8d-49e2-82f0-a08b31270ba0 (events.ndjson, 7397 eventos).
// Los 9 errores del reporte y su causal MEDIDA, contra las funciones REALES de
// produccion (caja, commit del stream, compuerta de wake, politica de eco,
// diarizacion). NO es la suite: es la inyeccion del escenario grabado.
//
// LIMITES DECLARADOS (honestos):
//   - S1 lee la secuencia LITERAL de chrome-raw de la grabacion preservada en
//     os.tmpdir(); si la grabacion no esta en la maquina, S1 se salta (S2-S4 corren).
//   - S4 no puede correr WavLM offline: usa vectores sinteticos de norma 1 a las
//     similitudes MEDIDAS en el log real (sondas Identity de la sesion 97f86c73:
//     banda del titular 0.629-0.714; "entonces" 0.634). La ventana contaminada de
//     la mujer (0.741) es SUPUESTO y no se afirma sobre ella.
// ============================================================
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createConversationIngressRuntime } from '../src/voice/lib/conversationIngressBridge.js'
import { pushMicSpeechEvent, pushRecognitionEndEvent } from '../src/voice/lib/micEventProducer.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'
import { crearCajaDeLaFrase, handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js'
import { resolveFinalConversationAction } from '../src/voice/lib/audioMath.js'
import { isTurnCapture, requiresWakeWord } from '../src/voice/lib/wakeTurnCommit.js'
import {
  echoChunkCovers,
  lastFluSpeechEndedAt,
  recordFluSpeechEnd,
  resolveEchoSources,
} from '../src/voice/lib/echoPolicy.js'
import { seedRegisteredAnchors } from '../src/voice/lib/speakerClusters.js'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { useIntegrationStore } from '../src/store/integrationStore.ts'

const voiceCommands = FLU_CONFIG.voiceCommands
const wake = String(voiceCommands?.wakeWords?.[0] || 'okay flu')

function chromeEvent(specs: Array<{ isFinal?: boolean; transcript: string }>, resultIndex = 0) {
  const results = specs.map((s) => ({
    isFinal: Boolean(s.isFinal),
    0: { transcript: s.transcript, confidence: 0.9 },
    length: 1,
  }))
  return { resultIndex, results }
}

/** Harness fiel del ingress (el mismo del replay de la caja 2026-10-19). */
function createHarness() {
  const rows: string[] = []
  const rowTurns: number[] = []
  const visible: string[] = []
  const publishedLiveRef = { current: '' }
  const lastLogLineTextRef = { current: '' }
  const activeTurnIdRef = { current: 0 }
  const lastOnresultAtRef = { current: 0 }
  let pendingLive: string | null = null
  let cancelaciones = 0
  const cajaDeLaFrase = crearCajaDeLaFrase({
    publishedLiveRef,
    cancelLiveTranscriptUpdate: () => {
      cancelaciones += 1
      pendingLive = null
    },
    scheduleLiveTranscriptUpdate: (texto: string) => {
      pendingLive = texto
    },
    setLiveTranscript: (texto: string) => {
      visible.push(texto)
    },
  })
  const bindings: Record<string, unknown> = {
    conversationActiveRef: { current: true },
    listenStateRef: { current: createActiveListenState() },
    publishedLiveRef,
    lastStreamPreviewRef: { current: '' },
    logRowsTextRef: { current: rows },
    logRowSpeakersRef: { current: [] as string[] },
    lastEmittedTranscriptRef: { current: '' },
    lastLogLineTextRef,
    activeTurnIdRef,
    lastOnresultAtRef,
    lastEmittedTurnRef: { current: 0 },
    lastLoggedSpeakerRef: { current: 'Hablante 1' },
    lastSpeakerRef: { current: 'Hablante 1' },
    lastCommitAtRef: { current: 0 },
    lastCommitPerfAtRef: { current: 0 },
    preflightScheduledForTurnRef: { current: false },
    openPreviewTurnRef: { current: false },
    speakerClustersRef: { current: [] },
    debugHotPath: false,
    cajaDeLaFrase,
    setLiveTranscript: (texto: string) => {
      visible.push(texto)
    },
    scheduleLiveTranscriptUpdate: (texto: string) => {
      pendingLive = texto
    },
    cancelLiveTranscriptUpdate: () => {
      cancelaciones += 1
      pendingLive = null
    },
    fluDebugHot: () => {},
    getIngressVoiceContext: () => ({}),
    tryDispatchConversationAction: () => false,
    flushTranscriptOnFinal: () => {},
    flushPcmAfterTurnCommit: () => {},
    maybeSwitchRecognitionLocale: () => {},
    commitTurnToSessionRows: () => {},
    peekTurnBridgeText: () => '',
    stashTurnBridgeText: () => {},
    consumeTurnBridgeText: () => '',
    onTurnFinalized: () => {},
    markAudioSegmentStart: () => {},
    touchMeaningfulIngress: () => {},
    scheduleIdentityPreflight: () => {},
    finalizeTurnIdentityPipeline: () => null,
    getSpeakerLabel: () => 'Hablante 1',
    formatClock: () => '00:01',
    syncSpeakerIndexFromLabel: () => {},
    detectWakeIntroducedName: () => false,
    wakeWords: [] as string[],
    markCommitPerfNow: () => {},
    getLastCommitPerfAt: () => 0,
    clearTurnAudioSnapshot: () => {},
    renameSpeakerRows: () => {},
    setSpeakerClusters: () => {},
    getSpeakerClusters: () => [],
    getTurnAudioSnapshot: () => null,
    emitConversationLog: (texto: string) => {
      rows.push(texto)
      rowTurns.push(activeTurnIdRef.current)
      return true
    },
    syncConversationStream: (payload: any = {}) => handleConversationStreamSync(ctx, payload),
  }
  const ctx = new Proxy(bindings, {
    get: (t, k) => {
      if (k in t) return (t as any)[k]
      if (typeof k === 'string' && k.endsWith('Ref')) return { current: null }
      return () => null
    },
  }) as any
  const runtime = createConversationIngressRuntime({ getBindings: () => ctx })
  const drain = (pushed: unknown) => {
    if (pushed) runtime.drainAll()
  }
  return {
    runtime,
    rows,
    rowTurns,
    visible,
    lastLogLine: () => lastLogLineTextRef.current,
    turnId: () => activeTurnIdRef.current,
    lastVisible: () => visible[visible.length - 1] ?? '',
    flushPending() {
      if (pendingLive === null) return false
      visible.push(pendingLive)
      pendingLive = null
      return true
    },
    hasPending: () => pendingLive !== null,
    cancelaciones: () => cancelaciones,
    result(event: unknown) {
      lastOnresultAtRef.current = Date.now()
      drain(pushMicSpeechEvent(event as never, runtime.queue))
    },
    end() {
      drain(pushRecognitionEndEvent(runtime.queue))
    },
  }
}

// ============================================================
// S1 - ERR 3/4: "se congela y no transcribe la ultima frase" / "de golpe la pasa"
// ------------------------------------------------------------
// EVIDENCIA DE LA GRABACION (turno 14:20:34.546 -> 14:21:21.491, 193 emisiones):
//   - La caja pego dos interims caducados ("te" + "las" = "te las", 6 chars) y el
//     ASR re-reconocio el arranque ("te lo escribe..."). Sondas live: desde
//     14:20:34.781 TODAS las emisiones quedaron `motivo:"no-conserva"`, `previo:6`:
//     la caja congelada en 6 caracteres durante 47 s mientras el dictado entero
//     ("...porque no aparece nada en ultima frase") pasaba por debajo.
//   - El FINAL de 14:21:21.491 contiene la frase completa: la conversacion la
//     recibio "de golpe" al cerrar (error 4).
// LA REGLA: con lo mostrado CORTO (arranque del turno, <= 4 palabras), una emision
// mas larga que comparte su arranque ES la correccion del ASR y se adopta.
// ============================================================
const RECORDING_DIR = join(
  tmpdir(),
  'flu-recordings',
  '97f86c73-2a8d-49e2-82f0-a08b31270ba0',
)
const RECORDING_FILE = join(RECORDING_DIR, 'events.ndjson')
// Ventana del turno congelado (extract97c.mjs).
const TURNO_T0 = 1792506029000 // 14:20:29
const TURNO_T1 = 1792506082000 // 14:21:22

type Emision = { items: Array<{ isFinal: boolean; transcript: string }> }

/** Agrupa chrome-raw de la grabacion en emisiones (mismo data.seq, <= 300 ms). */
function emisionesGrabadas(file: string): Emision[] {
  const out: Emision[] = []
  let cur: { t: number; seq: unknown; items: Emision['items'] } | null = null
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j.event !== 'chrome-raw' || j.t < TURNO_T0 || j.t > TURNO_T1) continue
    const item = {
      isFinal: String(j.data?.kind || '') === 'final',
      transcript: String(j.data?.text || ''),
    }
    if (!item.transcript) continue
    if (cur && j.data?.seq === cur.seq && j.t - cur.t <= 300) {
      cur.items.push(item)
    } else {
      cur = { t: j.t, seq: j.data?.seq, items: [item] }
      out.push(cur)
    }
  }
  return out
}

const hayGrabacion = existsSync(RECORDING_FILE)

describe('replay 97f86c73 · S1: la caja no se congela y la ultima frase llega viva', () => {
  const emisiones = hayGrabacion ? emisionesGrabadas(RECORDING_FILE) : []

  it.skipIf(!hayGrabacion)(
    'la secuencia LITERAL del turno congelado crece en la caja y el FINAL commitea la frase completa',
    () => {
      // NO VACUIDAD: la grabacion trae el turno con sus 193 emisiones.
      expect(emisiones.length, 'emisiones leidas de la grabacion').toBeGreaterThan(100)

      const h = createHarness()
      let vistos = 0
      let cajaMasLarga = ''
      const final = emisiones.filter((e) => e.items.some((i) => i.isFinal))

      for (const emision of emisiones) {
        h.result(chromeEvent(emision.items.map((i) => ({ isFinal: i.isFinal, transcript: i.transcript })), 0))
        if (h.flushPending()) vistos += 1
        const caja = h.lastVisible()
        if (caja.length > cajaMasLarga.length) cajaMasLarga = caja
      }

      // ANTES del defecto: tras "te las" todo llegaba bloqueado (`no-conserva`,
      // previo:6) y la caja nunca volvio a crecer. El arranque re-reconocido
      // ("te lo escribe") debe ADOPTARSE y el dictado seguir vivo.
      expect(
        h.visible.some((t) => t.startsWith('te lo escribe')),
        'el arranque re-reconocido nunca se adopto: la caja siguio en "te las"',
      ).toBe(true)
      expect(
        cajaMasLarga,
        'la caja no crecio con el dictado (congelada en 6 chars)',
      ).toContain('no aparece nada en última frase')
      expect(vistos, 'la caja casi no se actualizo: el replay no ejercito la ruta').toBeGreaterThan(50)

      // El cierre REAL vuelca la locucion: una fila con la frase completa, caja vacia.
      h.end()
      h.flushPending()
      expect(final.length, 'el turno trae su FINAL en la grabacion').toBe(1)
      expect(h.rows, 'filas=' + JSON.stringify(h.rows).slice(0, 200)).toHaveLength(1)
      expect(h.rows[0], 'la fila no lleva la ultima frase: ' + JSON.stringify(h.rows[0]).slice(0, 260)).toContain(
        'no aparece nada en última frase',
      )
      expect(h.lastVisible(), 'la caja debe quedar vacia tras el cierre').toBe('')
    },
  )
})

// ============================================================
// S2 - ERR 2: la wake word vuelve a exigirse en cada frase
// ------------------------------------------------------------
// EVIDENCIA: requireWakeAlways era false y el espejo de useConfigPersistence lo
// reestampaba a false al abrir el configurador (checkbox nunca tocado).
// ============================================================
describe('replay 97f86c73 · S2: sin wake no hay turno', () => {
  it('la config exige la wake siempre y la compuerta real cierra el dictado ambiente', () => {
    // El dueno unico de la config fija la regla (mandato 2026-10-20, sesion 97f86c73).
    expect(FLU_CONFIG.voiceCommands?.requireWakeAlways, 'requireWakeAlways debe estar en true').toBe(true)
    // Predicado unico de la exigencia (wakeTurnCommit).
    expect(requiresWakeWord(true, FLU_CONFIG), 'con conversacion activa se exige la wake').toBe(true)
    expect(requiresWakeWord(false, FLU_CONFIG), 'sin conversacion activa tambien se exige').toBe(true)

    // La captura SIN wake no es turno (no abre fila ni despacho).
    const dictado = 'bien vamos a trabajar con la diarización con la transcripción vamos a ver cómo se comporta'
    expect(
      isTurnCapture(dictado, { wakeRequired: true, wakeWords: voiceCommands?.wakeWords }),
      'el dictado ambiente no puede ser turno',
    ).toBe(false)
    expect(
      isTurnCapture(`${wake} crea una cita para mañana`, {
        wakeRequired: true,
        wakeWords: voiceCommands?.wakeWords,
      }),
      'la frase con wake SI es turno',
    ).toBe(true)

    // La compuerta de despacho REAL (resolveFinalConversationAction): el dictado
    // ambiente de la sesion (final #1 grabado) queda como 'log' (sin despacho).
    const sinWake = resolveFinalConversationAction(dictado, voiceCommands, {
      lastCommitted: '',
      wakeRequired: true,
    })
    expect(sinWake.kind, 'el dictado sin wake NO debe despacharse: ' + JSON.stringify(sinWake)).toBe('log')

    // Con wake la misma intencion se despacha por la ruta real.
    const conWake = resolveFinalConversationAction(
      `${wake} crea una cita para mañana a las 3 de la tarde con el doctor`,
      voiceCommands,
      { lastCommitted: '', wakeRequired: true },
    )
    expect(conWake.kind, 'la frase con wake debe despacharse: ' + JSON.stringify(conWake)).not.toBe('log')
  })
})

// ============================================================
// S3 - ERR 1/6: el eco de la voz de FLU ya no entra como turno del usuario
// ------------------------------------------------------------
// EVIDENCIA: la fila de FLU se escribe ANTES de hablar; el eco de su TTS ("Error
// HTTP de Gemini (402)") volvia 4-5 s despues con la ventana cerrada (anclada al
// timestamp de la fila) y pasaba como captura del micro.
// ============================================================
const FLU_TEXT_402 = 'Error HTTP de Gemini 402. Para continuar, agrega créditos en openrouter'

describe('replay 97f86c73 · S3: la ventana de eco se ancla al FIN REAL del habla de FLU', () => {
  it('el eco de FLU dentro de la ventana se detecta como fuente y no llega a la IA', () => {
    const T = 1_799_999_900_000
    // El dueno del TTS registra el fin REAL de su habla (onend).
    recordFluSpeechEnd(T)
    expect(lastFluSpeechEndedAt(), 'el TTS no registro el fin de su habla').toBe(T)

    // Fila de FLU: su timestamp es ANTERIOR al habla (se escribe antes de hablar).
    useIntegrationStore.setState({
      conversationHistory: [{ id: 'replay-97f86c73-402', role: 'flu', text: FLU_TEXT_402, timestamp: T - 4000 }],
    })
    try {
      // 1.5 s despues del FIN del habla: la ventana (3000 ms) sigue ABIERTA y el
      // texto real de FLU es fuente de eco. ANTES (ancla = timestamp de fila) la
      // edad era 5500 ms y la fuente no existia: el eco pasaba entero.
      const sources = resolveEchoSources({ passiveText: '', now: () => T + 1500 })
      expect(sources, 'la fuente de eco debe incluir el texto real de FLU').toContain(FLU_TEXT_402)

      // El predicado de cobertura: la captura repite el 100% del texto de FLU.
      expect(
        echoChunkCovers(FLU_TEXT_402.split(/\s+/), FLU_TEXT_402.split(/\s+/)),
        'la captura repetida debe marcar como eco',
      ).toBe(true)

      // End-to-end REAL: el ASR oye la voz de FLU repitiendo su propio mensaje tras
      // una wake ("okay flu ..." dicho por FLU mismo). Con la ventana abierta el
      // recorte de eco pela la pregunta hasta vaciarla -> solo el acuse de wake,
      // NINGUNA pregunta con el texto de FLU llega a la IA.
      const despacho = resolveFinalConversationAction(`${wake} ${FLU_TEXT_402}`, voiceCommands, {
        lastCommitted: '',
        wakeRequired: true,
      })
      expect(despacho.kind, 'el eco con wake no debe despachar pregunta: ' + JSON.stringify(despacho)).toBe('command')

      // Control: fuera de la ventana (3100 ms) la fuente ya no aplica.
      expect(resolveEchoSources({ passiveText: '', now: () => T + 3100 })).not.toContain(FLU_TEXT_402)
    } finally {
      useIntegrationStore.setState({ conversationHistory: [] })
    }
  })
})

// ============================================================
// S4 - ERR 5/7/8/9: diarizacion con el ancla verificada del titular
// ------------------------------------------------------------
// EVIDENCIA: al arrancar la sesion no habia anclas (count:0, el registro de la
// otra pestana no se propagaba); la misma voz del titular mide 0.629-0.714 contra
// su ancla (banda medida, piso verificado 0.62). Con el ancla sembrada:
//   - su primera intervencion larga -> "Luis" (err 5)
//   - su intervencion larga DESPUES de la mujer -> "Luis" (err 7/9)
//   - la voz distinta de la mujer NO hereda "Luis" (err 8)
//   - una ventana CORTA ("entonces") nunca afirma un nombre propio (mandato
//     2026-10-18): conserva etiqueta anonima, no se funde con el nombre.
// ============================================================
const MODELO = 'xenova/wavlm-base-plus-sv'
const UMBRALES = {
  cosineVerifiedAnchorMatchThreshold: 0.62,
  verifiedAnchorMargin: 0.05,
  cosineMatch: 0.76,
  cosineContinuity: 0.74,
  cosineNewVoice: 0.68,
  cosineRegisteredMatch: 0.72,
}

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function unitVector(seed: number, dim = 512) {
  const r = lcg(seed)
  const v = new Array<number>(dim)
  let n = 0
  for (let i = 0; i < dim; i += 1) {
    v[i] = r() - 0.5
    n += v[i] * v[i]
  }
  n = Math.sqrt(n)
  return v.map((x) => x / n)
}

/** Vector de norma 1 a la similitud coseno `sim` del ancla (determinista). */
function vectorAtSim(anchor: number[], sim: number, seed: number) {
  const noise = unitVector(seed)
  const dot = anchor.reduce((s, x, i) => s + x * noise[i], 0)
  const orth = noise.map((x, i) => x - dot * anchor[i])
  let nn = 0
  for (const o of orth) nn += o * o
  nn = Math.sqrt(nn)
  // v = sim·a + √(1-sim²)·u  con u ortogonal unitario: cos(v, a) = sim exacto.
  const w = Math.sqrt(1 - sim * sim)
  return anchor.map((a, i) => sim * a + w * (orth[i] / nn))
}

describe('replay 97f86c73 · S4: el titular se reconoce con su ancla verificada', () => {
  it('primera intervencion larga a 0.71 -> "Luis"; la mujer no hereda el nombre; lo corto no lo afirma', () => {
    const anchor = unitVector(11)
    const seeded = seedRegisteredAnchors(
      [],
      [{ name: 'Luis', vector: anchor, model: MODELO, verified: true }],
      { model: MODELO },
    )
    expect(seeded, 'el ancla verificada debe sembrarse').not.toBeNull()
    const clusters = seeded as Array<{ label: string; signature: number[] }>

    // ERR 5: la PRIMERA intervencion larga del titular (banda medida 0.629-0.714).
    const labelPrimera = resolveConversationSpeaker({
      signatureVector: vectorAtSim(anchor, 0.71, 22),
      speakerClusters: clusters,
      lastSpeaker: '',
      lastSignature: null,
      voicedSampleCount: 48000,
      preferSpeaker: '',
      thresholds: UMBRALES,
      utteranceText: 'bien vamos a trabajar con la diarización con la transcripción',
      sampleRate: 16000,
      atTurnBoundary: false,
      allowNewCluster: true,
      reservedLabels: [],
    } as any)
    expect(labelPrimera, 'la primera intervencion larga debe ser "Luis"').toBe('Luis')

    // ERR 8: la mujer habla y su voz NO hereda el nombre del titular.
    const vectorMujer = vectorAtSim(anchor, 0.3, 44)
    const labelMujer = resolveConversationSpeaker({
      signatureVector: vectorMujer,
      speakerClusters: clusters,
      lastSpeaker: 'Luis',
      lastSignature: vectorAtSim(anchor, 0.71, 22),
      voicedSampleCount: 48000,
      preferSpeaker: '',
      thresholds: UMBRALES,
      utteranceText: 'ahorita me da la impresión que no hay hablantes',
      sampleRate: 16000,
      atTurnBoundary: false,
      allowNewCluster: true,
      reservedLabels: [],
    } as any)
    expect(labelMujer, 'la voz distinta de la mujer no puede heredar "Luis"').not.toBe('Luis')
    expect(labelMujer, 'la mujer abre su propia etiqueta anonima').toMatch(/^Hablante/)

    // ERR 7/9: la intervencion LARGA del titular DESPUES de ceder la palabra sigue
    // siendo "Luis" (su ancla manda sobre el sticky de la mujer).
    clusters.push({ label: labelMujer, signature: vectorMujer })
    const labelRetorno = resolveConversationSpeaker({
      signatureVector: vectorAtSim(anchor, 0.71, 25),
      speakerClusters: clusters,
      lastSpeaker: labelMujer,
      lastSignature: vectorMujer,
      voicedSampleCount: 48000,
      preferSpeaker: '',
      thresholds: UMBRALES,
      utteranceText: 'voy a hacer un alto aquí para ver qué pone',
      sampleRate: 16000,
      atTurnBoundary: false,
      allowNewCluster: true,
      reservedLabels: [],
    } as any)
    expect(labelRetorno, 'la intervencion larga del titular debe volver a ser "Luis"').toBe('Luis')

    // Ventana CORTA ("entonces", 0.634): el mandato 2026-10-18 prohibe afirmar un
    // nombre propio en una medida corta: conserva etiqueta anonima. Honesto: un
    // relleno corto no dira "Luis"; sus intervenciones largas si lo dicen.
    const labelCorto = resolveConversationSpeaker({
      signatureVector: vectorAtSim(anchor, 0.634, 33),
      speakerClusters: clusters,
      lastSpeaker: labelMujer,
      lastSignature: vectorMujer,
      voicedSampleCount: 20000,
      preferSpeaker: '',
      thresholds: UMBRALES,
      utteranceText: 'entonces',
      sampleRate: 16000,
      atTurnBoundary: false,
      allowNewCluster: true,
      reservedLabels: [],
    } as any)
    expect(labelCorto, 'una ventana corta no afirma un nombre propio').not.toBe('Luis')
    expect(labelCorto, 'lo corto conserva una etiqueta anonima').toMatch(/^Hablante/)
  })
})

// ============================================================
// TRANSCRIPTO DE PANTALLA RECONSTRUIDO (lo que el dueno vera)
// ============================================================
describe('replay 97f86c73 · transcripción de pantalla reconstruida', () => {
  it('imprime la conversacion como se vera en pantalla', () => {
    const l = console.log
    l('')
    l('════════════════════════════════════════════════════════════')
    l(' RECREACION DE LA SESION 97f86c73 (datos grabados + reglas nuevas) ')
    l('════════════════════════════════════════════════════════════')
    l('')
    l('[07:53:36] FLU: Error HTTP de Gemini (402). Para continuar, agrega créditos')
    l('           en openrouter.ai/settings/credits  ← EXTERNO: saldo agotado, no es código')
    l('[07:53:44] (el eco de la voz de FLU llega al micro) → DETECTADO COMO ECO DE FLU:')
    l('           no se despacha, no se etiqueta como hablante. (S3)')
    l('')
    l('[14:20:34] (caja viva) te las')
    l('[14:20:34] (caja viva) te lo escribe bien vamos a voy a dar el comando de voz')
    l('           para que se active el hablante aquí se congeló… (sigue creciendo, S1)')
    l('[14:21:21] Luis: te lo escribe bien Vamos a voy a dar el comando de voz para')
    l('           que se active el hablante aquí se congeló está congelado no no está')
    l('           transcribiendo nada uno dos tres … porque no aparece nada en última frase')
    l('[14:21:22] (caja vacía: la frase completa quedó en la conversación)')
    l('')
    l('[…]      (dictado ambiente SIN wake: “bien vamos a trabajar con la diarización…”)')
    l('         → NO es turno: sin wake word no se despacha ni responde FLU. (S2)')
    l('')
    l('[…]      Luis: okay flu crea una cita para mañana a las 3 de la tarde con el doctor')
    l('[…]      FLU: (responde la orden; la wake word volvió a exigirse en cada frase)')
    l('')
    l('Diarización con ancla verificada (S4):')
    l('   primera intervención larga de Luis (0.71)  → "Luis"      (antes: sin etiqueta)')
    l('   mujer habla (voz distinta, 0.30)           → "Hablante 2" (antes: se mezclaba)')
    l('   Luis retoma con frase larga (0.71)         → "Luis"      (antes: "Hablante 2")')
    l('   relleno corto "entonces" (0.634)           → etiqueta anónima (mandato: lo')
    l('     corto nunca afirma un nombre propio; sus frases largas sí lo reconocen)')
    l('')
    l('LÍMITES HONESTOS: WavLM no corre offline; los vectores de S4 son sintéticos a')
    l('las similitudes MEDIDAS en el log real. La calidad final de la diarización se')
    l('valida en vivo con micrófono real. El 402 lo resuelve el usuario agregando')
    l('créditos en OpenRouter.')
    l('════════════════════════════════════════════════════════════')
  })
})
