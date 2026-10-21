/**
 * ingestFinalChunk: flush absoluto + final-only + commit async vía hook.
 */
import { cleanForSpeech, pickBestRecognitionTranscript } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import {
  analyzeWakeTurn,
  applyWakeTurnCommit,
  commitCaptureRespectingWakeBoundary,
} from './wakeTurnCommit.js'
import { getTranscriptPauseCfg } from './fluTranscriptPause.js'
import { getSpeakerThresholdsCfg } from './fluTranscriptMotor.js'
import { shouldRelaxIngressTextGuards } from './ingressGuards.js'
import {
  confirmFinal,
  isRedundantFinal,
  isSpeakerVoiceAbruptChange,
  pickBestMicInterim,
  processListenPacket,
  resolveLogParagraphBreak,
  readStreamDisplay,
  utterancesRelate,
  utterancesSameRevision,
  sealPendingInterim,
  clearPendingFinal,
  phrasesEquivalent,
  committedEchoStreakWindowMs,
} from './activeListen.js'
import {
  micPublishedParityOk,
  buildPriorRowsForStrip,
  clearInterimOpenLineClock,
  readTurnLive,
  evaluateSrGapSegmentCommit,
  isCommittedInterimEcho,
  clearStaleCommittedEchoFromState,
  resolveCommitCapture,
  mergePreviewIntoFinalCapture,
  mergeTurnBridgeWithInterim,
  mergeLivePreviewIntoFinalCommit,
  shouldMergeLivePreviewIntoFinal,
  resolveIngressCaptureText,
  isProgressiveExtension,
  isAssistantVoiceEcho,
  esCorreccionDelMismoTramo,
} from './conversationStream.js'
import { collapseAdjacentWordRepeat } from './speechMerge.js'
import { fluTrace } from './fluTrace.js'
import { shouldDiarizeInterimAtTurnBoundary } from './speakerPolicy.js'
import { shouldForceNewLogRowOnCommit } from './ingressGuards.js'
import { nowPerf, getSegmentSilenceGapMs } from './audioSegmentClock.js'
import { countSpeechWords as countWordsFromPauseCfg } from './fluTranscriptPause.js'
import { VOICE_DIARIZATION_DEFAULTS } from '../../core/config/sharedConfig'

/** Ventana en la que un fragmento que coincide con la voz de FLU se cuenta como eco. */
const ASSISTANT_ECHO_WINDOW_MS = VOICE_DIARIZATION_DEFAULTS.assistantEchoWindowMs

/**
 * Canon de una frase SIN el tartamudeo de UNA palabra contigua (dueno de la regla:
 * `collapseAdjacentWordRepeat` en speechMerge). Medido d4c1c8f3: Chrome emite
 * variantes donde una repite una palabra seguida ("puso Cloud" + "puso Cloud Cloud";
 * "…tanto porque" + "…tanto tanto porque") y "la mas completa gana" se quedaba con la
 * tartamudeada. Preserva mayusculas (compara case-insensitive): sirve para COMPARAR
 * variantes y para fijar el texto que se commitea en la fila.
 * @param {string} value
 * @returns {string}
 */
export function canonSinTartamudeo(value = '') {
  return collapseAdjacentWordRepeat(
    String(value || '').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean),
    { datosNumericos: true, longitudMinima: 4 },
  ).join(' ')
}

function buildFinalCommitList(finalChunks = []) {
  const normalized = finalChunks
    .map((chunk) => cleanForSpeech(chunk))
    .filter(Boolean)

  if (normalized.length <= 1) return normalized

  const commits = []
  // Canoniza quitando espacios: Chrome manda alternativas del MISMO result con
  // distinto espaciado ("1 2 3" vs "123") que no deben contarse como frases nuevas.
  const canon = (value) => String(value || '').replace(/\s+/g, '').toLowerCase()
  // Canon CON el tartamudeo de UNA palabra contigua colapsado (dueno: speechMerge).
  // La variante tartamudeada NUNCA gana por longitud: su diferencia con la hermana
  // es ruido, no contenido.
  const canonColapsado = (value) => String(canonSinTartamudeo(value) || '').toLowerCase().replace(/\s+/g, '')
  for (const capture of normalized) {
    const last = commits.at(-1) || ''
    if (!last) {
      commits.push(capture)
      continue
    }
    const cLast = canon(last)
    const cCapture = canon(capture)
    const cColLast = canonColapsado(last)
    const cColCapture = canonColapsado(capture)
    if (
      capture === last ||
      capture.startsWith(last) ||
      last.startsWith(capture) ||
      cCapture === cLast ||
      cLast.startsWith(cCapture) ||
      cCapture.startsWith(cLast) ||
      utterancesSameRevision(last, capture) ||
      utterancesRelate(last, capture) ||
      cColCapture === cColLast
    ) {
      // Misma revisión: Chrome manda alternativas del MISMO result y la más
      // corta puede llegar al final ("1 2 3" → "123" → "1 2"; "… frases" →
      // "ok flu"). Nunca encoger: la alternativa más completa gana. Encoger
      // aquí borraba lo ya dictado (la interacción se perdía).
      // EXCEPCION al "nunca encoger", SOLO cuando la diferencia es TARTAMUDEO
      // de UNA palabra contigua corroborado por la variante hermana (d4c1c8f3):
      // una variante repite una palabra que la otra trae una vez -> gana la
      // forma sin repeticion. La repeticion no es contenido.
      if (cColCapture === cColLast) {
        const repetidaLast = cLast.length > cColLast.length
        const repetidaCapture = cCapture.length > cColCapture.length
        if (repetidaLast && !repetidaCapture) commits[commits.length - 1] = capture
        else if (!repetidaLast && !repetidaCapture && cCapture.length >= cLast.length) commits[commits.length - 1] = capture
        // Ambas tartamudeadas o solo la nueva: se conserva la previa.
      } else if (cCapture.length >= cLast.length) {
        commits[commits.length - 1] = capture
      }
      continue
    }
    commits.push(capture)
  }
  return commits
}

