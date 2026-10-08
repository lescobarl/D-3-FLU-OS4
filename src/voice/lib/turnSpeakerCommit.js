/**
 * Hablante al FINAL: una sola resolución (preflight audio / sticky / intro).
 * Tras isFinal=true el hablante no se re-diariza; solo el texto puede revisarse (ASR replaceLast).
 */
import { cleanForSpeech } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { resolveSpeakerNameFromUtterance } from './speakerPolicy.js'
import { labelToSpeakerId, normalizeRowSignature } from './conversationRow.js'
import { normalizeSpeakerLabel, findLabelsWithSharedVoice } from './voiceIdentity.js'
import { detectNextSpeakerPhrase, nextSpeakerLabel } from './activeListen.js'
import { isNewAudioSegment, getLastCommitPerfAt } from './audioSegmentClock.js'
import { isPhraseShortForSpeakerHeuristics } from './fluTranscriptPause.js'
import { setSessionPrimarySpeaker } from './sessionPrimarySpeaker.js'

function clusterSignatureFor(clusters = [], { speakerId = '', speakerName = '' } = {}) {
  const sid = String(speakerId || '').trim()
  const name = normalizeSpeakerLabel(speakerName)
  const cluster = (Array.isArray(clusters) ? clusters : []).find((entry) => {
    const label = normalizeSpeakerLabel(entry?.label)
    return (
      (sid && String(entry?.speakerId || '').trim() === sid) ||
      (name && label === name)
    )
  })
  return normalizeRowSignature(cluster?.signature)
}

function isShortCommitForSpeakerSplit(phrase = '', lastCommitted = '') {
  return isPhraseShortForSpeakerHeuristics(phrase, lastCommitted)
}

export function resolveCommitRowSignature({
  resolved = {},
  preflight = null,
  clusters = [],
  lastSignature = null,
} = {}) {
  const fromResolved = normalizeRowSignature(resolved?.signatureVector)
  if (fromResolved?.length) return fromResolved

  if (preflight?.ready) {
    const fromPreflight = normalizeRowSignature(preflight?.signatureVector)
    if (fromPreflight?.length) return fromPreflight
  }

  const fromCluster = clusterSignatureFor(clusters, resolved)
  if (fromCluster?.length) return fromCluster

  return normalizeRowSignature(lastSignature) || null
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
  clusters = [],
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
    return {
      speakerId: labelToSpeakerId(intro),
      speakerName: intro,
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
      normalizeRowSignature(preflight.signatureVector)?.length
    ) {
      const labels = Array.isArray(knownSpeakerLabels) ? knownSpeakerLabels.filter(Boolean) : []
      const nextName = normalizeSpeakerLabel(nextSpeakerLabel(labels))
      if (nextName && nextName !== lastName) {
        return {
          speakerId: labelToSpeakerId(nextName),
          speakerName: nextName,
          signatureVector:
            normalizeRowSignature(preflight.signatureVector) ||
            clusterSignatureFor(preflight.workingClusters || [], preflight),
          workingClusters: preflight.workingClusters || null,
          source: 'segment-chrono-split',
        }
      }
    }

    return {
      speakerId: preflight.speakerId,
      speakerName: preflightName,
      signatureVector:
        normalizeRowSignature(preflight.signatureVector) ||
        clusterSignatureFor(preflight.workingClusters || [], preflight),
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
    signatureVector: clusterSignatureFor(clusters, { speakerName: name }),
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
  // Etiquetas: la que ese hablante venia usando (fila anterior) MAS las que el
  // dueno de clusters sabe que son la MISMA voz.
  if (resolved?.source === 'wake-intro' && typeof refs.renameSpeakerRows === 'function') {
    const clusters = refs.speakerClustersRef?.current || []
    const labels = [previous, ...findLabelsWithSharedVoice(clusters, name)].filter(Boolean)
    refs.renameSpeakerRows(labels, name)
  }
}
