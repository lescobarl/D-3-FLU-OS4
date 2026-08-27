/**
 * Hablante al FINAL: una sola resolución (preflight audio / sticky / intro).
 * Tras isFinal=true el hablante no se re-diariza; solo el texto puede revisarse (ASR replaceLast).
 */
import { cleanForSpeech } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { resolveSpeakerNameFromUtterance } from './speakerPolicy.js'
import { labelToSpeakerId, normalizeRowSignature } from './conversationRow.js'
import { normalizeSpeakerLabel } from './voiceIdentity.js'
import { detectNextSpeakerPhrase, nextSpeakerLabel } from './activeListen.js'
import { isNewAudioSegment, getLastCommitPerfAt } from './audioSegmentClock.js'
import { isPhraseShortForSpeakerHeuristics } from './fluTranscriptPause.js'

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

/** @deprecated Usar resolveTurnSpeakerAtCommit con preflight del pipeline continuo. */
export function resolveOptimisticSpeakerAtCommit(options = {}) {
  return resolveTurnSpeakerAtCommit({ ...options, preflight: options.preflight ?? null })
}

export function resolveTurnSpeakerAtCommit({
  phrase = '',
  wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || [],
  stickyFallback = 'Hablante 1',
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
    const fallbackName = normalizeSpeakerLabel(lastLogged || stickyFallback || 'Hablante 1')
    const name = nextName || fallbackName || 'Hablante 1'
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
    cleanForSpeech(stickyFallback) || lastLogged || sessionPrimary || 'Hablante 1',
  )
  const labels = Array.isArray(knownSpeakerLabels) ? knownSpeakerLabels.filter(Boolean) : []
  const name =
    sticky ||
    normalizeSpeakerLabel(nextSpeakerLabel(labels)) ||
    'Hablante 1'

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
  if (refs.lastSpeakerRef) refs.lastSpeakerRef.current = name
  if (refs.lastLoggedSpeakerRef) refs.lastLoggedSpeakerRef.current = name
  if (refs.sessionPrimarySpeakerRef && !refs.sessionPrimarySpeakerRef.current) {
    refs.sessionPrimarySpeakerRef.current = name
  }
  if (resolved.workingClusters?.length && refs.speakerClustersRef) {
    refs.speakerClustersRef.current = resolved.workingClusters
  }
}