export function collectRecognitionResultChunks(event) {
  const interimChunks = []
  const finalChunks = []
  if (!event?.results?.length) {
    return { interimChunks, finalChunks }
  }
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index]
    const transcript = pickBestRecognitionTranscript(result)
    if (transcript == null) continue
    if (result.isFinal) {
      finalChunks.push(transcript)
    } else {
      interimChunks.push(transcript)
    }
  }
  return { interimChunks, finalChunks }
}

function buildIngressVoiceContext(ctx = {}) {
  const fromHook = typeof ctx.getIngressVoiceContext === 'function' ? ctx.getIngressVoiceContext() : {}
  const thresholds = getSpeakerThresholdsCfg()
  return {
    previewSpeaker: fromHook.previewSpeaker || ctx.lastLoggedSpeakerRef?.current || '',
    interimSpeaker: fromHook.interimSpeaker || fromHook.previewSpeaker || '',
    finalSpeaker: fromHook.finalSpeaker || fromHook.interimSpeaker || '',
    previewSignature: fromHook.previewSignature || fromHook.lastSignature || null,
    finalSignature: fromHook.finalSignature || fromHook.previewSignature || null,
    lastSignature: fromHook.lastSignature || fromHook.previewSignature || null,
    lastAssistantText: fromHook.lastAssistantText || '',
    lastAssistantAtMs: Number(fromHook.lastAssistantAtMs) || 0,
    continuityThreshold: thresholds.cosineContinuityThreshold,
    abruptSimilarityFloor: thresholds.cosineNewVoiceThreshold,
    abruptSimilarityDrop: thresholds.abruptSimilarityDrop,
  }
}

function msSinceLastCommitFromCtx(ctx) {
  const at = Number(ctx.lastCommitAtRef?.current)
  if (!Number.isFinite(at) || at <= 0) return 0
  return Math.max(0, Date.now() - at)
}

function buildIngressRowContext(ctx, capture) {
  const voice = buildIngressVoiceContext(ctx)
  const msSinceLastCommit = msSinceLastCommitFromCtx(ctx)
  const preview = cleanForSpeech(
    ctx.publishedLiveRef?.current || ctx.lastStreamPreviewRef?.current || readStreamDisplay(ctx.listenState),
  )
  const row = {
    lastEmitted: ctx.lastEmittedTranscriptRef?.current || '',
    lastCommitted: ctx.logRowsTextRef?.current?.at(-1) || '',
    preview,
    openPreview: ctx.openPreviewTurnRef?.current,
    displayLine: readStreamDisplay(ctx.listenState),
    msSinceLastCommit,
    pauseBeforeMs: msSinceLastCommit,
    openLineAgeMs:
      Date.now() -
      (ctx.listenState?.openLineLastTouchMs || ctx.listenState?.openLineStartedAtMs || 0),
    finalSpeaker: voice.finalSpeaker,
    previewSpeaker: voice.previewSpeaker,
    interimSpeaker: voice.interimSpeaker,
    finalSignature: voice.finalSignature,
    previewSignature: voice.previewSignature,
    lastSignature: voice.lastSignature,
    continuityThreshold: voice.continuityThreshold,
    abruptSimilarityFloor: voice.abruptSimilarityFloor,
    abruptSimilarityDrop: voice.abruptSimilarityDrop,
    capture,
  }
  row.forceRelaxGuards = shouldRelaxIngressTextGuards(row)
  return row
}

export { commitCaptureRespectingWakeBoundary, applyWakeTurnCommit, analyzeWakeTurn }

