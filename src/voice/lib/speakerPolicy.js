/**
 * Política de hablante en sala (origen único).
 * Config en fluConfig.roomCapture; timbre/clusters en voiceIdentity.
 *
 * Regla producto (sala / TV, N personas variable):
 * - Misma voz (tú validando solo) → misma etiqueta; no H2 fantasma por pausa/eco.
 * - Otra persona con timbre distinto → Hablante 2, 3… (INV-SPK-01, multi-speakers).
 * - lastLogged manda sobre sessionPrimary (no reabsorber Montse→H1 tras Luis).
 * - «otro hablante» / «ok flu soy …» → cambio o nombre registrado.
 * - Interinos no diarizan en límite de turno (solo el final asigna por audio).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { detectWakeIntroducedName } from './audioMath.js'
import { isAutoSpeakerLabel, normalizeSpeakerLabel } from './voiceIdentity.js'
import { getTranscriptPauseCfg, isPhraseShortForSpeakerHeuristics } from './fluTranscriptPause.js'

export function getRoomCaptureCfg() {
  return FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
}

/** Nombre propio en conversación solo tras wake word (configurable). */
export function requiresWakeWordForSpeakerName(roomCfg = getRoomCaptureCfg()) {
  return roomCfg.requireWakeWordForSpeakerName !== false
}

/**
 * Resuelve nombre propio desde el texto del turno.
 * En sala: solo detectWakeIntroducedName (ok flu soy …); sin wake → ''.
 */
export function resolveSpeakerNameFromUtterance(
  text = '',
  { wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || [], roomCfg = getRoomCaptureCfg() } = {},
) {
  const wakeName = detectWakeIntroducedName(text, wakeWords)
  if (wakeName) return wakeName
  if (requiresWakeWordForSpeakerName(roomCfg)) return ''
  return ''
}

export function isSoloRoomSticky() {
  return getRoomCaptureCfg().soloSpeakerSticky !== false
}

export function isPinRegisteredSpeaker() {
  return getRoomCaptureCfg().pinRegisteredSpeaker !== false
}

/** Índice numérico de «Hablante N» (0 si no aplica). */
export function parseAutoSpeakerIndex(label = '') {
  const match = String(label || '').trim().match(/^Hablante\s+(\d+)$/i)
  return match ? Number(match[1]) : 0
}

/**
 * Tras diarización: ancla al lastLogged si el salto de etiqueta es fantasma (H1→H3)
 * o el ASR es débil (eco TV / stutter).
 */
export function anchorResolvedToLastLogged(
  resolvedName = '',
  stickyFallback = '',
  {
    explicitNextSpeaker = false,
    weakAsrEvidence = false,
    wakeIntro = false,
    sessionPrimary = '',
    phrase = '',
    preflightReady = false,
    preflightSpeaker = '',
    soloSession = false,
  } = {},
) {
  const resolved = normalizeSpeakerLabel(resolvedName)
  const sticky = normalizeSpeakerLabel(stickyFallback)
  const primary = normalizeSpeakerLabel(sessionPrimary)
  if (!sticky || !resolved || resolved === sticky) return resolved
  if (explicitNextSpeaker || wakeIntro) return resolved
  if (weakAsrEvidence) {
    if (primary && isPhraseShortForSpeakerHeuristics(phrase)) return primary
    return sticky
  }
  if (
    preflightReady &&
    primary &&
    isPhraseShortForSpeakerHeuristics(phrase) &&
    normalizeSpeakerLabel(preflightSpeaker) === primary
  ) {
    return primary
  }
  if (!isAutoSpeakerLabel(sticky) || !isAutoSpeakerLabel(resolved)) return resolved

  // Sesión solitaria + el veredicto de audio (preflight) coincide con el hablante anclado:
  // el salto H1→H2 es un fantasma (split cronológico de segmento) → coalesce a sticky.
  // Si el preflight abrió un H2 genuino, preflightSpeaker === H2 !== sticky → se preserva.
  if (soloSession && normalizeSpeakerLabel(preflightSpeaker) === sticky) return sticky

  const stickyIdx = parseAutoSpeakerIndex(sticky)
  const resolvedIdx = parseAutoSpeakerIndex(resolved)
  if (stickyIdx > 0 && resolvedIdx > stickyIdx + 1) return sticky
  if (
    primary &&
    stickyIdx > parseAutoSpeakerIndex(primary) &&
    resolvedIdx > parseAutoSpeakerIndex(primary) &&
    isPhraseShortForSpeakerHeuristics(phrase)
  ) {
    return primary
  }
  return resolved
}

