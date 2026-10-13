// ============================================================
// speakerDirectory — DUEÑO ÚNICO del NOMBRE de una VOZ (por voz, no por etiqueta).
// ------------------------------------------------------------
// Mandato del dueño (2026-10-13):
//   - el nombre de una voz sale SOLO de su VOZ (el vector), no de la etiqueta ni del
//     participante activo;
//   - si dos personas suenan parecido, NO se adivina: se quedan como "Hablante N";
//   - el vector vive en UN solo lugar y es comparable entre reuniones: se guarda CON el
//     modelo que lo generó (`getModelId`, dueño único) y NO se compara entre modelos
//     distintos (si el modelo cambia, el vector viejo no se usa en silencio);
//   - UN solo dueño del nombre: este módulo. Nadie escribe nombres en las filas.
//
// La clave es el ID DE LA VOZ de la sesión (`labelToSpeakerId`, el id que la diarización le
// da a ese timbre). El nombre se pega a ESA voz; la etiqueta es solo su nombre provisional.
// ============================================================

import { getModelId } from './embeddingConfig.js'
import { compareCosineSignatures, normalizeEmbeddingVector } from './speakerCore.js'
import { sameVoiceFloor } from './speakerClusters.js'

/** Modelo que genera los vectores (dueño único: `embeddingConfig.getModelId`). */
export function voiceVectorModel() {
    return String(getModelId() || '')
}

/** voz (id de sesión) -> { name, vector, model }. */
const voiceNames = new Map()

/**
 * Pega un NOMBRE a una VOZ concreta (su id de sesión).
 *
 * @param {string} voiceId Id de la voz (`speaker_N` / `speaker_name_x`).
 * @param {string} name Nombre propio dicho/medido para ESA voz.
 * @param {{ vector?: number[] | null }} [options] Vector de esa voz (su timbre), si se midió.
 */
export function registerVoiceName(voiceId, name, { vector = null } = {}) {
    const id = String(voiceId || '').trim()
    const clean = String(name || '').trim()
    if (!id || !clean) return
    const sig = normalizeEmbeddingVector(Array.isArray(vector) ? vector : [])
    voiceNames.set(id, { name: clean, vector: sig, model: sig.length ? voiceVectorModel() : '' })
}

/** Nombre propio de esa VOZ ('' si no tiene: no se adivina). */
export function resolveVoiceName(voiceId) {
    const entry = voiceNames.get(String(voiceId || '').trim())
    return entry?.name || ''
}

/**
 * ¿Alguna VOZ registrada en la sesión ES este vector? (emparejamiento por TIMBRE, con el piso de reutilización de voz y SOLO entre vectores del MISMO modelo).
 *
 * @param {number[]} vector Vector medido del turno.
 * @param {{ model?: string, floor?: number }} [options]
 * @returns {string | null} El id de la voz que ES ese timbre, o null (no se adivina).
 */
export function matchDirectoryVoice(vector, { model = voiceVectorModel(), floor = sameVoiceFloor() } = {}) {
    const v = normalizeEmbeddingVector(Array.isArray(vector) ? vector : [])
    if (!v.length) return null
    let bestId = null
    let bestSim = -1
    voiceNames.forEach((entry, id) => {
        if (!entry?.vector?.length) return
        // Modelo distinto = vector NO comparable (se re-embebe; nunca se compara en silencio).
        if (String(entry.model || '') !== String(model || '')) return
        const sim = compareCosineSignatures(v, entry.vector)
        if (sim > bestSim) {
            bestSim = sim
            bestId = id
        }
    })
    return bestSim >= Number(floor) ? bestId : null
}

/** Vacía el directorio (reset de sesión). */
export function resetVoiceDirectory() {
    voiceNames.clear()
}

/** Deja el TIMBRE ligado a una clave de voz (aunque aún no tenga nombre). */
export function rememberVoiceVector(voiceId, vector) {
    const id = String(voiceId || '').trim()
    const sig = normalizeEmbeddingVector(Array.isArray(vector) ? vector : [])
    if (!id || !sig.length) return
    const prior = voiceNames.get(id)
    if (prior?.name) return
    voiceNames.set(id, { name: '', vector: sig, model: voiceVectorModel() })
}

/**
 * CLAVE DE VOZ de un turno: el MISMO timbre da la MISMA clave aunque cambie su etiqueta.
 *
 * Mandato del dueño (2026-10-13): la etiqueta ("Hablante N") es provisional y puede cambiar
 * para la misma persona; la voz (su vector) no. Se busca el timbre entre las voces ya vistas
 * de la sesión; si no está, la clave es el id provisional de su etiqueta y el timbre queda
 * ligado a esa clave para los turnos siguientes.
 *
 * @param {{ voiceId?: string, signature?: number[] | null, floor?: number }} [input] El id de la
 * @returns {string} clave de voz ('' si no hay etiqueta ni timbre).
 */
export function voiceKeyFor({ voiceId = '', signature = null, floor } = {}) {
    const sig = normalizeEmbeddingVector(Array.isArray(signature) ? signature : [])
    if (sig.length) {
        const conocido = floor == null ? matchDirectoryVoice(sig) : matchDirectoryVoice(sig, { floor })
        if (conocido) return conocido
    }
    const id = String(voiceId || '').trim()
    if (sig.length && id) rememberVoiceVector(id, sig)
    return id
}