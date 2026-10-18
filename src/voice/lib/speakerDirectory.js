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
import { compareCosineSignatures, isAutoSpeakerLabel, normalizeEmbeddingVector } from './speakerCore.js'
import { registeredVoiceFloor, sameVoiceFloor } from './speakerClusters.js'
import { foldSpeakerKey } from './speakerLabels.js'

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
 * @param {{ vector?: number[] | null, model?: string }} [options] Vector de esa voz (su timbre) y
 *   el MODELO que lo generó (sin él, el vector no es comparable).
 */
export function registerVoiceName(voiceId, name, { vector = null, model = voiceVectorModel() } = {}) {
    const id = String(voiceId || '').trim()
    if (!id) return
    const clean = String(name || '').trim()
    const previo = voiceNames.get(id)?.name || ''
    // UNA ETIQUETA AUTOMATICA NO ES UN NOMBRE (mandato: dos voces parecidas se quedan como
    // "Hablante N"): no se registra y NUNCA pisa el nombre ya afirmado de esa voz. MEDIDO en
    // su log 2026-10-14 16:34-16:38: row-update voz=speaker_1 "Luis" -> "Hablante 1" ->
    // "Hablante 3", y sus filas (ya con su nombre) acabaron mostrando "Hablante 3".
    const nombre = isAutoSpeakerLabel(clean) ? previo : clean
    const sig = normalizeEmbeddingVector(Array.isArray(vector) ? vector : [])
    // El MODELO viaja SIEMPRE con el vector: sin el, un vector no es comparable.
    // Sin nombre NI timbre no hay nada que registrar; con TIMBRE SI: la voz queda guardada para
    // poder responder "que VOZ es esta" (liga sus turnos) aunque todavia no sea nadie.
    if (!nombre && !sig.length) return
    voiceNames.set(id, { name: nombre, vector: sig, model: sig.length ? String(model || voiceVectorModel()) : '' })
}

/** Nombre propio de esa VOZ ('' si no tiene: no se adivina). */
export function resolveVoiceName(voiceId) {
    const entry = voiceNames.get(String(voiceId || '').trim())
    return entry?.name || ''
}

/**
 * NOMBRE DE UNA FILA por su VOZ (P11.10): la CLAVE no afirma un nombre propio; lo afirma la VOZ.
 *
 * Medido en vivo 2026-10-13: el nombre se pegaba a la clave derivada de la etiqueta
 * (speaker_N) y la diarizacion la reutiliza/renombra, asi que una mujer acababa mostrando
 * "Luis". Reglas:
 *   - fila CON timbre medido: manda el vector. Si casa con una identidad de la sesion -> su
 *     nombre; si NO casa con ninguna identidad MEDIDA -> '' (no hereda el nombre de la clave).
 *   - fila CON timbre y clave registrada SIN vector (renombre manual del panel): se honra el
 *     nombre (decision humana, no una identidad medida de otra voz).
 *   - fila SIN timbre: NO se consulta el directorio (freeze 2026-10-17). El nombre vive
 *     CONGELADO en la fila (lo escribe el registro/directorio al identificar su voz); la clave
 *     del directorio NO puede nombrar una fila que no lo trae escrito, o una etiqueta de
 *     etiqueta reutilizada por otra voz heredaria el nombre (la mujer salia "Luis").
 *
 * @param {string} voiceId Clave de voz de la fila.
 * @param {number[]|null} [signature] Timbre medido de ese turno (si lo hay).
 * @returns {string} Nombre afirmado ('' si no se puede afirmar).
 */
export function resolveRowVoiceName(voiceId, signature = null) {
    const id = String(voiceId || '').trim()
    const entry = voiceNames.get(id)
    const sig = normalizeEmbeddingVector(Array.isArray(signature) ? signature : [])
    if (sig.length) {
        const conocida = resolveVoiceIdentity(sig)
        if (conocida?.name) return conocida.name
        if (entry?.name && !entry?.vector?.length) return entry.name
        return ''
    }
    return ''
}

/**
 * DUENO UNICO de "¿esta VOZ ya es alguien?" — UNA sola regla, para la SESION y la BASE.
 *
 * Reglas (mandato del dueno 2026-10-13):
 *   1. El vector se compara SIEMPRE con su MODELO: un candidato de otro modelo NO se compara.
 *   2. Empareja si la similitud llega al PISO de su FUENTE: la SESION usa el de reutilizacion
 *      (0.66) y la BASE el de identidad REGISTRADA (0.76) — entre reuniones la banda de la
 *      misma voz es mas estrecha y un 0.70 ajeno se daba por "es Luis" (medido en vivo).
 *   3. Si DOS identidades distintas pasan el piso, NO se decide: null ("Hablante N").
 *
 * @param {number[]} vector Vector medido del turno.
 * @param {{ model?: string, candidates?: Array<{ name?: string, vector?: number[], model?: string }>, floor?: number, registeredFloor?: number }} [options]
 *   `candidates` = VOCES externas (la base de participantes) como datos; la sesion ya esta dentro.
 * @returns {{ voiceId: string, name: string } | null}
 */
export function resolveVoiceIdentity(vector, { model = voiceVectorModel(), candidates = [], floor = sameVoiceFloor(), registeredFloor = registeredVoiceFloor() } = {}) {
    const v = normalizeEmbeddingVector(Array.isArray(vector) ? vector : [])
    if (!v.length) return null
    const modelo = String(model || '')
    const comparables = []
    voiceNames.forEach((entry, id) => {
        // La SESION tambien cuenta SIN nombre: la pregunta "¿que VOZ es esta?" tiene que poder
        // responder aunque esa voz todavia no sea nadie (es lo que liga sus turnos a la MISMA clave).
        if (!entry?.vector?.length) return
        if (String(entry.model || '') !== modelo) return
        comparables.push({ voiceId: id, name: entry.name || '', vector: entry.vector, piso: floor })
    })
    for (const c of Array.isArray(candidates) ? candidates : []) {
        const sig = normalizeEmbeddingVector(Array.isArray(c?.vector) ? c.vector : [])
        const name = String(c?.name || '').trim()
        if (!sig.length || !name) continue
        if (String(c?.model || '') !== modelo) continue
        comparables.push({ voiceId: String(c?.voiceId || ''), name, vector: sig, piso: registeredFloor })
    }
    // Se agrupa por IDENTIDAD (nombre plegado): la misma persona en sesion y en base es UN candidato.
    const porIdentidad = new Map()
    for (const c of comparables) {
        const sim = compareCosineSignatures(v, c.vector)
        if (sim < Number(c.piso)) continue
        // La IDENTIDAD es el nombre si lo tiene; si aun no es nadie, la propia VOZ (su clave).
        const k = c.name ? foldSpeakerKey(c.name) : `voice:${c.voiceId}`
        const prev = porIdentidad.get(k)
        if (!prev || sim > prev.sim) porIdentidad.set(k, { sim, voiceId: c.voiceId, name: c.name })
    }
    if (porIdentidad.size !== 1) return null
    const [unico] = porIdentidad.values()
    return { voiceId: unico.voiceId, name: unico.name }
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
    const id = String(voiceId || '').trim()
    if (sig.length) {
        const conocido = resolveVoiceIdentity(sig, floor == null ? {} : { floor })
        if (conocido?.voiceId) return conocido.voiceId
        // Un match SOLO de la base no trae clave de sesion: NUNCA se devuelve un objeto.
        if (conocido) return id
    }
    if (sig.length && id) rememberVoiceVector(id, sig)
    return id
}