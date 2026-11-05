/**
 * Hablante PRIMARIO de la sesion — DUENO UNICO de `sessionPrimarySpeakerRef`.
 *
 * El mismo dato se escribia desde TRES sitios con tres fuentes distintas y sin
 * ninguna regla de precedencia (ganaba el que llegara antes, por accidente):
 *   1. participante activo de la sala (config `roomCapture`)
 *   2. nombre PRESENTADO por voz ("soy Luis")
 *   3. hablante RESUELTO del primer turno (relleno)
 * Ahora la precedencia es explicita y el unico camino de escritura es este
 * modulo; los tres sitios son llamadores con su `source`.
 *
 * PRECEDENCIA (de mayor a menor): presented > participant > resolved.
 *   - `presented` MANDA: es la voz real diciendo su nombre; antes era una ruta
 *     mas que podia ser pisada por el participante.
 *   - `participant` siembra la sesion; no pisa a un nombre ya presentado.
 *   - `resolved` solo RELLENA si el primario sigue vacio (comportamiento previo).
 * El rango aplicado vive en el propio ref (`__sessionPrimaryRank`), no en estado
 * de modulo: dos hooks montados no se pisan la precedencia, y al limpiar el ref
 * el rango se limpia con el.
 */
import { isProperSpeakerName } from './speakerLabels.js'

/** Rango por fuente. Solo un rango ESTRICTAMENTE mayor pisa al aplicado. */
const RANK = Object.freeze({ resolved: 1, participant: 2, presented: 3 })

/**
 * Escribe el hablante primario de la sesion si la fuente tiene precedencia.
 * @returns {boolean} `true` si escribio.
 */
export function setSessionPrimarySpeaker(ref, name, source = 'resolved') {
    if (!ref) return false
    const rank = RANK[source] || 0
    const clean = String(name || '').trim()
    if (!rank || !clean || !isProperSpeakerName(clean)) return false
    const applied = Number(ref.__sessionPrimaryRank) || 0
    if (rank < applied) return false
    // `resolved` es relleno: no pisa un nombre ya fijado por otra fuente.
    if (rank === RANK.resolved && ref.current) return false
    ref.__sessionPrimaryRank = rank
    ref.current = clean
    return true
}

/** Limpia el primario (fin de sesion) y su rango aplicado. */
export function clearSessionPrimarySpeaker(ref) {
    if (!ref) return
    ref.__sessionPrimaryRank = 0
    ref.current = ''
}
