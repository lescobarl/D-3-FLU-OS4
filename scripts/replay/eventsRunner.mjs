/**
 * RUNNER del modo `events`: reinyecta los eventos CRUDOS de la grabacion por el
 * consumidor/ingress REAL y devuelve lo observado (filas, caja y marcas).
 *
 * Que NO hace:
 *  - no usa audio ni vectores (fases `audio`/`vectors`);
 *  - no escribe el golden: devuelve datos y el comparador decide;
 *  - no arregla el producto: si la caja se duplica, se REPORTA.
 *
 * Seam unico con la app: `syncConversationStream` -> `handleConversationStreamSync`
 * (la funcion REAL de produccion, con su gate `refreshNeeded && settlesTurn`).
 *
 * MARCAS DE CIERRE (declarado, no inventado a escondidas): una grabacion de `chrome-raw`
 * no trae `onend` ni los `sr-gap` que el producto dispara por silencio. El runner las
 * INFIERE de los timestamps con la MISMA regla del producto (`srGapCommitMs`): si entre
 * dos eventos de voz pasa ese tiempo, hubo SILENCIO y se dispara `sr-gap`; al terminar la
 * grabacion se dispara UN `recognition-end` (la sesion acabo). Todo va contado en
 * `observed.marks` (`inferred`) y se puede apagar con `inferMarks: false`.
 */

/** Tipos de evento que este runner sabe reinyectar. */
const SPEECH = 'chrome-raw'
const SR_GAP = 'sr-gap'
const RECOGNITION_END = 'recognition-end'
const RECOGNITION_ERROR = 'recognition-error'
const REBUILD = 'rebuild'

/**
 * Construye las dependencias del sync con el MISMO contrato que el hook (refs + callbacks),
 * capturando lo observable: filas del log, filas de sesion y la CAJA con su tiempo.
 * @param {object} app modulos reales ya importados
 * @param {{ now: () => number }} clock reloj virtual del replay
 * @returns {{ deps: object, bindings: object, observed: object, refs: object }}
 */
