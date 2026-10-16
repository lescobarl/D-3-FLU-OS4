/**
 * Preview y commit del stream de conversación (mic → UI/log).
 * Extraído de useFluVoiceAssistant para aislar la ruta syncConversationStream.
 */
import { cleanForSpeech, detectWakeIntroducedName, formatClock, sameRequestWindowMs, stripDiacritics } from './audioMath.js'
import { normalizeMicText } from './speechMerge.js'
import { resolveInlineWakeAtCommit, isTurnCapture, requiresWakeWord } from './wakeTurnCommit.js'
import { getAsrSegmentationCfg } from './fluTranscriptMotor.js'
import { FLU_CONFIG } from './fluConfig.js'
import {
  resolveMicCommitAction,
  isDuplicateTurnCommit,
  isFragmentOfLocution,
  reconcileCommitText,
} from './turnStream.js'
import {
  advancePublishedDisplay,
  detectNextSpeakerPhrase,
  getSpeakerLabel,
  readSession,
  shouldRefreshStream,
  syncSpeakerIndexFromLabel,
  utterancesSameRevision,
  committedEchoStreakWindowMs,
} from './activeListen.js'
import { debugHotPath, fluDebugHot } from './fluDebug.js'
import { relayLog } from '../../lib/clientLogRelay'
import { voiceProbe } from './voiceProbe'
import { finalizeTurnIdentityPipeline } from './turnIdentityPipeline.js'
import { planAsrTurnSegments, segmentPlanCoversCapture } from './asrTurnSegmentation.js'
import { resolveTurnSpeakerAtCommit, applyResolvedSpeakerToSessionRefs } from './turnSpeakerCommit.js'
import {
  anchorResolvedToLastLogged,
  blindSpeakerFallback,
  resolveCommitStickyFallback,
  isWeakAsrSpeakerEvidence,
} from './speakerPolicy.js'
import { markCommitPerfNow } from './audioSegmentClock.js'
import { labelToSpeakerId } from './conversationRow.js'
import { renameSpeakerRows } from './conversationTurnRow'

import { preflightEvidenceMeasured } from './turnSpeakerPreflight.js'
import { normalizeSpeakerLabel, isAutoSpeakerLabel } from './voiceIdentity.js'
import { isSameEmissionWithinWindow } from './captureDedup.js'
import { DISCARD_REASONS, discardLocution } from './phraseDiscard.js'

/**
 * Fabrica UNICA de la instantanea FINAL de hablante del turno. La usan los DOS pasos
 * del cierre: la espera acotada antes del commit (`primeTurnSpeakerPreflight`) y el
 * propio commit (via `finalizeTurnIdentityPipeline`). Un solo dueño de los argumentos
 * del resolver evita que la espera y el commit midieran audios distintos.
 * @param {{ createSpeakerAudioResolver?: Function, phrase?: string, turnId?: number }} [options]
 * @returns {Function} resolutor (fabrica ya desenvuelta)
 */
export function buildFinalSpeakerSnapshotResolver({ createSpeakerAudioResolver, phrase = '', turnId } = {}) {
  return () =>
    typeof createSpeakerAudioResolver === 'function'
      ? createSpeakerAudioResolver({
          atTurnBoundary: true,
          allowNewCluster: true,
          utterance: phrase,
          // El FINAL resuelve TARDE: el id se fija al commit para que lea el audio de
          // ESTE turno (`turnAudioSnapshot`) y no el del turno que ya empezo.
          turnId,
        })
      : undefined
}

/**
 * @typedef {Object} ConversationStreamCommitPayload
 * @property {string} [capture]
 * @property {boolean} [newParagraph]
 * @property {string} [speaker]
 * @property {string} [utterance]
 * @property {boolean} [freshUtterance]
 * @property {boolean} [turnCommit]
 * @property {boolean} [turnBoundary]
 * @property {boolean} [diarize]
 * @property {boolean} [atTurnBoundary]
 * @property {boolean} [forceNewRowOnSegment]
 * @property {boolean} [settlesTurn] Cierre REAL del turno (onend/srGap/wake-split):
 *   un `final` de SEGMENTO de Chrome NO lo declara.
 * @property {number} [preflightTurnId] Turno cuyo preflight ya ESPERO el llamador
 *   (`primeTurnSpeakerPreflight`, dueno unico de la espera). El cierre consume ESE
 *   slot: sin el, el sorteo del turno siguiente (`ensureTurnId`) dejaba el commit
 *   leyendo un slot vacio y la evidencia medida no llegaba a la fila (medido en el
 *   log del dueno 2026-10-15: `Preflight turn=29 ready=true` y `commit turn=30
 *   preReady=false`, 34/34 commits).
 */

/**
 * Refs, callbacks y estado compartido inyectados desde useFluVoiceAssistant.
 *
 * @typedef {Object} ConversationStreamCommitDeps
 * @property {import('react').MutableRefObject<boolean>} conversationActiveRef
 * @property {import('react').MutableRefObject<string>} publishedLiveRef
 * @property {import('react').MutableRefObject<object>} listenStateRef
 * @property {import('react').MutableRefObject<boolean>} openPreviewTurnRef
 * @property {(capture: string) => void} scheduleLiveTranscriptUpdate
 * @property {(capture: string) => void} setLiveTranscript
 * @property {(phrase: string, fallbackSpeaker: string, options?: object) => void} applyConversationSpeaker
 * @property {() => void} flushPendingStreamLog
 * @property {import('react').MutableRefObject<string[]>} logRowsTextRef
 * @property {import('react').MutableRefObject<number>} activeTurnIdRef
 * @property {() => void} flushPcmAfterTurnCommit
 * @property {import('react').MutableRefObject<number>} lastCommitAtRef
 * @property {import('react').MutableRefObject<number>} lastOnresultAtRef
 * @property {import('react').MutableRefObject<number>} turnAudioStartSampleRef
 * @property {import('react').MutableRefObject<number>} chunkTotalSamplesRef
 * @property {import('react').MutableRefObject<boolean>} preflightScheduledForTurnRef
 * @property {import('react').MutableRefObject<boolean>} srGapFiredForOpenLineRef
 * @property {import('react').MutableRefObject<(capture: string, action: object) => void | Promise<void>>} processConversationFluQueryRef
 * @property {import('react').MutableRefObject<string>} lastEmittedTranscriptRef
 * @property {(capture: string, options?: object) => boolean} emitConversationLog
 * @property {(options?: object) => object} createSpeakerAudioResolver
 * @property {import('react').MutableRefObject<string>} sessionPrimarySpeakerRef
 * @property {import('react').MutableRefObject<string>} lastLoggedSpeakerRef
 * @property {import('react').MutableRefObject<string[]>} logRowSpeakersRef
 * @property {import('react').MutableRefObject<object[]>} speakerClustersRef
 * @property {import('react').MutableRefObject<string>} lastSpeakerRef
 * @property {import('react').MutableRefObject<number[]|null>} lastTurnSignatureRef
 * @property {import('react').MutableRefObject<string>} lastLogLineTextRef
 * @property {(capture: string, speakerName: string, options?: object) => void} commitTurnToSessionRows
 * @property {import('react').MutableRefObject<{ onTurnCommitted?: () => void }|null>} fluParticipantRef
 * @property {import('react').MutableRefObject<{ text?: string, at?: number }>} [lastRequestRef]
 */

