/**
 * Preview y commit del stream de conversación (mic → UI/log).
 * Extraído de useFluVoiceAssistant para aislar la ruta syncConversationStream.
 */
import { cleanForSpeech, detectWakeIntroducedName, formatClock, sameRequestWindowMs } from './audioMath.js'
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
import { isNameBoundToVoice } from './speakerClusters.js'
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
    scheduleLiveTranscriptUpdate,
    setLiveTranscript,
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
      publishedLiveRef.current = ''
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
  const ensureTurnId = (isTurn, sameLive) => {
    if (!isTurn) return
    if (openPreviewTurnRef.current) return
    if (sameLive) return
    openPreviewTurnRef.current = true
    activeTurnIdRef.current += 1
  }

  if (!turnCommit) {
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
    const esTrozo = isFragmentOfLocution(capture, publishedLiveRef.current)
    if (esTrozo) {
      voiceProbe('live', { turn: activeTurnIdRef.current, resultado: 'bloqueado', motivo: 'trozo', acorta: true, fresh: Boolean(freshUtterance), mismaLocucion: true, previo: publishedLiveRef.current.length, len: capture.length, text: capture.slice(0, 220) }) // BANDERA DE DIAGNOSTICO
      return
    }
    if (capture !== publishedLiveRef.current) {
      voiceProbe('live', { turn: activeTurnIdRef.current, resultado: 'aplicado', motivo: 'emision-actual', acorta: capture.length < publishedLiveRef.current.length, fresh: Boolean(freshUtterance), mismaLocucion: esTrozo, reemplaza: true, previo: publishedLiveRef.current.length, len: capture.length, text: capture.slice(0, 220) }) // BANDERA DE DIAGNOSTICO
      publishedLiveRef.current = capture
      scheduleLiveTranscriptUpdate(capture)
    }
    ensureTurnId(esTurno(capture), sameRequestAsLastDispatch(capture))
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
  // se acunaba solo con wake y el ruido se quedaba sin fila NI id).
  ensureTurnId(true, mismaLocucionViva)

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
    turnId,
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
  // El nombre LIGADO a la voz (registro del comando o del panel) se mantiene en TODOS sus turnos:
  // no depende de que la medida del turno llegue (N turnos -> N filas con el nombre).
  const nombreLigado = isNameBoundToVoice(speakerClustersRef.current, crudo)
  const speakerResuelto =
    evidenciaAcustica || FUENTES_CON_IDENTIDAD.includes(resolved.source) || nombreLigado
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
      publishedLiveRef.current = ''
      if (typeof setLiveTranscript === 'function') setLiveTranscript('')
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