function buildHarness(app, clock) {
  const { createActiveListenState, handleConversationStreamSync, crearCajaDeLaFrase } = app
  const observed = {
    rows: [],
    sessionRows: [],
    /** Traza COMPLETA de la caja: una entrada por actualizacion, con tiempo y motivo. */
    boxTrace: [],
    /** Valor visible por compatibilidad (sin consecutivos repetidos). */
    box: [],
    /** Caja visible en el instante de cada commit (compatibilidad). */
    boxAtCommit: [],
    /** Instante de cada commit: permite al comparador recortar la ventana de la caja. */
    commits: [],
    speakers: [],
  }
  const refs = {
    conversationActiveRef: { current: true },
    publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() },
    openPreviewTurnRef: { current: false },
    logRowsTextRef: { current: [] },
    logRowSpeakersRef: { current: [] },
    activeTurnIdRef: { current: 0 },
    lastCommitAtRef: { current: 0 },
    lastOnresultAtRef: { current: 0 },
    lastEmittedTurnRef: { current: 0 },
    turnAudioStartSampleRef: { current: 0 },
    chunkTotalSamplesRef: { current: 0 },
    preflightScheduledForTurnRef: { current: true },
    srGapFiredForOpenLineRef: { current: true },
    processConversationFluQueryRef: { current: () => Promise.resolve() },
    lastEmittedTranscriptRef: { current: '' },
    sessionPrimarySpeakerRef: { current: '' },
    lastLoggedSpeakerRef: { current: '' },
    lastResolvedSpeakerRef: { current: '' },
    speakerClustersRef: { current: [] },
    lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null },
    lastLogLineTextRef: { current: '' },
    lastLogLineWasCommandRef: { current: false },
    lastRequestRef: { current: { text: '', at: 0 } },
  }

  // TRAZA DE CAJA: se anota CADA actualizacion, aunque el texto no cambie (una caja
  // congelada es un dato). `box` sigue existiendo sin consecutivos iguales (compat).
  const anotarCaja = (valor, reason = 'publish') => {
    const texto = String(valor || '')
    observed.boxTrace.push({ t: clock.now(), text: texto, reason })
    const previo = observed.box[observed.box.length - 1]
    if (texto !== previo) observed.box.push(texto)
  }
  const escribirCaja = (valor) => anotarCaja(valor, 'publish')

  const caja = crearCajaDeLaFrase({
    publishedLiveRef: refs.publishedLiveRef,
    cancelLiveTranscriptUpdate: () => {},
    scheduleLiveTranscriptUpdate: escribirCaja,
    setLiveTranscript: escribirCaja,
  })
  // El vaciado legitimo de la caja (cierre de turno) tambien es un cambio observable.
  const vaciarCajaObservada = (opciones = {}) => {
    caja.vaciarLaCaja(opciones)
    anotarCaja('', 'clear')
  }

  const emitConversationLog = (text, options = {}) => {
    const box = String(refs.publishedLiveRef.current || '')
    observed.rows.push({ text: String(text || ''), speaker: String(options?.speakerName || '') })
    observed.boxAtCommit.push(box)
    observed.commits.push({ t: clock.now(), rowIndex: observed.rows.length - 1, box })
    refs.logRowsTextRef.current = observed.rows.map((row) => row.text)
    refs.logRowSpeakersRef.current = observed.rows.map((row) => row.speaker)
    return true
  }
  const commitTurnToSessionRows = (text, speaker) => {
    observed.sessionRows.push({ text: String(text || ''), speaker: String(speaker || '') })
  }

  const deps = {
    ...refs,
    setLiveTranscript: escribirCaja,
    scheduleLiveTranscriptUpdate: escribirCaja,
    cajaDeLaFrase: { publicarEnLaCaja: caja.publicarEnLaCaja, vaciarLaCaja: vaciarCajaObservada },
    applyConversationSpeaker: () => {},
    flushPendingStreamLog: () => {},
    captureTurnAudio: () => {},
    emitConversationLog,
    commitTurnToSessionRows,
    createSpeakerAudioResolver: () => () => Promise.resolve({ speakerName: '' }),
    setSpeakerClusters: () => {},
    applyResolvedSpeaker: () => {},
    flushPcmAfterTurnCommit: () => {},
    registerParticipant: () => {},
    fluParticipantRef: { current: { onTurnCommitted: () => {} } },
  }

  const bindings = {
    conversationActiveRef: refs.conversationActiveRef,
    listenStateRef: refs.listenStateRef,
    publishedLiveRef: refs.publishedLiveRef,
    openPreviewTurnRef: refs.openPreviewTurnRef,
    logRowsTextRef: refs.logRowsTextRef,
    logRowSpeakersRef: refs.logRowSpeakersRef,
    lastEmittedTranscriptRef: refs.lastEmittedTranscriptRef,
    lastLoggedSpeakerRef: refs.lastLoggedSpeakerRef,
    lastStreamPreviewRef: { current: '' },
    lastCommitAtRef: refs.lastCommitAtRef,
    preflightScheduledForTurnRef: refs.preflightScheduledForTurnRef,
    debugHotPath: false,
    fluDebugHot: () => {},
    getIngressVoiceContext: () => ({}),
    tryDispatchConversationAction: () => false,
    flushTranscriptOnFinal: () => {},
    flushPcmAfterTurnCommit: () => {},
    maybeSwitchRecognitionLocale: () => {},
    commitTurnToSessionRows,
    syncConversationStream: (payload = {}) => handleConversationStreamSync(deps, payload),
    markAudioSegmentStart: () => {},
    touchMeaningfulIngress: () => {},
    scheduleIdentityPreflight: () => {},
    peekTurnBridgeText: () => '',
    stashTurnBridgeText: () => {},
    consumeTurnBridgeText: () => '',
    onTurnFinalized: () => {},
  }

  return { deps, bindings, observed, refs }
}

/**
 * CONGELACION de la caja: ventanas entre dos cambios REALES de texto donde el ASR siguio
 * activo y la caja no se movio.
 *
 * Criterio (declarado): dentro de la ventana cuenta como congelacion si
 *  (a) llego al menos un evento de voz con texto DISTINTO al que la caja mostraba
 *      (habia algo nuevo que nunca aparecio), o
 *  (b) hubo `minEventosActivos` eventos de voz o mas (el ASR repitio/murmuro y la caja
 *      se quedo igual: una repeticion con la caja congelada TAMBIEN es congelacion).
 * El silencio no cuenta en ningun sentido: una ventana sin eventos no es congelacion y el
 * SILENCIO FINAL de una ventana CON actividad tampoco (se mide hasta la ultima voz).
 *
 * @param {Array<{ t: number, text: string }>} boxTrace
 * @param {Array<{ t: number, text: string }>} speechEvents
 * @param {{ minEventosActivos?: number }} [options]
 * @returns {{ maxGapMs: number, from: string, to: string, at: number, motivo: string }}
 */
