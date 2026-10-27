/**
 * Política de hablante en sala (origen único).
 * Config en fluConfig.roomCapture; timbre/clusters en voiceIdentity.
 *
 * Regla producto (sala / TV, N personas variable):
 * - Misma voz (tú validando solo) → misma etiqueta; no H2 fantasma por pausa/eco.
 * - Otra persona con timbre distinto → Hablante 2, 3… (INV-SPK-01, multi-speakers).
 * - lastLogged manda sobre sessionPrimary (no reabsorber Montse→H1 tras Luis).
 * - «otro hablante» / «ok flu soy …» → cambio o nombre registrado.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { detectIntroducedName, detectWakeIntroducedName } from './audioMath.js'
import { normalizeSpeakerLabel } from './voiceIdentity.js'
import { anonymousSpeakerLabel } from './speakerLabels.js'
import { optionalConfigBlock } from './configGuard.js'

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