/** Commit openLine cuando Chrome lleva ≥ srGapCommitMs sin onresult (TV / SR mudo). */
export function flushSrGapSegmentThroughIngress(ctx, { sinceLastResultMs = 0 } = {}) {
  if (!ctx?.conversationActive || !ctx.listenState) {
    return { flushed: false, reason: 'inactive' }
  }

  const lastCommitted = ctx.logRowsTextRef?.current?.at(-1) || ''

  // P11.9: la LOCUCION VIVA acumulada (publishedLiveRef) es el texto del cierre REAL.
  // Chrome puede re-entregar un interino PARCIAL (p. ej. "54" chars) de una locucion
  // que la linea viva ya acumulo entera (242 chars): el buffer crudo del ASR se queda
  // en el TROZO y los portones del EVAL (already-committed / no-new-content, que
  // comparan contra la ultima fila) cerraban con el trozo o no cerraban nada. Se
  // escribe la locucion COMPLETA EN EL OBJETO del estado (mutacion in-place: su
  // identidad NO cambia, la ven todos los consumidores) ANTES del EVAL, para que el
  // EVAL, los portones y el commit partan de la referencia COMPLETA.
  const liveText = cleanForSpeech(ctx.publishedLiveRef?.current || '')
  // CORRECCION DEL MISMO TRAMO (#11, medido d4c1c8f3): el ultimo interino reescribe el tramo
  // final de la MISMA locucion ("… al 100%" corrige a "… 100 porque"). La FILA lleva la
  // corregida; no se concatenan. Se decide ANTES de sembrar la referencia viva, que borra el
  // pending y con el la unica copia de la correccion.
  const ultimaEmision = cleanForSpeech(ctx.listenState.pendingInterim || '')
  const lineaViva = cleanForSpeech(readTurnLive(ctx.listenState) || ctx.listenState.pendingFinal || '')
  const correccion = esCorreccionDelMismoTramo(lineaViva || liveText, ultimaEmision) ? ultimaEmision : ''
  if (liveText && !correccion) {
    const rawLive = lineaViva
    if (liveText.length > rawLive.length) {
      ctx.listenState.openLine = liveText
      ctx.listenState.pendingInterim = ''
      clearPendingFinal(ctx.listenState)
    }
  }

  const evalResult = evaluateSrGapSegmentCommit(ctx.listenState, {
    sinceLastResultMs,
    lastCommitted,
    lastCommitAtMs: Number(ctx.lastCommitAtRef?.current) || 0,
  })
  if (!evalResult.flush || !evalResult.capture) {
    return { flushed: false, reason: evalResult.reason || 'no-flush', capture: evalResult.capture || '' }
  }

  const capture = cleanForSpeech(evalResult.capture)
  if (!capture) return { flushed: false, reason: 'empty-capture' }

  // La referencia viva ya se sembro en el estado arriba; si aun asi la captura del
  // EVAL trae mas texto (p. ej. el propio final confirmado), manda la mas completa.
  // COSTURA DE FILA (medido d4c1c8f3): la locucion viva puede traer el tartamudeo de
  // UNA palabra ("…cla Cloud Cloud de que…") mientras el final de Chrome era limpio;
  // el canon colapsa el tartamudeo ANTES de sellar la fila (mismo dueno que la puerta
  // del final: `canonSinTartamudeo`).
  const captureFinal = canonSinTartamudeo(
    correccion || ((liveText.length > capture.length) ? liveText : capture),
  )

  resetInterimControlBuffers(ctx.listenState, ctx.publishedLiveRef, ctx.lastStreamPreviewRef)

  const rowContext = buildIngressRowContext(ctx, captureFinal)
  const forceNewRow = shouldForceNewLogRowOnCommit(
    captureFinal,
    rowContext.lastCommitted,
    rowContext.lastEmitted,
    rowContext,
  )
  const redundant = !forceNewRow && isRedundantFinal(captureFinal, rowContext)
  if (redundant) {
    return { flushed: false, reason: 'redundant-vs-log', capture: captureFinal }
  }

  confirmFinal(ctx.listenState, captureFinal)
  processListenPacket(ctx.listenState, '', { interim: '', final: captureFinal, reset: true })

  const wakeAnalysis = analyzeWakeTurn(captureFinal, { lastCommitted })
  if (wakeAnalysis.hasInlineBoundary) {
    const wakeSplit = applyWakeTurnCommit(ctx, captureFinal, {
      source: 'sr-gap',
      newParagraph: forceNewRow || resolveLogParagraphBreak('', captureFinal, true),
      forceNewRow,
    })
    if (wakeSplit.handled) {
      sealTurnBoundaryAfterFinal(ctx)
      return {
        flushed: true,
        dispatched: wakeSplit.reason === 'wake-split-flu',
        capture: captureFinal,
        reason: wakeSplit.reason || evalResult.reason,
        sinceLastResultMs,
      }
    }
  }

  ctx.tryDispatch?.(captureFinal, { interim: false, source: 'sr-gap' })

  // El cierre REAL del segmento se sella SIEMPRE: el `tryDispatch` de arriba puede
  // haber deduplicado (sin escribir fila) o haber respondido. El commit es
  // idempotente (una sola fila por locucion), asi que no hay doble fila.
  const lastRowSrGap = cleanForSpeech(ctx.logRowsTextRef?.current?.at(-1) || '')
  if (lastRowSrGap && phrasesEquivalent(captureFinal, lastRowSrGap)) {
    sealTurnBoundaryAfterFinal(ctx)
    return {
      flushed: false,
      reason: 'already-committed',
      capture: captureFinal,
      sinceLastResultMs,
    }
  }

  ctx.scheduleTurnCommit?.({
    capture: captureFinal,
    newParagraph: forceNewRow || resolveLogParagraphBreak('', captureFinal, true),
    utterance: captureFinal,
    turnCommit: true,
    freshUtterance: true,
    turnBoundary: true,
    atTurnBoundary: true,
    // Cierre REAL por SILENCIO (srGap): la fila de conversacion se escribe aqui.
    settlesTurn: true,
    forceNewRow,
  })

  sealTurnBoundaryAfterFinal(ctx)

  return {
    flushed: true,
    capture: captureFinal,
    reason: evalResult.reason,
    sinceLastResultMs,
  }
}