/** Drift Hablante N→M sin comando ni voz distinta (fantasma ASR/TV). */
export function isSoloAutoSpeakerDrift(
  { from, to, allowNewCluster = false, force = false } = {},
  roomCfg = getRoomCaptureCfg(),
) {
  if (roomCfg.soloSpeakerSticky === false) return false
  if (allowNewCluster || force) return false
  return (
    isAutoSpeakerLabel(from) &&
    isAutoSpeakerLabel(to) &&
    String(from).trim() &&
    String(to).trim() &&
    from !== to
  )
}

/** Etiqueta tras diarización en sala solo. */
export function coalesceSoloDrift(resolved, stickyFallback, opts = {}) {
  if (
    isSoloAutoSpeakerDrift({
      from: stickyFallback,
      to: resolved,
      allowNewCluster: opts.allowNewCluster,
      force: opts.force,
    })
  ) {
    return stickyFallback
  }
  return resolved
}

/**
 * Etiqueta preferida para diarización (no confundir con resultado de timbre).
 * Sala: el turno reciente (lastLogged) manda; sessionPrimary solo ancla TV/inicio.
 */
export function resolveSpeakerPreference({
  pinned = '',
  primary = '',
  lastLogged = '',
  lastSpeaker = '',
  fallback = 'Hablante 1',
  requested = '',
  shortUtterance = false,
} = {}) {
  const req = String(requested || '').trim()
  if (req && !isAutoSpeakerLabel(req)) return req
  const recent = lastLogged || lastSpeaker
  if (isSoloRoomSticky()) {
    return pinned || recent || primary || req || fallback
  }
  if (shortUtterance && primary) {
    return req || pinned || primary || recent || fallback
  }
  return req || pinned || recent || primary || fallback
}

/** Interinos en límite de turno: no diarizar en sala solo (evita H2 fantasma). */
export function shouldDiarizeInterimAtTurnBoundary({ turnBoundary = false, forceWakeDiarize = false } = {}) {
  if (!turnBoundary) return false
  if (forceWakeDiarize) return true
  return !isSoloRoomSticky()
}

/** Preview en límite de turno: nunca diarizar en vivo (solo commit en background). */
export function shouldSkipPreviewDiarize({
  forceWakeDiarize = false,
  conversationActive = false,
} = {}) {
  if (forceWakeDiarize) return false
  if (conversationActive) return true
  return isSoloRoomSticky()
}

/** Commit de turno: diarizar por audio salvo registro explícito o «otro hablante». */
export function shouldRunCommitDiarize({
  forceWakeDiarize = false,
  explicitNextSpeaker = false,
  staleInterimFlush = false,
} = {}) {
  if (staleInterimFlush && getTranscriptPauseCfg().skipDiarizeOnStaleFlush) return false
  return Boolean(forceWakeDiarize || explicitNextSpeaker || !isSoloRoomSticky())
}

/** Hablantes auto distintos ya usados en sesión (H1, H2, H3… sin tope). */
export function countSessionAutoSpeakers(labels = []) {
  const seen = new Set()
  let count = 0
  for (const label of labels) {
    const name = String(label || '').trim()
    if (!isAutoSpeakerLabel(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    count += 1
  }
  return count
}

export { isWeakAsrSpeakerEvidence, listConfiguredTranscriptHardRules } from './fluTranscriptPause.js'

/** Sticky para commit cuando no hay revisión ASR del mismo turno. */
export function resolveCommitStickyFallback({
  sessionPrimary = '',
  lastLogged = '',
  fallback = 'Hablante 1',
  phrase = '',
} = {}) {
  const primary = normalizeSpeakerLabel(sessionPrimary)
  if (primary && phrase && isPhraseShortForSpeakerHeuristics(phrase)) {
    return primary
  }
  return lastLogged || sessionPrimary || fallback
}