export function medirCongelacionCaja(boxTrace = [], speechEvents = [], { minEventosActivos = 2 } = {}) {
  const minimo = Math.max(1, Math.floor(Number(minEventosActivos) || 2))
  const traza = [...boxTrace].sort((a, b) => Number(a.t) - Number(b.t))
  const eventos = [...speechEvents].sort((a, b) => Number(a.t) - Number(b.t))
  let stall = { maxGapMs: 0, from: '', to: '', at: 0, motivo: '' }
  for (let i = 1; i < traza.length; i += 1) {
    const desde = Number(traza[i - 1].t)
    const hasta = Number(traza[i].t)
    const mostrado = String(traza[i - 1].text || '').trim().toLowerCase()
    const dentro = eventos.filter((entry) => entry.t > desde && entry.t < hasta)
    if (!dentro.length) continue
    const textoNuevo = dentro.some((entry) => String(entry.text || '').trim().toLowerCase() !== mostrado)
    const activoRepetido = dentro.length >= minimo
    if (!textoNuevo && !activoRepetido) continue
    // El SILENCIO FINAL de la ventana NO cuenta: se mide hasta la ULTIMA actividad de voz.
    // Una caja de un turno abierto no puede cambiar cuando nadie habla, y esa espera (en el
    // producto la acota `srGapCommitMs`) no es una caja congelada. Antes la ventana llegaba
    // hasta el siguiente cambio y el silencio entraba en la medida (d4c1c8f3: 18,6 s).
    const ultimaActividad = Number(dentro[dentro.length - 1].t)
    const hueco = Math.min(hasta, ultimaActividad) - desde
    if (hueco > stall.maxGapMs) {
      stall = {
        maxGapMs: hueco,
        from: String(traza[i - 1].text || '').slice(0, 80),
        to: String(traza[i].text || '').slice(0, 80),
        at: desde,
        motivo: textoNuevo ? 'texto-nuevo-ignorado' : 'asr-repetido-sin-cambio',
      }
    }
  }
  return stall
}

/**
 * Reinyecta una sesion en modo `events`.
 * @param {{ session: object, clock: object, inferMarks?: boolean, srGapCommitMs?: number }} options
 * @returns {Promise<object>} observado
 */