/** Sella preview pendiente al cerrar SpeechRecognition (onend) sin duplicar commits. */
export function flushRecognitionEndThroughIngress(ctx) {
  if (!ctx?.conversationActive || !ctx.listenState) {
    return { flushed: false, reason: 'inactive' }
  }

  // LOCUCION CONFIRMADA SIN FILA primero: es el texto que el usuario YA dijo (FINAL de
  // Chrome) y que ningun cierre ha sellado. Los interinos POSTERIORES son el tramo EN
  // VUELO (Chrome suelta palabras truncadas) y NO deben pisar la captura confirmada
  // (regla P9.60: el parcial en vuelo se descarta, la confirmada se sella).
  const capture =
    cleanForSpeech(ctx.listenState.pendingFinal) ||
    readStreamDisplay(ctx.listenState) ||
    cleanForSpeech(ctx.listenState.pendingInterim) ||
    // RESCATE DEL CIERRE (defecto 1 del dueno 2026-10-19): los buffers del ASR pueden
    // llegar limpios (reset o puertas previas) con la frase aun viva en la CAJA
    // (publishedLiveRef): se veia en ULTIMA FRASE y el onend salia por empty-capture
    // sin escribir fila. La caja es el texto que el usuario VE: si esta, es la captura.
    cleanForSpeech(ctx.publishedLiveRef?.current)
  if (!capture) {
    sealPendingInterim(ctx.listenState)
    return { flushed: false, reason: 'empty-capture' }
  }

  // Despacho en segundo plano (fire-and-forget): NO informa si escribio fila.
  ctx.tryDispatch?.(capture, { interim: false, source: 'onend' })

  // La fila de conversacion se escribe al CIERRE real (onend) y la decision se toma
  // contra el estado REAL del store: si la ultima fila ya es esta locucion (commit
  // temprano o peticion dedupeada por el interim), no se duplica; si no, se sella
  // aqui. El criterio NO puede ser `lastEmittedTranscriptRef` (avanza en cada commit
  // de SEGMENTO aunque no haya fila): se mide contra la ULTIMA FILA del store.
  const lastRow = cleanForSpeech(ctx.logRowsTextRef?.current?.at(-1) || '')
  if (lastRow && phrasesEquivalent(capture, lastRow)) {
    sealPendingInterim(ctx.listenState)
    return { flushed: false, reason: 'already-committed', capture }
  }

  const result = sealPendingInterim(ctx.listenState)
  clearPendingFinal(ctx.listenState)
  ctx.scheduleTurnCommit?.({
    capture,
    newParagraph: result.newParagraph,
    speaker: result.speaker,
    utterance: capture,
    turnCommit: true,
    // Cierre REAL: SpeechRecognition termino (onend) sin turno cerrado antes.
    settlesTurn: true,
  })
  return { flushed: true, capture, source: 'onend' }
}

function resetInterimControlBuffers(listenState, publishedLiveRef, lastStreamPreviewRef) {
  // El estado de ESCUCHA se limpia; la MEMORIA de lo mostrado NO (un dato, un dueno:
  // la gobierna el escritor de la frase viva, `conversationStreamCommit`). Vaciarla aqui
  // era la segunda via por la que un trozo posterior reemplazaba la frase completa.
  if (listenState) {
    listenState.openLine = ''
    listenState.pendingInterim = ''
    clearPendingFinal(listenState)
    clearInterimOpenLineClock(listenState)
  }
  if (lastStreamPreviewRef) lastStreamPreviewRef.current = ''
}

function sealTurnBoundaryAfterFinal(ctx) {
  if (ctx?.openPreviewTurnRef) ctx.openPreviewTurnRef.current = false
  if (ctx?.preflightScheduledForTurnRef) ctx.preflightScheduledForTurnRef.current = false
  if (typeof ctx?.onTurnFinalized === 'function') ctx.onTurnFinalized()
}

