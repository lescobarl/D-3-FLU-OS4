/**
 * Hablante al FINAL: una sola resolución (preflight audio / sticky / intro).
 * Tras isFinal=true el hablante no se re-diariza; solo el texto puede revisarse (ASR replaceLast).
 */
import { cleanForSpeech } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { resolveSpeakerNameFromUtterance } from './speakerPolicy.js'
import { labelToSpeakerId, normalizeRowSignature } from './conversationRow.js'
import { normalizeSpeakerLabel } from './voiceIdentity.js'
import { registerSpeakerIdentity } from './speakerIdentityRegister.js'
import { detectNextSpeakerPhrase, nextSpeakerLabel } from './activeListen.js'
import { isNewAudioSegment, getLastCommitPerfAt } from './audioSegmentClock.js'
import { isPhraseShortForSpeakerHeuristics } from './fluTranscriptPause.js'
import { setSessionPrimarySpeaker } from './sessionPrimarySpeaker.js'

/**
 * FIRMA DE LA FILA = la MEDIDA del turno, o nada.
 *
 * DUENO UNICO de esa decision (auditoria 2026-10-23). Antes la firma se "prestaba" de tres
 * fuentes cuando el turno no tenia medida propia: la firma del CLUSTER al que se asignaba el
 * turno, la de sus `workingClusters` y la del commit anterior. Eso hacia que la fila afirmara
 * una evidencia que nunca se midio:
 *   - el renombre por firma (`freezeVoiceName`, `renameVoiceRowsByKey`) alcanzaba filas de
 *     OTRA voz, porque su firma era la del cluster asignado;
 *   - la resolucion tardia de filas pendientes (`pickPendingRowLabel`) decidia con un vector
 *     que no era el del turno;
 *   - la grabacion guardaba la referencia y el replay `vectors` acababa comparando el cluster
 *     consigo mismo (medido 2026-10-23: 149 commits / 17 firmas en 7fce0045).
 * Sin medida, el campo NO se emite: el ledger del preflight (`getSessionSpeakerSnapshots`) es
 * la evidencia de la fila que nacio sin firma propia.
 *
 * @param {object|null} preflight resultado del preflight de identidad del turno
 * @returns {number[]|null} medida del turno, o null si no la hubo
 */
function turnMeasurement(preflight = null) {
  const measured = normalizeRowSignature(preflight?.signatureVector)
  return measured?.length ? measured : null
}

function isShortCommitForSpeakerSplit(phrase = '', lastCommitted = '') {
  return isPhraseShortForSpeakerHeuristics(phrase, lastCommitted)
}

export function resolveTurnSpeakerAtCommit({
  phrase = '',
  wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || [],
  stickyFallback = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker,
  sessionPrimary = '',
  lastLogged = '',
  sameRevisionReplace = false,
  preserveSpeakerOnReplace = '',
  preflight = null,
  knownSpeakerLabels = [],
  pinnedSpeaker = '',
  lastCommitPerfAt = getLastCommitPerfAt(),
  forceNewRowOnSegment = false,
  staleInterimFlush = false,
} = {}) {
  if (sameRevisionReplace) {
    const name = normalizeSpeakerLabel(
      sessionPrimary || lastLogged || stickyFallback,
    )
    return {
      speakerId: labelToSpeakerId(name),
      speakerName: name,
      source: 'asr-revision',
    }
  }

  const lockedReplace = normalizeSpeakerLabel(cleanForSpeech(preserveSpeakerOnReplace))
  if (lockedReplace) {
    return {
      speakerId: labelToSpeakerId(lockedReplace),
      speakerName: lockedReplace,
      source: 'replace-last-locked',
    }
  }

  const intro = resolveSpeakerNameFromUtterance(phrase, { wakeWords })
  if (intro) {
    // El nombre se ata a la VOZ MEDIDA del turno (si el preflight ya la tiene): sin
    // esto el rename usaba la etiqueta de continuidad, que puede ser de otra persona.
    // `workingClusters` viaja para que el commit escriba los clusters. Sin medida NO
    // se emiten los campos: el contrato es "el campo existe si hay dato", no null.
    const introSignature = turnMeasurement(preflight)
    const introClusters = preflight?.workingClusters || null
    return {
      speakerId: labelToSpeakerId(intro),
      speakerName: intro,
      ...(introSignature ? { signatureVector: introSignature } : {}),
      ...(introClusters ? { workingClusters: introClusters } : {}),
      source: 'wake-intro',
    }
  }

  const explicitNext = detectNextSpeakerPhrase(phrase)
  if (explicitNext) {
    const labels = Array.isArray(knownSpeakerLabels) ? knownSpeakerLabels.filter(Boolean) : []
    const nextName = normalizeSpeakerLabel(nextSpeakerLabel(labels))
    const fallbackName = normalizeSpeakerLabel(lastLogged || stickyFallback || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker)
    const name = nextName || fallbackName || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
    return {
      speakerId: labelToSpeakerId(name),
      speakerName: name,
      source: 'explicit-next',
    }
  }

  const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}

  if (preflight?.ready && preflight.speakerId && preflight.speakerName) {
    const segmentStart = Number(preflight.audioStartedAtMs) || 0
    const chronoNewSegment =
      forceNewRowOnSegment || isNewAudioSegment(segmentStart, lastCommitPerfAt)
    const preflightName = normalizeSpeakerLabel(preflight.speakerName)
    const lastName = normalizeSpeakerLabel(lastLogged || stickyFallback)

    if (
      roomCfg.segmentChronoSplit === true &&
      !staleInterimFlush &&
      chronoNewSegment &&
      !sameRevisionReplace &&
      lastName &&
      preflightName === lastName &&
      !isShortCommitForSpeakerSplit(phrase) &&
      preflight.reason !== 'no-audio' &&
      preflight.reason !== 'no-vector' &&
      turnMeasurement(preflight)
    ) {
      const labels = Array.isArray(knownSpeakerLabels) ? knownSpeakerLabels.filter(Boolean) : []
      const nextName = normalizeSpeakerLabel(nextSpeakerLabel(labels))
      if (nextName && nextName !== lastName) {
        return {
          speakerId: labelToSpeakerId(nextName),
          speakerName: nextName,
          signatureVector: turnMeasurement(preflight),
          workingClusters: preflight.workingClusters || null,
          source: 'segment-chrono-split',
        }
      }
    }

    const measured = turnMeasurement(preflight)
    return {
      speakerId: preflight.speakerId,
      speakerName: preflightName,
      // SOLO la medida del turno: sin ella el campo NO existe (ver `turnMeasurement`).
      ...(measured ? { signatureVector: measured } : {}),
      workingClusters: preflight.workingClusters || null,
      source: 'preflight-audio',
    }
  }

  const pinned = cleanForSpeech(pinnedSpeaker)
  if (pinned) {
    return {
      speakerId: labelToSpeakerId(pinned),
      speakerName: pinned,
      source: 'pinned',
    }
  }

  const sticky = normalizeSpeakerLabel(
    cleanForSpeech(stickyFallback) || lastLogged || sessionPrimary || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker,
  )
  const labels = Array.isArray(knownSpeakerLabels) ? knownSpeakerLabels.filter(Boolean) : []
  const name =
    sticky ||
    normalizeSpeakerLabel(nextSpeakerLabel(labels)) ||
    FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker

  return {
    speakerId: labelToSpeakerId(name),
    speakerName: name,
    // SIN MEDIDA PROPIA la fila no lleva firma: la cadena sticky no midio la voz, solo
    // eligio una etiqueta. Prestarle la firma del cluster convertia el renombre por
    // firma y la resolucion tardia en decisiones sobre una evidencia inexistente.
    source: preflight?.pending ? 'sticky-preflight-pending' : 'sticky',
  }
}