/**
 * Clave comparable de una palabra de la caja: sin caja ni signos, con el texto original
 * intacto para poder publicar la cola tal cual (el replay midio que la union perdia
 * mayusculas: 'Daniel' -> 'daniel').
 * @param {string} palabra
 * @returns {string}
 */
export function claveDePalabra(palabra) {
  // El plegado de acentos tiene UN dueno (textUtils.stripDiacritics, via audioMath):
  // aqui solo se quitan los signos, para comparar palabras.
  return stripDiacritics(String(palabra || '')).replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Es la MISMA palabra con otra ortografia: iguales, o una es el ARRANQUE de la otra (el
 * ASR completa la palabra: 'prueba' -> 'pruebas', 'tar' -> 'tardo'). Nunca con menos de
 * 3 letras compartidas: 'a'/'al' o 'la'/'las' no son la misma palabra.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function mismaPalabraClave(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const corta = a.length <= b.length ? a : b
  const larga = a.length <= b.length ? b : a
  return corta.length >= 2 && larga.startsWith(corta)
}

/**
 * Cola NUEVA de una emision: alinea el FINAL de lo mostrado con un tramo de la emision
 * nueva (el ASR reentrega la cola y sigue) y devuelve SOLO lo que viene DESPUES de ese
 * tramo, con el texto CRUDO de la emision (mas la letra que completa la ultima palabra
 * si la emision trae la version larga). Sin solape fiable no se inventa nada: '' =
 * no hay nada genuino que anadir (bloquear). Nunca quita texto de lo mostrado.
 * @param {string} mostrado
 * @param {string} nuevo
 * @returns {string}
 */
export function colaNuevaTrasSolape(mostrado, nuevo) {
  // La reentrega vive SIEMPRE al final de lo mostrado: se alinea contra la COLA (ventana
  // acotada) y la cola a anadir no puede estar ya ahi (nada se duplica ni se infla).
  const VENTANA = 160
  const crudas = String(mostrado || '').trim().split(/\s+/).filter(Boolean)
  const crudasNuevas = String(nuevo || '').trim().split(/\s+/).filter(Boolean)
  if (!crudas.length || crudasNuevas.length < 2) return ''
  const mostrar = String(mostrado)
  const colaDeLoMostrado = crudas.slice(-VENTANA)
  const clavesMostradas = colaDeLoMostrado.map(claveDePalabra)
  const clavesNuevas = crudasNuevas.map(claveDePalabra)

  /** El tramo de palabras YA esta en la cola de lo mostrado (reentrega: no se aNade). */
  const yaMostrado = (palabras) => {
    if (!palabras.length) return true
    for (let i = 0; i + palabras.length <= clavesMostradas.length; i += 1) {
      let igual = true
      for (let j = 0; j < palabras.length; j += 1) {
        if (clavesMostradas[i + j] !== palabras[j]) { igual = false; break }
      }
      if (igual) return true
    }
    return false
  }

  /** La cola es GENUINA: no entera ya en lo mostrado y no ARRANCA con un tramo ya mostrado
   *  (la reentrega "creciente" de la misma cola repetiria el texto: medido en el replay). */
  const colaGen = (palabras) => {
    if (!palabras.length) return false
    if (yaMostrado(palabras)) return false
    const arranque = palabras.slice(0, Math.min(6, palabras.length))
    return arranque.length < 2 || !yaMostrado(arranque)
  }

  // (A) El SUFIJO de lo mostrado se reentrega dentro de la emision nueva: se anade lo que
  // viene DESPUES de ese tramo (mas la letra que completa la ultima palabra si viene larga).
  const tope = Math.min(60, clavesMostradas.length)
  let fin = -1
  let largo = 0
  for (let p = clavesNuevas.length - 1; p >= 0; p -= 1) {
    if (!mismaPalabraClave(clavesMostradas[clavesMostradas.length - 1], clavesNuevas[p])) continue
    let k = 1
    while (
      k < tope &&
      k < clavesMostradas.length &&
      p - k >= 0 &&
      mismaPalabraClave(clavesMostradas[clavesMostradas.length - 1 - k], clavesNuevas[p - k])
    ) k += 1
    if (k > largo) { largo = k; fin = p }
  }
  if (fin >= 0 && (largo >= 2 || largo === clavesMostradas.length)) {
    const crudaMostrada = colaDeLoMostrado[colaDeLoMostrado.length - 1]
    const crudaNueva = crudasNuevas[fin]
    const completacion = crudaNueva.length > crudaMostrada.length &&
      crudaNueva.toLowerCase().startsWith(crudaMostrada.toLowerCase())
      ? crudaNueva.slice(crudaMostrada.length)
      : ''
    const cola = clavesNuevas.slice(fin + 1)
    if (colaGen(cola)) {
      return `${mostrar}${completacion} ${crudasNuevas.slice(fin + 1).join(' ')}`
    }
    if (!cola.length && completacion) return `${mostrar}${completacion}`
  }

  // (B) La emision ARRANCA reentregando un tramo de lo mostrado (trozo INTERIOR, P11.16) y
  // sigue: se anade su cola nueva. Con menos de 2 palabras de tramo no se inventa la union.
  let mejorK = 0
  for (let i = 0; i < clavesMostradas.length; i += 1) {
    let k = 0
    while (
      k < clavesNuevas.length &&
      i + k < clavesMostradas.length &&
      mismaPalabraClave(clavesMostradas[i + k], clavesNuevas[k])
    ) k += 1
    if (k > mejorK) mejorK = k
  }
  if (mejorK >= 2) {
    const cola = clavesNuevas.slice(mejorK)
    if (colaGen(cola)) {
      return `${mostrar} ${crudasNuevas.slice(mejorK).join(' ')}`
    }
  }
  return ''
}

/**
 * CAJA de la frase viva ("ultima frase"): UNICO escritor de `publishedLiveRef` y de su
 * espejo visible. UNA sola regla (`publicarEnLaCaja`):
 *   - la caja vacia o una emision identica no cambian nada;
 *   - emision que YA contiene lo mostrado -> se aplica la emision (crece);
 *   - emision mas corta o que no contiene lo mostrado -> se ANADE la cola nueva
 *     (alineada con el final de lo mostrado) o se BLOQUEA: nunca se sustituye.
 * El vaciado legitimo (cierre confirmado / parrafo nuevo / reset de sesion) es
 * `vaciarLaCaja`: NO lo decide la regla de acumulacion.
 * @param {{ publishedLiveRef?: { current: string }, scheduleLiveTranscriptUpdate?: Function, setLiveTranscript?: Function }} deps
 * @returns {{ publicarEnLaCaja: Function, vaciarLaCaja: Function }}
 */
export function crearCajaDeLaFrase(deps = {}) {
  const { publishedLiveRef, scheduleLiveTranscriptUpdate, setLiveTranscript } = deps
  const escribirVisible = (texto, inmediato) => {
    if (!texto) {
      if (typeof setLiveTranscript === 'function') setLiveTranscript('')
      return
    }
    if (inmediato && typeof setLiveTranscript === 'function') {
      setLiveTranscript(texto)
      return
    }
    if (typeof scheduleLiveTranscriptUpdate === 'function') {
      scheduleLiveTranscriptUpdate(texto)
      return
    }
    if (typeof setLiveTranscript === 'function') setLiveTranscript(texto)
  }
  const leer = () => String(publishedLiveRef?.current || '')
  const publicarEnLaCaja = (texto = '', opciones = {}) => {
    const nuevo = String(texto || '')
    const mostrado = leer()
    if (!nuevo || nuevo === mostrado) {
      return { aplicado: false, destino: mostrado, previo: mostrado.length }
    }
    // Una sola regla: la union con la cola genuina de la emision (o bloqueo).
    let destino = nuevo
    if (mostrado) {
      destino = colaNuevaTrasSolape(mostrado, nuevo)
      if (!destino || destino.length <= mostrado.length) {
        return { aplicado: false, destino: mostrado, previo: mostrado.length }
      }
    }
    if (publishedLiveRef) publishedLiveRef.current = destino
    escribirVisible(destino, Boolean(opciones.inmediato))
    return { aplicado: true, destino, previo: mostrado.length }
  }
  // Vaciado legitimo (cierre confirmado / arranque / parada / reset de sesion). Por
  // defecto vacia tambien el espejo visible; `{ visible: false }` solo resetea la MEMORIA
  // (el ancla del parrafo nuevo) y deja la ultima frase en pantalla: borrarla era el
  // "borra y luego vuelve a poner" medido por el dueno.
  const vaciarLaCaja = (opciones = {}) => {
    if (publishedLiveRef) publishedLiveRef.current = ''
    if (opciones.visible !== false) escribirVisible('', true)
  }
  return { publicarEnLaCaja, vaciarLaCaja }
}

/**
 * API de la caja: la inyectada por deps si existe; si no, se deriva de los MISMOS deps
 * (ref de la caja + espejo visible). Una sola implementacion, una sola regla.
 * @param {object} deps
 * @returns {{ publicarEnLaCaja: Function, vaciarLaCaja: Function }}
 */

/**
 * Sincroniza preview o commit del stream de conversación según turnCommit.
 *
 * @param {ConversationStreamCommitDeps} deps
 * @param {ConversationStreamCommitPayload} [payload]
 */
export function handleConversationStreamSync(
  deps,
  {
    capture: precomputed = '',
    newParagraph = false,
    speaker = '',
    utterance = '',
    freshUtterance = false,
    turnCommit = false,
    turnBoundary = false,
    diarize = false,
    atTurnBoundary = false,
    forceNewRowOnSegment = false,
    // La espera del preflight la hizo el LLAMADOR con el id del turno que resolvia:
    // el cierre consume ESE slot, no el del turno siguiente (ver el typedef).
    preflightTurnId = null,
    // CIERRE REAL del turno (onend / srGap / split por wake). Un `final` de SEGMENTO
    // de Chrome NO lo declara: la fila de conversacion no se escribe a mitad del
    // dictado (medido 2026-10-08 por el dueno: al llegar al 9 ya estaba "vaciada").
    settlesTurn = false,
  } = {},
) {
  const {
    conversationActiveRef,
    publishedLiveRef,
    listenStateRef,
    openPreviewTurnRef,
    applyConversationSpeaker,
    flushPendingStreamLog,
    logRowsTextRef,
    activeTurnIdRef,
    captureTurnAudio,
    flushPcmAfterTurnCommit,
    lastCommitAtRef,
    lastOnresultAtRef,
    turnAudioStartSampleRef,
    chunkTotalSamplesRef,
    preflightScheduledForTurnRef,
    srGapFiredForOpenLineRef,
    processConversationFluQueryRef,
    lastEmittedTranscriptRef,
    emitConversationLog,
    createSpeakerAudioResolver,
    sessionPrimarySpeakerRef,
    lastLoggedSpeakerRef,
    logRowSpeakersRef,
    speakerClustersRef,
    setSpeakerClusters,
    applyResolvedSpeaker,
    lastSpeakerRef,
    lastTurnSignatureRef,
    lastLogLineTextRef,
    commitTurnToSessionRows,
    fluParticipantRef,
    lastRequestRef,
    lastEmittedTurnRef,
  } = deps

  // CAJA ("ultima frase"): TODO pasa por la API de este modulo (un solo escritor, una
  // sola regla). Ninguna linea de aqui escribe el ref: lo hace la caja.
  const { publicarEnLaCaja, vaciarLaCaja } = crearCajaDeLaFrase(deps)

  if (!conversationActiveRef?.current) return

  let capture =
    precomputed ||
    advancePublishedDisplay(publishedLiveRef.current, listenStateRef.current, {
      reset: newParagraph,
    })
  if (!capture) {
    if (newParagraph || freshUtterance) {
      // Misma regla del cierre: se resetea el ANCLA, no lo PUBLICADO (la "ultima frase"
      // la borra su dueno, el reset de la sesion/voz, no el commit del turno).
      vaciarLaCaja({ visible: false })
      openPreviewTurnRef.current = false
    }
    if (import.meta.env.DEV && debugHotPath) fluDebugHot('stream-skip', { reason: 'empty-capture' })
    return
  }

  // El ID del turno nace al ABRIR el turno (una sola vez), no al resolverlo: el
  // commit temprano, la emision que crece, la resolucion y el log crudo
  // comparten SIEMPRE el mismo id. Antes la resolucion acuñaba el id tarde (y
  // solo con diarizacion activa), asi que la fila del usuario tenia que
  // deduplicarse por POSICION: dos criterios para la misma decision.
  //
  // P8.36 - y nace SOLO para un turno DE VERDAD. El ruido de fondo (aula/casa) no
  // es un turno: si acunara id, moveria el id del turno VIVO y la resolucion (que
  // lo lee al escribir) abriria una SEGUNDA fila con la misma frase.
  const wakeRequired = requiresWakeWord(conversationActiveRef?.current)
  const esTurno = (text) => isTurnCapture(text, { wakeRequired })
  // UN ID POR PETICION (no por reloj ni por estado de la UI): la identidad del
  // turno la dicta la MISMA memoria del despacho —la ultima peticion ACEPTADA
  // (texto + instante)— con la ventana compartida (`sameRequestWindowMs`). Una
  // reentrega del ASR de la MISMA peticion no acuna id: la fila se reutiliza. Un
  // solo criterio (comparador del motor + una ventana) para la ejecucion y la fila.
  const sameRequestAsLastDispatch = (text) => {
    const req = lastRequestRef?.current || { text: '', at: 0 }
    return isSameEmissionWithinWindow(String(req.text || ''), text, {
      sinceMs: Date.now() - Number(req.at || 0),
      windowMs: sameRequestWindowMs(),
    })
  }
  // ¿Es el mismo turno por CONTINUIDAD de la locucion? El ASR puede re-entregar
  // la misma locucion con mas texto (p. ej. "54" -> "54 chars of text") y eso NO
  // es un turno nuevo: es la misma locucion que crece. El id del turno se acuña
  // por LOCUCION, no por revision del ASR.
  const isContinuationOfSameLocution = (text) => {
    const req = lastRequestRef?.current || { text: '', at: 0 }
    const prev = String(req.text || '')
    const next = String(text || '')
    if (!prev || !next) return false
    const sinceMs = Date.now() - Number(req.at || 0)
    const windowMs = sameRequestWindowMs()
    if (sinceMs >= windowMs) return false
    // Misma emision (igual tras normalizar)
    if (isSameEmissionWithinWindow(prev, next, { sinceMs, windowMs })) return true
    // Continuacion: el texto nuevo empieza con el anterior y es mas largo
    const prevNorm = cleanForSpeech(prev).toLowerCase()
    const nextNorm = cleanForSpeech(next).toLowerCase()
    if (prevNorm.length >= 10 && nextNorm.length > prevNorm.length && nextNorm.startsWith(prevNorm)) return true
    return false
  }
  const ensureTurnId = (isTurn, sameLive, sameLocution = false) => {
    if (!isTurn) return
    if (openPreviewTurnRef.current) return
    if (sameLive || sameLocution) return
    openPreviewTurnRef.current = true
    activeTurnIdRef.current += 1
  }

  if (!turnCommit) {
    // El ID del turno se acuna AL ABRIR el turno y ANTES de la caja: un bloqueo de la frase
    // viva (3b) no puede comerse el bump (wakeRowNoiseGuard: "un PREVIEW de ruido no mueve el
    // id del turno VIVO").
    ensureTurnId(esTurno(capture), sameRequestAsLastDispatch(capture), isContinuationOfSameLocution(capture))
    // LA FRASE VIVA SOLO ACUMULA (spec del dueno, 2026-10-11): si el ASR reentrega un TROZO
    // contiguo de lo YA MOSTRADO (una COLA, un trozo del medio), manda lo mostrado y el turno
    // no se toca. Antes el recorte solo se bloqueaba por PREFIJO (`wouldShrinkListenLog`), asi
    // que una COLA reemplazaba la frase entera ("la borra y deja dos o tres palabras, y luego
    // ya se vuelve a ver": log del dueno 2026-10-11 11:28). El criterio del trozo tiene UN
    // dueno (`isFragmentOfLocution`, el mismo de la recompuesta) y ahora es el de la sonda.
    // DUENO UNICO de la CAJA (spec del dueno 2026-10-11): UNA sola condicion de bloqueo, el TROZO
    // (cola/medio que reemplazaria la locucion entera). Se retiro la dimension de LONGITUD
    // (`encoge`/revision mas corta): una emision mas corta de la locucion en curso SI se aplica
    // (la caja refleja la emision actual, suba o baje). El VACIADO (len=0) no pasa por aqui: solo
    // lo hace el reset del cierre (silencio/cambio de hablante/commit).
    // LA CAJA SOLO ACUMULA: cualquier emision MAS CORTA que lo ya mostrado se BLOQUEA
    // (antes solo el TROZO contiguo, y una emision corta NO relacionada REEMPLAZABA:
    // medido 2026-10-11 22:36 -> 356 acortamientos APLICADOS y la frase viva "se comia"
    // parte de la transcripcion). Cero excepciones: acorta:true + aplicado = 0.
    const previoLive = publishedLiveRef.current || ''
    const esTrozo = isFragmentOfLocution(capture, previoLive)
    // La CAJA tiene UN dueno y UNA regla: `publicarEnLaCaja` (la fabrica de la caja). Aqui no se
    // escribe el ref: se pide la publicacion y se registra la decision (sonda de la caja).
    const publicacion = publicarEnLaCaja(capture)
    if (publicacion.aplicado) {
      voiceProbe('live', { turn: activeTurnIdRef.current, resultado: 'aplicado', motivo: publicacion.destino === capture ? 'emision-actual' : (capture.length < publicacion.previo ? 'cola-solapada' : 'solape-anadido'), acorta: false, fresh: Boolean(freshUtterance), mismaLocucion: false, reemplaza: publicacion.destino === capture, previo: publicacion.previo, len: publicacion.destino.length, text: publicacion.destino.slice(0, 220) }) // BANDERA DE DIAGNOSTICO
    } else {
      voiceProbe('live', { turn: activeTurnIdRef.current, resultado: 'bloqueado', motivo: capture.length < previoLive.length ? (esTrozo ? 'trozo' : 'acorta') : 'no-conserva', acorta: capture.length < previoLive.length, fresh: Boolean(freshUtterance), mismaLocucion: esTrozo, previo: previoLive.length, len: capture.length, text: capture.slice(0, 220) }) // BANDERA DE DIAGNOSTICO
    }
    if (turnBoundary || atTurnBoundary) {
      const fallbackSpeaker = speaker || getSpeakerLabel(listenStateRef.current)
      const phrase = cleanForSpeech(utterance) || capture
      const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
      const forceWakeDiarize = Boolean(detectWakeIntroducedName(phrase, wakeWords))
      applyConversationSpeaker(phrase, fallbackSpeaker, {
        force: forceWakeDiarize || diarize,
        atTurnBoundary: true,
        allowNewCluster: false,
      })
    }
    if (import.meta.env.DEV && debugHotPath) {
      fluDebugHot('stream-preview', { capture, turnBoundary, session: readSession(listenStateRef.current) })
    }
    return
  }

  flushPendingStreamLog()
  // El preview ya protegia el recorte por ruido ASR, pero aqui se commiteaba el
  // texto recortado: la fila quedaba mas corta que lo mostrado y se perdia la cola.
  capture = reconcileCommitText(capture, publishedLiveRef.current)
  // P11.26 (medido 2026-10-14 18:32 en su corrida): las FILAS quedaban con el tartamudeo del ASR
  // dentro ("prueba pruebas pruebas", "trans transcripcion transcripcion", "vi viste viste viste"):
  // la caja pasa por el colapsador y la fila escribia el texto CRUDO. Una sola definicion de
  // texto: la fila usa el MISMO normalizador que la caja (normalizeMicText, dueno unico).
  capture = normalizeMicText(capture)

  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  const lastCommittedRow = logRowsTextRef.current.at(-1) || ''
  let fluTailAfterCommit = null
  const inlineWake = resolveInlineWakeAtCommit(capture, lastCommittedRow)
  if (inlineWake.fluTail) {
    fluTailAfterCommit = inlineWake.fluTail
  }
  // La wake SOLO es compuerta de ACCION (¿se ejecuta el comando?), NUNCA de fila:
  // la TRANSCRIPCION se registra SIEMPRE (requisito del dueno, 2026-10-06). El
  // veredicto de wake se calcula ANTES de recortar la cola flu: una captura mixta
  // ("... ok flu <orden>") SI lleva wake.
  capture = inlineWake.capture

  // MISMA locucion viva: la decide el MISMO criterio que el id (la memoria del
  // despacho + la ventana compartida). Solo esa (re-emision) se bloquea, no el habla.
  const mismaLocucionViva = sameRequestAsLastDispatch(capture)
  const ambientRowBlocked = mismaLocucionViva

  // El id del turno se acuna para todo COMMIT real: la fila lo necesita (antes
  // se acuñaba solo con wake y el ruido se quedaba sin fila NI id).
  ensureTurnId(true, mismaLocucionViva, isContinuationOfSameLocution(capture))

  // §9 Sella el turno: captura UNA vez su audio (dueño: turnAudioSnapshot.js) con
  // el id YA acuñado, antes de que `finalizeTurnCommit` vacíe el buffer PCM.
  if (turnCommit && typeof captureTurnAudio === 'function') captureTurnAudio()

  // Único escritor del log: si esta MISMA frase ya se cerró y no llegó habla
  // nueva desde ese commit (doble `onend`/doble dispatch), es una re-emisión
  // del mismo turno, no una fila nueva.
  const dupCheck = {
    lastEmitted: lastEmittedTranscriptRef?.current || '',
    lastCommitted: lastCommittedRow,
    lastResultAt: lastOnresultAtRef?.current || 0,
    lastCommitAt: lastCommitAtRef?.current || 0,
    now: Date.now(),
    echoWindowMs: committedEchoStreakWindowMs(),
  }
  const esDuplicado = isDuplicateTurnCommit(capture, dupCheck)
  // BANDERA DE DIAGNOSTICO CONCLUYENTE: el veredicto del dedupe con sus ENTRADAS (edades y
  // ventana). Sin esto, una locucion duplicada no se podia diagnosticar desde el log.
  voiceProbe('dup', { turn: activeTurnIdRef.current, dup: esDuplicado, lastEmitted: dupCheck.lastEmitted.slice(0, 60), lastCommittedRow: dupCheck.lastCommitted.slice(0, 60), resultAgeMs: dupCheck.now - dupCheck.lastResultAt, commitAgeMs: dupCheck.now - dupCheck.lastCommitAt, echoWindowMs: dupCheck.echoWindowMs, capture: capture.slice(0, 60) }) // BANDERA DE DIAGNOSTICO
  if (esDuplicado) {
    discardLocution({ reason: DISCARD_REASONS.DUPLICATE_COMMIT, phrase: capture, site: 'turn-commit', log: relayLog })
    return
  }

  const finalizeTurnCommit = (closeTurn = false) => {
    finalizeTurnIdentityPipeline(activeTurnIdRef.current)
    flushPcmAfterTurnCommit()
    lastCommitAtRef.current = Date.now()
    turnAudioStartSampleRef.current = chunkTotalSamplesRef.current
    // SOLO el cierre REAL limpia la locucion viva y sella el turno. Un `final` de
    // SEGMENTO de Chrome (pausa BREVE dentro del mismo dictado) NO cierra: el texto
    // sigue visible en ULTIMA FRASE hasta el silencio/onend/cambio de hablante.
    // Antes cada segmento cerraba el turno y "vaciaba" la ultima frase a la
    // conversacion (medido 2026-10-08 por el dueno: al llegar al 9 ya estaba
    // vaciada, sin silencio real ni cambio de hablante). Mientras no cierre, el id
    // del turno NO avanza (`openPreviewTurnRef` sigue abierto) -> UNA fila.
    if (closeTurn) {
      openPreviewTurnRef.current = false
      // El cierre NO borra lo publicado ni su memoria: la transicion a una locucion NUEVA
      // la decide el dueno del trozo (`isFragmentOfLocution`: una frase que NO es trozo
      // reemplaza lo mostrado; un trozo conserva la COMPLETA). Borrar aqui era la via por la
      // que una COLA del ASR dejaba la frase en dos o tres palabras (log del dueno
      // 2026-10-11 11:28) y la razon del parpadeo del 2026-10-10.
      listenStateRef.current.openLine = ''
      listenStateRef.current.pendingInterim = ''
      preflightScheduledForTurnRef.current = false
      srGapFiredForOpenLineRef.current = false
    }
    if (fluTailAfterCommit?.action?.kind === 'flu' && fluTailAfterCommit.action.question) {
      void processConversationFluQueryRef.current(
        fluTailAfterCommit.fullCapture,
        fluTailAfterCommit.action,
      )
    }
  }

  // §9.5 — RUTA ÚNICA de cierre de turno: finalize + aviso al participante.
  // Las dos ramas (segmentada y simple) cierran por aquí; no se invoca
  // `finalizeTurnCommit` en más de un punto.
  const finalizeAndNotify = () => {
    finalizeTurnCommit(settlesTurn)
    fluParticipantRef.current?.onTurnCommitted?.()
  }

  // UNICA puerta de emision de la fila de conversacion de un turno: el ruido de
  // fondo no la cruza (`ambientRowBlocked`). Los dos commits que emiten (ramas
  // segmentada y simple) pasan por aqui, asi que la regla vive en un solo sitio.
  const emitTurnRow = (text, options) => {
    if (!ambientRowBlocked) return emitConversationLog(text, options)
    // B1: la locucion viva bloquea la fila y el descarte deja su motivo.
    discardLocution({ reason: DISCARD_REASONS.AMBIENT_BLOCKED, phrase: text, site: 'emit-row', log: relayLog })
    return false
  }

  const {
    replaceLast,
    forcedReplacePrefix,
    effectiveNewParagraph,
  } = resolveMicCommitAction(
    {
      published: publishedLiveRef.current,
      preview: publishedLiveRef.current,
      openPreview: openPreviewTurnRef.current,
      lastEmitted: lastEmittedTranscriptRef.current,
    },
    {
      capture,
      newParagraph,
      turnBoundary,
      lastCommitted: lastCommittedRow,
    },
  )
  if (import.meta.env.DEV && debugHotPath && forcedReplacePrefix) {
    fluDebugHot('log-asr-revision-blocked', {
      prior: lastCommittedRow || lastEmittedTranscriptRef.current,
      capture,
    })
  }
  if (effectiveNewParagraph || turnBoundary) {
    openPreviewTurnRef.current = false
  }

  const refreshNeeded =
    !replaceLast || shouldRefreshStream(lastEmittedTranscriptRef.current, capture)

  const fallbackSpeaker = speaker || getSpeakerLabel(listenStateRef.current)
  const phrase = cleanForSpeech(utterance) || capture
  const forceWakeDiarize = Boolean(detectWakeIntroducedName(phrase, wakeWords))
  const sameRevisionReplace =
    replaceLast &&
    lastCommittedRow &&
    utterancesSameRevision(lastCommittedRow, capture)

  markCommitPerfNow()
  const turnId = activeTurnIdRef.current
  const preflight = finalizeTurnIdentityPipeline(
    // El slot que el LLAMADOR esperó (ver el typedef). Si no hay espera previa —la
    // ruta del comando y el commit sin preview— se consume el turno del commit.
    Number.isFinite(Number(preflightTurnId)) && Number(preflightTurnId) > 0
      ? Number(preflightTurnId)
      : turnId,
    buildFinalSpeakerSnapshotResolver({ createSpeakerAudioResolver, phrase, turnId }),
    // §9 El cluster del turno se persiste POR EL DUEÑO UNICO (`setSpeakerClusters`)
    // cuando el snapshot final resuelve — aunque sea despues del commit. Sin esto el
    // primer cluster se perdia y ninguna voz se podia separar (inClusters=0 siempre).
    { onClusters: setSpeakerClusters, onResolved: applyResolvedSpeaker },
  )

  const stickyFallback = resolveCommitStickyFallback({
    sessionPrimary: sessionPrimarySpeakerRef.current,
    lastLogged: lastLoggedSpeakerRef.current,
    fallback: fallbackSpeaker,
    phrase,
  })

  const explicitNext = detectNextSpeakerPhrase(phrase)
  let resolved = resolveTurnSpeakerAtCommit({
    phrase,
    wakeWords,
    stickyFallback,
    sessionPrimary: sessionPrimarySpeakerRef.current,
    lastLogged: lastLoggedSpeakerRef.current,
    sameRevisionReplace,
    preflight,
    knownSpeakerLabels: logRowSpeakersRef.current,
    clusters: speakerClustersRef.current,
    forceNewRowOnSegment: Boolean(forceNewRowOnSegment || turnBoundary || atTurnBoundary),
  })

  const soloSession =
    (speakerClustersRef.current || []).filter(
      (c) => isAutoSpeakerLabel(c?.label) && Array.isArray(c?.signature) && c.signature.length,
    ).length === 1

  if (preflight?.ready && !sameRevisionReplace && !explicitNext && !forceWakeDiarize) {
    const anchored = anchorResolvedToLastLogged(resolved.speakerName, stickyFallback, {
      weakAsrEvidence: isWeakAsrSpeakerEvidence({
        phrase,
        lastCommitted: lastCommittedRow,
      }),
      sessionPrimary: sessionPrimarySpeakerRef.current,
      phrase,
      preflightReady: preflight.ready,
      preflightSpeaker: preflight.speakerName,
      soloSession,
    })
    if (anchored && anchored !== resolved.speakerName) {
      resolved = {
        ...resolved,
        speakerName: anchored,
        speakerId: labelToSpeakerId(anchored),
      }
    }
  }

  // UN DUENO de "que hablante lleva la fila": la resolucion del turno
  // (`resolveTurnSpeakerAtCommit`, que YA trata la revision del mismo utterance) y el
  // escritor unico de la fila (`commitUserTurnRow` -> `resolveRowSpeakerName`).
  // Aqui se aporta la ETIQUETA RESUELTA (la voz) y SI hay evidencia acustica; el
  // escritor aplica la regla CON esa evidencia.
  // La etiqueta se escribe SIEMPRE (leccion A5): la evidencia acustica decide el
  // ASCENSO a nombre propio, NO si se escribe. Medido en el log del dueno (2026-10-10):
  // con `preflight.ready` casi siempre false, el gate condicionaba la ESCRITURA de la
  // etiqueta y dejaba `written:""` en 41/41 commits; la fila quedaba a merced de una
  // SEGUNDA resolucion por TEXTO (`resolveSpeakerByText` dentro de `emitConversationLog`):
  // dos duenos del nombre de la fila. Un dato, un dueno.
  // NOMBRE PROPIO SIN EVIDENCIA: la etiqueta del resolver puede ser un nombre heredado por
  // CONTINUIDAD (fuente `sticky`/`asr-revision`, sin ventana de audio). Eso NO se estampa:
  // degrada al label generico. El dueno de esa regla es `blindSpeakerFallback`
  // (speakerPolicy), que estaba ESCRITA Y SIN NINGUN CONSUMIDOR (medido): el defecto
  // "Luis pegado a una voz distinta" (P3 del e2e del dueno) pasaba con ella muerta.
  // Solo la evidencia de IDENTIDAD levanta el nombre: la acustica (preflight) o las
  // fuentes que lo traen de un dato (el texto "soy X" y el panel de participantes).
  // Fuentes que traen el nombre por DATO: SOLO el texto del mandato ("Okay flu soy Luis"). El
  // PARTICIPANTE queda FUERA (spec del dueno, 2026-10-11): un nombre propio solo se afirma con
  // coincidencia MEDIDA contra su ancla; elegir a Luis en el onboarding no etiqueta sus filas.
  const FUENTES_CON_IDENTIDAD = ['wake-intro']
  // Evidencia = la MEDIDA del turno (dueno: `preflightEvidenceMeasured`), no "hay clusters".
  const evidenciaAcustica = preflightEvidenceMeasured(preflight)
  const crudo = resolved.speakerName || fallbackSpeaker
  // P9.81 (spec del dueno 2026-10-12): SI al reuso del CLUSTER, NO al NOMBRE sin evidencia.
  // Levanta el nombre la MEDIDA del turno o el DATO del mandato ("soy Luis"); un nombre
  // heredado por CONTINUIDAD cae a generico via `blindSpeakerFallback`, que es la regla
  // escrita para esto ("Luis pegado a una voz distinta": medido 2026-10-12 con
  // `reason=production-reuse-no-evidence`). Antes un atajo la saltaba (ya retirado).
  const speakerResuelto =
    evidenciaAcustica || FUENTES_CON_IDENTIDAD.includes(resolved.source)
      ? crudo
      : blindSpeakerFallback(crudo)
  const speakerName = normalizeSpeakerLabel(speakerResuelto)
  const speakerEscrito = speakerName

  let segmentPlan =
    !sameRevisionReplace && turnCommit
      ? planAsrTurnSegments({
          phrase: capture,
          priorTexts: logRowsTextRef.current,
          priorSpeakers: logRowSpeakersRef.current,
          preflight,
          fallbackSpeaker: speakerName,
        })
      : []

  const minCoverage = Number(getAsrSegmentationCfg().minCoverageRatio)
  if (
    segmentPlan.length >= 2 &&
    !segmentPlanCoversCapture(segmentPlan, capture, minCoverage)
  ) {
    segmentPlan = []
  }

  if (segmentPlan.length >= 1) {
    let replaceNext = replaceLast
    // Solo si alguna fila se EMITIO de verdad se mueve la marca del turno
    // (`lastEmittedTranscriptRef`): un commit de SEGMENTO sin cierre no emite nada.
    let segmentRowsEmitted = false
    for (let index = 0; index < segmentPlan.length; index += 1) {
      const segment = segmentPlan[index]
      const segmentText = cleanForSpeech(segment.text)
      if (!segmentText) continue

      const segmentSpeaker = normalizeSpeakerLabel(segment.speaker || speakerName)
      applyResolvedSpeakerToSessionRefs(
        { ...resolved, speakerName: segmentSpeaker, previousLabel: fallbackSpeaker || stickyFallback || segmentSpeaker },
        {
          lastSpeakerRef,
          lastLoggedSpeakerRef,
          sessionPrimarySpeakerRef,
          speakerClustersRef,
          setSpeakerClusters,
          renameSpeakerRows,
        },
      )
      if (resolved.signatureVector?.length) {
        lastTurnSignatureRef.current = resolved.signatureVector
      }
      syncSpeakerIndexFromLabel(listenStateRef.current, segmentSpeaker)
      lastLogLineTextRef.current = segmentText
      lastLoggedSpeakerRef.current = segmentSpeaker
      lastSpeakerRef.current = segmentSpeaker

      const segmentReplace = replaceNext
      if (refreshNeeded && settlesTurn) {
        const delivered = emitTurnRow(segmentText, {
          speakerName: segmentSpeaker,
          fallbackSpeaker: segmentSpeaker,
          currentClock: formatClock(),
          replaceLastRawLog: segmentReplace,
          streamUpdate: false,
          turnCommit: true,
        })
        if (delivered) {
          lastEmittedTranscriptRef.current = segmentText
          segmentRowsEmitted = true
        }
      }
      commitTurnToSessionRows(segmentText, segmentSpeaker, { replaceLast: segmentReplace })
      replaceNext = false
    }

    // El texto COMPLETO queda como marca del turno SOLO si el troceo EMITIO fila (cierre
    // real). Un segmento SIN cierre NO la mueve: marcaria la locucion como ya commiteada
    // y el cierre real (mismo texto, `settlesTurn:true`) caeria como duplicado y se
    // perderia sin fila (defecto medido P9.59).
    if (segmentRowsEmitted) {
      lastEmittedTranscriptRef.current = capture
    }
    finalizeAndNotify()

    if (import.meta.env.DEV && debugHotPath) {
      fluDebugHot('stream-commit-segmented', {
        segments: segmentPlan.length,
        capture,
        session: readSession(listenStateRef.current),
      })
    }
    return
  }

  applyResolvedSpeakerToSessionRefs(
    { ...resolved, speakerName, previousLabel: fallbackSpeaker || stickyFallback },
    {
      lastSpeakerRef,
      lastLoggedSpeakerRef,
      sessionPrimarySpeakerRef,
      speakerClustersRef,
      setSpeakerClusters,
      renameSpeakerRows,
    },
  )
  if (resolved.signatureVector?.length) {
    lastTurnSignatureRef.current = resolved.signatureVector
  }
  syncSpeakerIndexFromLabel(listenStateRef.current, speakerName)
  lastLogLineTextRef.current = capture
  lastLoggedSpeakerRef.current = speakerName
  lastSpeakerRef.current = speakerName

  relayLog('LOG', 'RowTrace', `refresh=${refreshNeeded} blocked=${ambientRowBlocked} replace=${replaceLast} turn=${activeTurnIdRef.current} cap="${capture.slice(0, 60)}"`) // BANDERA DE DIAGNOSTICO
  voiceProbe('commit', { preReady: Boolean(preflight?.ready), src: resolved.source, name: resolved.speakerName, written: speakerEscrito, shown: publishedLiveRef.current.slice(0, 220), wc: resolved.workingClusters?.length ?? 0, refClusters: speakerClustersRef.current?.length ?? 0, sticky: stickyFallback, turn: activeTurnIdRef.current, replace: replaceLast, len: capture.length, capture: capture.slice(0, 220) }) // BANDERA DE DIAGNOSTICO
  let delivered = false
  // La fila de CONVERSACION solo se escribe al CIERRE REAL del turno. Chrome cierra
  // SEGMENTOS mientras sigues hablando (un `final` por tramo) y esos commits NO
  // declaran `settlesTurn`: antes cada tramo volcaba la ultima frase a la
  // conversacion (medido 2026-10-08 por el dueno: al llegar al 9 ya estaba
  // vaciada). El texto NO se pierde: sigue en la locucion viva (ULTIMA FRASE) y en
  // la fila de SESION; el cierre (onend, srGap, split por wake) la escribe completa.
  if (refreshNeeded && settlesTurn) {
    delivered = emitTurnRow(capture, {
      speakerName: speakerEscrito, evidenciaAcustica,
      fallbackSpeaker: speakerName,
      currentClock: formatClock(),
      replaceLastRawLog: replaceLast,
      streamUpdate: false,
      turnCommit: true,
    })
    if (delivered) {
      lastEmittedTranscriptRef.current = capture
      if (lastEmittedTurnRef) lastEmittedTurnRef.current = activeTurnIdRef.current
      // RACIONAL DEL DUENO (2026-10-11): la locucion YA se vacio a la conversacion -> la ultima
      // frase arranca de CERO. Es el reset por ITERACION NUEVA (y por pausa de silencio, que es el
      // cierre que la escribe). Con la memoria a "" el dictado siguiente no puede quedar
      // congelado por ser mas corto que el anterior.
      vaciarLaCaja()
    }
  }
  commitTurnToSessionRows(capture, speakerEscrito, { replaceLast })
  // `lastEmittedTranscriptRef` es el texto de la ULTIMA locucion EMITIDA y ademas la FUENTE
  // del dedupe (`isDuplicateTurnCommit`): solo puede moverla quien EMITE la fila (arriba,
  // `if (delivered)`). Escribirla cuando NO se emitio (segmento sin cierre) marcaba la
  // locucion como "ya emitida" y el CIERRE real (mismo texto, `settlesTurn:true`) caia
  // como duplicado -> la locucion entera se perdia sin fila (defecto medido P9.59).
  finalizeAndNotify()

  if (import.meta.env.DEV && debugHotPath) {
    fluDebugHot('stream-commit', {
      capture,
      newParagraph,
      replaceLast,
      freshUtterance,
      utterance,
      session: readSession(listenStateRef.current),
    })
  }
}