export async function runEventsSession({ session, clock, inferMarks = true, srGapCommitMs = 0 }) {
  // Imports SECUENCIALES: el module-runner de vite-node se traba con imports dinamicos
  // concurrentes de grafos grandes (el proceso moria en silencio al reinyectar).
  // Sin preflight/worker: en `events` no se usa la identidad por voz.
  const commitModule = await import('../../src/voice/lib/conversationStreamCommit.js')
  const bridge = await import('../../src/voice/lib/conversationIngressBridge.js')
  const producer = await import('../../src/voice/lib/micEventProducer.js')
  const activeListen = await import('../../src/voice/lib/activeListen.js')
  const transcriptPause = await import('../../src/voice/lib/fluTranscriptPause.js')
  // RUIDO DE CONSOLA (declarado): el Productor imprime CADA fragmento STT en DEV. En el
  // replay no hay panel que lo muestre y tapa el reporte (618 lineas en una sesion de
  // 2 minutos). `debug.micIngressConsole` es un flag de DEBUG de la config, no un umbral
  // de dominio: se apaga SOLO en este proceso y no cambia nada de lo que se mide.
  const config = await import('../../src/voice/lib/fluConfig.js')
  if (config.FLU_CONFIG?.debug) config.FLU_CONFIG.debug.micIngressConsole = false

  const app = {
    handleConversationStreamSync: commitModule.handleConversationStreamSync,
    crearCajaDeLaFrase: commitModule.crearCajaDeLaFrase,
    createActiveListenState: activeListen.createActiveListenState,
  }
  const { observed, bindings } = buildHarness(app, clock)
  const runtime = bridge.createConversationIngressRuntime({ getBindings: () => bindings })
  const { buildMicBurstEvent } = producer

  const applied = { speech: 0, srGap: 0, end: 0, error: 0, rebuild: 0, ignored: 0 }
  const marks = { recorded: 0, inferred: 0, srGapInferred: 0, endInferred: 0 }
  const errors = []
  globalThis.__replayTimerError = (error) => errors.push(String(error?.message || error))

  const speech = session.events.filter((row) => String(row?.event || '') === SPEECH)
  // Umbral del silencio: el MISMO que usa el producto y UNA sola lectura (config).
  const gapMs =
    Number(srGapCommitMs) > 0
      ? Number(srGapCommitMs)
      : Number(transcriptPause.getTranscriptPauseCfg?.()?.srGapCommitMs) || 0
  let previousSpeechAt = null

  const HANDLED = new Set([SPEECH, SR_GAP, RECOGNITION_END, RECOGNITION_ERROR, REBUILD])
  for (const row of session.events) {
    const kind = String(row?.event || '')
    // Los eventos que no son de VOZ/marca no mueven el reloj: la grabacion puede
    // seguir escribiendo logs durante horas y eso no es tiempo del dictado.
    if (!HANDLED.has(kind)) {
      applied.ignored += 1
      continue
    }
    const t = Number(row?.t)
    const data = row?.data || {}
    try {
      // SILENCIO grabado como hueco: si entre dos eventos de voz pasa `srGapCommitMs`, el
      // producto habria disparado su cierre por silencio. Se infiere ANTES de mover el
      // reloj al evento: el cierre del producto ocurre a `ultimaVoz + srGapCommitMs`, que
      // es ANTERIOR a este evento (con el reloj ya en `t`, el silencio no corria y la caja
      // de un turno abierto parecia congelada 18,6 s; medido en d4c1c8f3).
      if (kind === SPEECH && inferMarks && previousSpeechAt != null && Number.isFinite(t)) {
        const hueco = t - previousSpeechAt
        const silencio = gapMs > 0 ? hueco >= gapMs : transcriptPause.srGapSilenceReached(hueco)
        if (hueco > 0 && silencio) {
          if (gapMs > 0) clock.advanceTo(previousSpeechAt + gapMs)
          runtime.pushSrGapEvent({ sinceLastResultMs: hueco })
          applied.srGap += 1
          marks.inferred += 1
          marks.srGapInferred += 1
          runtime.drainAll()
          clock.runDue()
        }
      }
      if (Number.isFinite(t)) clock.advanceTo(t)
      if (kind === SPEECH) {
        const burst = buildMicBurstEvent(
          String(data?.kind || '') === 'final' ? { final: data?.text } : { interim: data?.text },
        )
        if (burst) {
          runtime.pushMicRecognitionEvent(burst)
          applied.speech += 1
          if (Number.isFinite(t)) previousSpeechAt = t
        } else {
          applied.ignored += 1
        }
      } else if (kind === SR_GAP) {
        runtime.pushSrGapEvent({ sinceLastResultMs: Number(data?.sinceLastResultMs) || 0 })
        applied.srGap += 1
        marks.recorded += 1
      } else if (kind === RECOGNITION_END) {
        runtime.pushRecognitionEndEvent({ immediate: true })
        applied.end += 1
        marks.recorded += 1
      } else if (kind === RECOGNITION_ERROR || kind === REBUILD) {
        // Solo se dispara si la grabacion lo trae; el runner no fabrica fallos del motor.
        bindings.handleRecordedRecognitionFault?.(kind, data)
        applied[kind === REBUILD ? 'rebuild' : 'error'] += 1
        marks.recorded += 1
      } else {
        applied.ignored += 1
      }
      runtime.drainAll()
      clock.runDue()
    } catch (error) {
      errors.push(`${kind}: ${error?.message || error}`)
    }
  }

  // CIERRE DEL FINAL DE LA GRABACION: la sesion termino. Sin esto, la ultima locucion se
  // queda en la caja y su fila depende de la casualidad (declarado y contado).
  if (inferMarks && speech.length) {
    const lastAt = Number(speech[speech.length - 1]?.t)
    if (Number.isFinite(lastAt)) clock.advanceTo(lastAt)
    try {
      runtime.pushRecognitionEndEvent({ immediate: true })
      applied.end += 1
      marks.inferred += 1
      marks.endInferred += 1
      runtime.drainAll()
      clock.runDue()
    } catch (error) {
      errors.push(`end-inferido: ${error?.message || error}`)
    }
  }

  const speakers = []
  for (const row of observed.rows) {
    const last = speakers[speakers.length - 1]
    if (last !== row.speaker) speakers.push(row.speaker)
  }
  observed.speakers = speakers
  observed.applied = applied
  // Eventos de voz con su TEXTO: entrada del criterio de congelacion.
  const speechEvents = speech
    .map((row) => ({ t: Number(row?.t), text: String(row?.data?.text || '') }))
    .filter((entry) => Number.isFinite(entry.t))
    .sort((a, b) => a.t - b.t)
  // CONGELACION de la caja: un solo criterio (`medirCongelacionCaja`).
  observed.boxStall = medirCongelacionCaja(observed.boxTrace, speechEvents)

  // Config EFECTIVA del producto: los topes del comparador salen de aqui, no de un
  // numero escrito en el runner.
  observed.config = { srGapCommitMs: Number(transcriptPause.getTranscriptPauseCfg?.()?.srGapCommitMs) || 0 }
  observed.marks = marks
  observed.errors = errors
  observed.window = {
    firstAt: Number(session.events[0]?.t) || 0,
    lastAt: Number(session.events[session.events.length - 1]?.t) || 0,
    speech: speech.length,
  }
  delete globalThis.__replayTimerError
  return observed
}