export function applyResolvedSpeakerToSessionRefs(resolved, refs = {}) {
  const name = normalizeSpeakerLabel(resolved?.speakerName)
  if (!name) return
  // `previousLabel`: la etiqueta que el hablante VENIA usando (fallback/sticky). Es
  // imprescindible cuando aun no hay fila previa (primera locucion): "soy Luis" debe
  // renombrar la etiqueta con la que su voz aparecia ('Hablante N'), no solo las
  // filas posteriores. Medido 2026-10-08: sin esto, la identificacion en el primer
  // turno no registraba alias y la fila siguiente volvia a la etiqueta generica.
  const previous = normalizeSpeakerLabel(
    refs.lastLoggedSpeakerRef?.current ||
      refs.lastSpeakerRef?.current ||
      resolved?.previousLabel ||
      '',
  )
  if (refs.lastSpeakerRef) refs.lastSpeakerRef.current = name
  if (refs.lastLoggedSpeakerRef) refs.lastLoggedSpeakerRef.current = name
  // Ruta unica: el dueno de `sessionPrimarySpeakerRef` es `setSessionPrimarySpeaker`
  // (precedencia declarada). Aqui solo se RELLENA si sigue vacio.
  setSessionPrimarySpeaker(refs.sessionPrimarySpeakerRef, name, 'resolved')
  if (resolved.workingClusters?.length) {
    // §9: el único escritor de clusters es `setSpeakerClusters`; fallback al ref.
    if (typeof refs.setSpeakerClusters === 'function') {
      refs.setSpeakerClusters(resolved.workingClusters)
    } else if (refs.speakerClustersRef) {
      refs.speakerClustersRef.current = resolved.workingClusters
    }
  }
  // #8 (requisito del dueno; NO depende del microfono): identificado el hablante
  // (soy Luis lo detecta el TEXTO), TODA su participacion previa lleva su nombre.
  // El registro (alias + renombrado de las etiquetas de la MISMA voz + primario con
  // fuente 'presented') tiene UN solo dueno, `registerSpeakerIdentity`: lo comparte con
  // la RUTA DEL COMANDO (`REGISTRAR_PARTICIPANTE`), que antes no registraba nada.
  if (resolved?.source === 'wake-intro') {
    registerSpeakerIdentity({
      name,
      clusters: refs.speakerClustersRef?.current || [],
      previousLabel: previous,
      // La VOZ que dice el nombre es la del turno; `previous` queda solo como
      // respaldo cuando no hubo medida (ver speakerIdentityRegister).
      signatureVector: resolved.signatureVector || null,
      refs: {
        sessionPrimarySpeakerRef: refs.sessionPrimarySpeakerRef,
        setClusters: refs.setSpeakerClusters,
        // La base de participantes se re-ancla por la MISMA ruta que el comando.
        registerParticipant: refs.registerParticipant,
      },
    })
  }
}