function ingestFinalChunk({ finalChunk, ctx }) {
  // P9.68-b (PERDIDA MEDIDA 2026-10-12, turn 23->29): la locucion CONFIRMADA SIN FILA de la
  // locucion ANTERIOR no se puede perder al llegar una NUEVA. El reset de buffers limpia
  // `pendingFinal` sin volcarla; aqui, si lo que llega es OTRA locucion (ni continuacion ni
  // revision), se VOLCA la anterior por la puerta real (`settlesTurn`) ANTES de empezar la
  // nueva. Reproducido: sin esto la locucion larga (1112 chars) quedaba sin fila.
  const pendientePrevio = cleanForSpeech(ctx.listenState?.pendingFinal || '')
  const finalLimpio = cleanForSpeech(finalChunk || '')
  if (
    pendientePrevio &&
    finalLimpio &&
    !utterancesRelate(pendientePrevio, finalLimpio) &&
    !utterancesSameRevision(pendientePrevio, finalLimpio)
  ) {
    ctx.scheduleTurnCommit?.({
      capture: pendientePrevio,
      utterance: pendientePrevio,
      newParagraph: false,
      speaker: ctx.lastLoggedSpeakerRef?.current || '',
      turnCommit: true,
      settlesTurn: true,
      freshUtterance: false,
      turnBoundary: true,
      atTurnBoundary: true,
      forceNewRow: false,
      forceNewRowOnSegment: false,
      // TEXTO CERRADO: se volco porque llego OTRA locucion. El commit NO puede
      // reconciliarlo contra la linea viva (que ya contiene el interino de la nueva):
      // esa reconciliacion metia la locucion siguiente en esta fila (medido 2026-10-19
      // 21:18:52: fila de 430 = 315 dichos + 112 ajenos; luego los 112 se repetian).
      locutionClosed: true,
    })
    clearPendingFinal(ctx.listenState)
  }
  const lastCommittedRow = cleanForSpeech(
    ctx.logRowsTextRef?.current?.at(-1) || ctx.lastEmittedTranscriptRef?.current || '',
  )
  let capture = cleanForSpeech(finalChunk)
  if (lastCommittedRow && !isCommittedInterimEcho(capture, lastCommittedRow)) {
    // §9: ÚNICA FUENTE DE VERDAD del texto del turno (misma que interims).
    capture = resolveIngressCaptureText(capture, lastCommittedRow)
  }
  if (!capture) return { handled: false, capture: '' }

  const earlyRowContext = buildIngressRowContext(ctx, capture)
  if (
    isRedundantFinal(capture, {
      ...earlyRowContext,
      preview: ctx.publishedLiveRef?.current || ctx.lastStreamPreviewRef?.current || '',
      openPreview: Boolean(ctx.openPreviewTurnRef?.current),
    })
  ) {
    resetInterimControlBuffers(ctx.listenState, ctx.publishedLiveRef, ctx.lastStreamPreviewRef)
    if (typeof ctx.flushTranscriptOnFinal === 'function') {
      ctx.flushTranscriptOnFinal()
    } else if (typeof ctx.flushRecognitionOnFinal === 'function') {
      ctx.flushRecognitionOnFinal()
    }
    // Un final de SEGMENTO NO sella el turno: el cierre REAL llega por onend/srGap
    // (mandato 2026-10-18). Sellarlo aqui re-acunaba el id en el sr-silence y la
    // MISMA captura caia como SEGUNDA fila (doble commit medido en debug.log 16:50:01->05).
    return { handled: false, capture, redundant: true }
  }

  const listenState = ctx.listenState
  const previewSnapshot = resolveCommitCapture({
    final: capture,
    state: listenState,
    published: ctx.publishedLiveRef?.current || ctx.lastStreamPreviewRef?.current || '',
  })
  let { commit: mergedCapture, bridge } = mergePreviewIntoFinalCapture(capture, previewSnapshot)
  if (
    !bridge &&
    lastCommittedRow &&
    cleanForSpeech(mergedCapture).length > capture.length + 16 &&
    cleanForSpeech(mergedCapture).toLowerCase().startsWith(lastCommittedRow.toLowerCase())
  ) {
    mergedCapture = capture
  }
  let commitCapture = cleanForSpeech(mergedCapture || capture)
  // COSTURA DE FILA (medido d4c1c8f3): la caja viva puede arrastrar el tartamudeo de
  // UNA palabra ("puso Cloud Cloud", "…tanto tanto porque") que el final limpio de
  // Chrome ya corregia; el merge preferia la caja y la fila se commiteaba con el
  // duplicado. El canon colapsa el tartamudeo ANTES de sellar: una palabra de enfasis
  // corta ("no no") y el doble genuino de pares ("ya esta ya esta") sobreviven.
  commitCapture = canonSinTartamudeo(commitCapture)
  if (!bridge) {
    const livePreview = cleanForSpeech(
      ctx.publishedLiveRef?.current || ctx.lastStreamPreviewRef?.current || '',
    )
    const lastCommitted = cleanForSpeech(
      ctx.logRowsTextRef?.current?.at(-1) || ctx.lastEmittedTranscriptRef?.current || '',
    )
    const closingSameTurnTail =
      previewSnapshot &&
      commitCapture &&
      previewSnapshot.length > commitCapture.length + 8 &&
      previewSnapshot.toLowerCase().startsWith(commitCapture.toLowerCase())
    if (
      !closingSameTurnTail &&
      livePreview &&
      shouldMergeLivePreviewIntoFinal({
        livePreview,
        finalText: commitCapture,
        lastCommitted,
      })
    ) {
      const bridged = mergeLivePreviewIntoFinalCommit(livePreview, commitCapture)
      if (bridged.length > commitCapture.length) commitCapture = bridged
    }
  }
  const pendingBridge =
    typeof ctx.peekTurnBridgeText === 'function'
      ? cleanForSpeech(ctx.peekTurnBridgeText() || '')
      : ''
  if (pendingBridge) {
    commitCapture = mergeTurnBridgeWithInterim(pendingBridge, commitCapture)
  }

  if (bridge && typeof ctx.stashTurnBridgeText === 'function') {
    ctx.stashTurnBridgeText(bridge)
    fluTrace('ingress', 'bridge-tail-stashed', { bridge: bridge.slice(0, 120), final: capture.slice(0, 80) })
  }

  if (pendingBridge && typeof ctx.consumeTurnBridgeText === 'function') {
    ctx.consumeTurnBridgeText()
  }

  resetInterimControlBuffers(
    ctx.listenState,
    ctx.publishedLiveRef,
    ctx.lastStreamPreviewRef,
  )

  if (typeof ctx.flushTranscriptOnFinal === 'function') {
    ctx.flushTranscriptOnFinal()
  }

  const {
    lastLoggedSpeakerRef,
    debugHotPath,
  } = ctx

  // Un `final` de SEGMENTO de Chrome (pausa BREVE DENTRO de un mismo dictado) NO
  // cierra el turno: antes se despachaba aqui y eso volcaba la ultima frase a la
  // conversacion y hacia responder a FLU a mitad del dictado, sin silencio real ni
  // cambio de hablante (medido 2026-10-08 por el dueno: al llegar al 9 ya estaba
  // "vaciada"). El cierre REAL llega por `onend`
  // (flushRecognitionEndThroughIngress) o por `srGap` (silencio/locucion
  // estancada); un wake INLINE lo cierra `applyWakeTurnCommit` mas abajo. El texto
  // NO se pierde: sigue en la locucion viva (ULTIMA FRASE) y en la fila de SESION.

  const rowContext = buildIngressRowContext(ctx, commitCapture)
  const forceNewRow = shouldForceNewLogRowOnCommit(
    commitCapture,
    rowContext.lastCommitted,
    rowContext.lastEmitted,
    rowContext,
  )
  const redundant = !forceNewRow && isRedundantFinal(commitCapture, rowContext)
  const result = confirmFinal(listenState, commitCapture)
  const newParagraph = resolveLogParagraphBreak('', commitCapture, result.newParagraph)
  ctx.lastStreamPreviewRef.current = ''

  const packet = processListenPacket(listenState, '', {
    interim: '',
    final: commitCapture,
    reset: true,
  })

  if (redundant) {
    resetInterimControlBuffers(listenState, ctx.publishedLiveRef, ctx.lastStreamPreviewRef)
    // Un final de SEGMENTO NO sella el turno: el cierre REAL llega por onend/srGap
    // (mandato 2026-10-18).
    return { handled: false, capture: commitCapture, redundant: true }
  }

  if (import.meta.env?.DEV && debugHotPath && !micPublishedParityOk(packet.published, commitCapture)) {
    ctx.fluDebugHot('mic-fragment-mismerge', {
      mic: commitCapture,
      published: packet.published,
    })
  }

  const published =
    commitCapture.length >= cleanForSpeech(packet.published || '').length
      ? commitCapture
      : cleanForSpeech(packet.published || commitCapture)
  const gapMs = getSegmentSilenceGapMs()
  const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
  const segmentChronoSplit =
    roomCfg.segmentChronoSplit === true &&
    (rowContext.pauseBeforeMs >= gapMs ||
      isSpeakerVoiceAbruptChange({
        ...rowContext,
        finalSpeaker: rowContext.finalSpeaker || rowContext.interimSpeaker,
      }))

  // Un final de SEGMENTO NO sella el turno (mandato 2026-10-18): el cierre REAL lo
  // sella onend/srGap o el wake-split (settlesTurn en applyWakeTurnCommit). Sellarlo
  // aqui era la raiz del doble commit: el sr-silence acunaba OTRO id con la MISMA
  // captura y la misma frase caia dos veces (debug.log 16:50:01.920 -> 16:50:05.692).

  const wakeSplit = applyWakeTurnCommit(ctx, published, {
    source: 'final',
    newParagraph: forceNewRow ? true : newParagraph,
    speaker: result.speaker,
    forceNewRow,
    forceNewRowOnSegment: segmentChronoSplit,
  })
  if (!wakeSplit.handled) {
    // LOCUCION CONFIRMADA SIN FILA: el FINAL de segmento NO cierra el turno (no escribe
    // fila), asi que el texto se DERRAMA al slot `pendingFinal` hasta que un cierre REAL
    // (onend/srGap) lo selle. Sin esto, los interinos posteriores "desconfirmaban" la
    // linea y el rebuild la descartaba: la locucion se perdia entera (medido: filas=[]).
    if (ctx.listenState) ctx.listenState.pendingFinal = commitCapture
    ctx.scheduleTurnCommit?.({
      capture: published,
      newParagraph: forceNewRow ? true : newParagraph,
      speaker: result.speaker,
      utterance: commitCapture,
      turnCommit: true,
      freshUtterance: packet.freshUtterance || forceNewRow,
      turnBoundary: true,
      atTurnBoundary: true,
      forceNewRow,
      forceNewRowOnSegment: segmentChronoSplit,
    })
  }
  if (typeof ctx.touchMeaningfulIngress === 'function') {
    ctx.touchMeaningfulIngress({ meaningful: true, reason: 'final-commit' })
  }

  fluTrace('ingress', 'final-commit-scheduled', {
    capture: published,
    newParagraph,
    speaker: lastLoggedSpeakerRef.current,
  })

  return { handled: false, capture: published, redundant: false }
}

