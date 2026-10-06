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
import { isAutoSpeakerLabel, isProperSpeakerName, normalizeSpeakerLabel } from './voiceIdentity.js'
import { isPhraseShortForSpeakerHeuristics } from './fluTranscriptPause.js'
import { parseSpeakerIndex } from './speakerCore.js';

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

/** Índice numérico de «Hablante N» (0 si no aplica). */
export function parseAutoSpeakerIndex(label = '') {
  return parseSpeakerIndex(label) ?? 0
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

export { isWeakAsrSpeakerEvidence, listConfiguredTranscriptHardRules } from './fluTranscriptPause.js'

/** Sticky para commit cuando no hay revisión ASR del mismo turno. */
export function resolveCommitStickyFallback({
  sessionPrimary = '',
  lastLogged = '',
  fallback = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker,
  phrase = '',
} = {}) {
  const primary = normalizeSpeakerLabel(sessionPrimary)
  if (primary && phrase && isPhraseShortForSpeakerHeuristics(phrase)) {
    return primary
  }
  return lastLogged || sessionPrimary || fallback
}

/**
 * Etiqueta de RELLENO sin evidencia acustica.
 *
 * Un NOMBRE PROPIO no se hereda a ciegas: ni por continuidad, ni cuando no hay
 * audio con el que confirmar el timbre. Solo entra por wake ("ok flu soy Ana") o
 * por diarizacion de AUDIO (con firma). Medido (sesion real del dueno,
 * 2026-10-05): `SpeakerTrace ... fallback="luis" last="luis"` rotulaba TODOS los
 * turnos sin audio con su nombre, incluidas voces de mujeres del salon. Sin
 * evidencia, el turno degrada al label generico ("Hablante N"), que es honesto;
 * el nombre propio lo pone la via acustica cuando de verdad coincide.
 */
export function blindSpeakerFallback(label = '') {
  const clean = normalizeSpeakerLabel(label)
  if (!clean) return FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
  return isProperSpeakerName(clean) ? FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker : clean
}
