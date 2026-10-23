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
import { detectIntroducedName, detectWakeIntroducedName } from './audioMath.js'
import { isAutoSpeakerLabel, normalizeSpeakerLabel } from './voiceIdentity.js'
import { anonymousSpeakerLabel } from './speakerLabels.js'
import { isPhraseShortForSpeakerHeuristics } from './fluTranscriptPause.js'
import { optionalConfigBlock } from './configGuard.js'
import { parseSpeakerIndex } from './speakerCore.js';

/**
 * Bloque de captura de sala (o `{}`).
 * @returns {NonNullable<typeof FLU_CONFIG.voiceIdentity>['capture']['roomCapture']}
 */
export function getRoomCaptureCfg() {
  return optionalConfigBlock(FLU_CONFIG, ['voiceIdentity', 'capture', 'roomCapture'])
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
  // SIN WAKE: solo se admite si la config lo permite. Antes las DOS ramas devolvian '' y
  // `requireWakeWordForSpeakerName: false` no tenia ningun efecto (auditoria 2026-10-22).
  if (requiresWakeWordForSpeakerName(roomCfg)) return ''
  return detectIntroducedName(text)
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
    // El PRIMARIO (participante activo) NO se estampa sin medida: solo si el audio de
    // ESTE turno lo midio como su voz (preflightSpeaker === primary).
    if (primary && normalizeSpeakerLabel(preflightSpeaker) === primary && isPhraseShortForSpeakerHeuristics(phrase)) return primary
    // CORROBORACION DEL PREFLIGHT (defecto 6 del dueno 2026-10-19): con ASR debil el
    // sticky es el ultimo logueado (= el dueno) y el salto de etiqueta se devolvia a el:
    // la mujer quedaba MEZCLADA en sus filas. Si el preflight de ESTE turno (la MEDIDA
    // del audio) coincide con la etiqueta RESUELTA (una automatica, p. ej. su propio
    // «Hablante 2»), el salto NO es un fantasma: es una voz distinta real y se conserva.
    // Solo con preflight listo; sin el, manda el sticky (comportamiento anterior).
    if (preflightReady && isAutoSpeakerLabel(resolved) && normalizeSpeakerLabel(preflightSpeaker) === resolved) return resolved
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
    normalizeSpeakerLabel(preflightSpeaker) === primary &&
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

/**
 * Sticky para commit cuando no hay revision ASR del mismo turno.
 *
 * El NOMBRE no se inventa. ANTES, una frase CORTA devolvia el PRIMARIO de la sesion —el
 * participante activo de la base, sembrado al arrancar— y la fila salia con SU nombre sin
 * ninguna medida de voz: "el nombre se pega por ETIQUETA / por el participante de la base,
 * no por la VOZ" (defecto medido por el dueno 2026-10-13). Ahora la etiqueta de la fila la
 * decide la VOZ medida (preflight) o el DATO del mandato ("soy X"); sin ninguna, se conserva
 * la etiqueta con la que esa voz venia apareciendo.
 */
export function resolveCommitStickyFallback({
  sessionPrimary: _sessionPrimary = '',
  lastResolved = '',
  lastLogged = '',
  fallback = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker,
} = {}) {
  // La ultima voz RESUELTA POR MEDIDA manda: si llega una resolucion medida (con vector) y
  // luego commits sin medida propia, la fila sigue esa VOZ y no la etiqueta que otros
  // caminos pisan (medido en d4c1c8f3: un final sellado sin audio pisaba `lastLogged` y la
  // mujer quedaba batida entre "Hablante 1" y "Hablante 2" en filas consecutivas).
  const resolved = normalizeSpeakerLabel(lastResolved)
  if (resolved) return resolved
  // El PRIMARIO de la sesion (el participante activo de la base) NO es hablante de una fila:
  // con el, una etiqueta sin voz medida salia con SU nombre ("Luis a la chica").
  const sticky = normalizeSpeakerLabel(lastLogged)
  if (sticky) return sticky
  const respaldo = normalizeSpeakerLabel(fallback)
  // Sin historial ni respaldo: '' (no se inventa una etiqueta ni un nombre).
  if (!respaldo) return ''
  // El respaldo del caller puede ser un NOMBRE PROPIO (la etiqueta del listen state tras
  // wake). Un nombre no se afirma sin evidencia: se degrada al label generico
  // (blindSpeakerFallback, el dueno unico de esa decision).
  return blindSpeakerFallback(respaldo)
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
  // Ruta unica: la regla vive en `anonymousSpeakerLabel` (speakerLabels), que tambien
  // consumen la diarizacion y el hook. Antes esta era OTRA copia de la misma decision.
  return anonymousSpeakerLabel(label)
}