function ingestInterimChunk({ interim, ctx }) {
  const {
    listenState,
    publishedLiveRef,
    openPreviewTurnRef,
    logRowsTextRef,
    lastEmittedTranscriptRef,
    tryDispatch,
    syncConversationStream,
    maybeSwitchLocale,
    debugHotPath,
  } = ctx

  maybeSwitchLocale(interim)
  // Despacho en segundo plano (fire-and-forget): el ingress sigue su curso; el
  // commit de la fila pertenece al escritor unico, no al valor de retorno.
  tryDispatch(interim, { interim: true, source: 'interim' })

  const turnBoundary = !openPreviewTurnRef.current
  const cleanedInterim = cleanForSpeech(interim)
  const pendingBridge =
    typeof ctx.peekTurnBridgeText === 'function'
      ? cleanForSpeech(ctx.peekTurnBridgeText() || '')
      : ''

  const lastCommitted = cleanForSpeech(
    logRowsTextRef.current?.at(-1) || lastEmittedTranscriptRef.current || '',
  )

  const exactCommittedEcho =
    lastCommitted && cleanedInterim && cleanedInterim === lastCommitted

  // §9: criterio ÚNICO de "emisión que crece" (mismo que usa el resolver).
  const extendsCommitted =
    Boolean(lastCommitted) && isProgressiveExtension(cleanedInterim, lastCommitted)

  const atFreshVoice =
    turnBoundary ||
    Boolean(pendingBridge) ||
    msSinceLastCommitFromCtx(ctx) >= Number(getTranscriptPauseCfg().pauseContinuationMinMs) ||
    extendsCommitted

  // Eco ASR real = la misma fila re-emitida RÁPIDO (loop de Chrome atascado). Si la
  // misma frase vuelve tras una pausa real (>= committedEchoStreakWindowMs), es una
  // repetición genuina del usuario: se trata como voz nueva y NO se descarta ni cuenta
  // como eco (evita el loop "no escucha nada" + "transcribe a medias").
  const echoStreakWindowMs = committedEchoStreakWindowMs()
  const withinEchoWindow =
    msSinceLastCommitFromCtx(ctx) < echoStreakWindowMs

  if (
    withinEchoWindow &&
    (exactCommittedEcho ||
      (lastCommitted && !atFreshVoice && isCommittedInterimEcho(cleanedInterim, lastCommitted)))
  ) {
    clearStaleCommittedEchoFromState(listenState, lastCommitted)
    if (typeof ctx.touchMeaningfulIngress === 'function') {
      ctx.touchMeaningfulIngress({ meaningful: false, reason: 'committed-echo-settled' })
    }
    return { handled: false }
  }

  // Eco de la PROPIA voz de FLU: el micrófono re-captura su TTS y, sin esto,
  // entraba como turno de una persona y se mezclaba con el hablante real
  // («FLU y yo como Hablante 1»). El detector de arriba solo compara contra
  // filas de USUARIO, así que no podía ver lo que FLU acababa de decir.
  // El gate de «más de una palabra» evita leer el store en el camino caliente
  // (la mayoría de fragmentos ASR son de una palabra) y descarta coincidencias
  // casuales con respuestas cortas del usuario.
  //
  // VENTANA: el eco es físico (el micrófono oye a FLU mientras habla o en su
  // cola). Sin ventana, el texto solo no distingue "el usuario repite una frase
  // que FLU usa como comando" ("siguiente carta" en la lotería) de "mi voz
  // rebotó": son las MISMAS palabras, y el turno se perdía minutos después de
  // que FLU hablara (la partida dejaba de responder). Fuera de la ventana, es
  // voz nueva y NO se descarta.
  if (cleanedInterim.includes(' ')) {
    const assistantVoiceCtx =
      typeof ctx.getIngressVoiceContext === 'function' ? ctx.getIngressVoiceContext() : {}
    const spokenAt = Number(assistantVoiceCtx.lastAssistantAtMs) || 0
    const msSinceAssistant = spokenAt > 0 ? Date.now() - spokenAt : Number.POSITIVE_INFINITY
    if (
      msSinceAssistant <= ASSISTANT_ECHO_WINDOW_MS &&
      isAssistantVoiceEcho(cleanedInterim, assistantVoiceCtx.lastAssistantText)
    ) {
      if (typeof ctx.touchMeaningfulIngress === 'function') {
        ctx.touchMeaningfulIngress({ meaningful: false, reason: 'assistant-voice-echo' })
      }
      return { handled: false }
    }
  }

  // §9: ÚNICA FUENTE DE VERDAD del texto del turno (misma que finales).
  let interimForPacket = resolveIngressCaptureText(cleanedInterim, lastCommitted, { atFreshVoice })
  if (pendingBridge) {
    interimForPacket = mergeTurnBridgeWithInterim(pendingBridge, interimForPacket)
  }

  const priorRows =
    atFreshVoice
      ? []
      : buildPriorRowsForStrip(logRowsTextRef.current, lastEmittedTranscriptRef.current, {
          maxRows: FLU_CONFIG.limits.priorRowsMax,
        })

  const packet = processListenPacket(listenState, publishedLiveRef.current, {
    interim: interimForPacket,
    turnBoundary,
    msSinceLastCommit: msSinceLastCommitFromCtx(ctx),
    priorRows,
  })

  const liveTurn = cleanForSpeech(readTurnLive(listenState))
  const syncSources = [packet.published, liveTurn, interimForPacket]
  if (!interimForPacket || interimForPacket === cleanedInterim) {
    syncSources.push(cleanedInterim)
  }
  const syncCapture = syncSources.reduce(
    (best, candidate) => {
      const next = cleanForSpeech(candidate)
      if (!next) return best
      if (!best || next.length > best.length) return next
      return best
    },
    '',
  )

  if (!syncCapture) {
    return { handled: false }
  }

  if (pendingBridge && typeof ctx.consumeTurnBridgeText === 'function') {
    const bridgeWords = countWordsFromPauseCfg(cleanedInterim)
    if (bridgeWords >= 2 || cleanedInterim.length >= 12) {
      ctx.consumeTurnBridgeText()
      fluTrace('ingress', 'bridge-tail-consumed', {
        bridge: pendingBridge.slice(0, 80),
        interim: cleanedInterim.slice(0, 80),
        merged: syncCapture.slice(0, 120),
      })
    }
  }

  if (turnBoundary && typeof ctx.markAudioSegmentStart === 'function') {
    ctx.markAudioSegmentStart(nowPerf())
  }

  if (turnBoundary && typeof ctx.scheduleIdentityPreflight === 'function') {
    ctx.scheduleIdentityPreflight({ utterance: cleanedInterim || interimForPacket })
  }

  if (import.meta.env?.DEV && debugHotPath && interim.length > syncCapture.length + 24) {
    ctx.fluDebugHot('mic-stutter-collapsed', {
      rawLen: interim.length,
      publishedLen: syncCapture.length,
    })
  }

  ctx.lastStreamPreviewRef.current = packet.display || liveTurn
  if (typeof ctx.touchMeaningfulIngress === 'function') {
    ctx.touchMeaningfulIngress({
      meaningful: true,
      reason: packet.unchanged ? 'interim-steady' : 'interim-changed',
    })
  }
  syncConversationStream({
    capture: syncCapture,
    utterance: interim,
    turnBoundary,
    diarize: shouldDiarizeInterimAtTurnBoundary({ turnBoundary }),
    atTurnBoundary: turnBoundary,
    forceLiveResync: true,
  })
  return { handled: false }
}

/**
 * Puerta unica del ingress de conversacion: reinyecta los chunks del ASR (interinos y
 * finales) en el pipeline del turno. Es la MISMA puerta que usa el hook en produccion
 * (medida por tests/replayDuenoDiarizacionGuard).
 * @param {{ interimChunks?: string[], finalChunks?: string[], ctx: object }} [entrada]
 * @returns {{ handled: boolean, [k: string]: unknown }}
 */
export function processMicConversationIngress({ interimChunks = [], finalChunks = [], ctx } = {}) {
  if (!ctx?.conversationActive) return { handled: false }
  const interimPreview = pickBestMicInterim(interimChunks.map((t) => cleanForSpeech(t)))
  const commitList = buildFinalCommitList(finalChunks)

  const interim = interimPreview
  let interimAbsorbedByFinal = false

  ctx.interimAbsorbedByFinal = false
  ctx.ingressSource = 'mic'

  for (const finalChunk of commitList) {
    interimAbsorbedByFinal =
      Boolean(interim) &&
      (() => {
        const capturePreview = cleanForSpeech(finalChunk)
        return (
          capturePreview === interim ||
          capturePreview.startsWith(interim) ||
          interim.startsWith(capturePreview) ||
          utterancesRelate(capturePreview, interim) ||
          utterancesSameRevision(capturePreview, interim)
        )
      })()

    ctx.interimAbsorbedByFinal = interimAbsorbedByFinal

    const result = ingestFinalChunk({ finalChunk, ctx })
    if (result.handled) return { handled: true }
  }

  if (interim && !interimAbsorbedByFinal) {
    const interimResult = ingestInterimChunk({ interim, ctx })
    if (interimResult.handled) return { handled: true }
  }

  return { handled: false }
}
