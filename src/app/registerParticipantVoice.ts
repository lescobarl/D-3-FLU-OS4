// ============================================================
// registerParticipantVoice — alta o RE-ANCLA de la VOZ medida de un participante.
// ------------------------------------------------------------
// Antes el 'duplicate' se descartaba: el participante conservaba un ancla vieja o de otro
// modelo|dtype y su voz seguia saliendo "Hablante N" (defecto medido 2026-10-18). El vector
// viaja SIEMPRE con su clave de comparabilidad (`voiceVectorModel`): sin ella no se compara.
// MANDATO DEL DUENO (2026-10-18): la base guarda VECTORES; la comparacion es sobre el
// vector y el nombre es solo su etiqueta. Sin medida real no se escribe nada: un nombre
// con un numero que nadie midio es basura.
// ============================================================
import type { ParticipantRegistry } from '../core/multiuser/participantRegistry';
import { compareCosineSignatures, normalizeEmbeddingVector } from '../voice/lib/speakerCore.js';
import { sameVoiceFloor } from '../voice/lib/speakerClusters.js';
import { voiceVectorModel } from '../voice/lib/speakerDirectory';

/**
 * Registra al participante CON su voz medida; si ya existe, le RE-ANCLA esa voz.
 *
 * @param service puerto de participantes (DI)
 * @param name nombre propio dicho/medido
 * @param voiceVector vector MEDIDO del turno (sin el no hay ancla que escribir)
 * @returns `true` si el participante quedo registrado o re-anclado
 */
export async function registerParticipantVoice(
    service: ParticipantRegistry,
    name: string,
    voiceVector?: number[] | null,
): Promise<boolean> {
    const canonical = String(name || '').trim();
    if (!canonical) return false;
    // Sin vector valido no se toca la base: ni alta de nombre suelto ni pisa del ancla.
    const vector = Array.isArray(voiceVector) ? normalizeEmbeddingVector(voiceVector) : [];
    if (!vector.length) return false;
    const model = voiceVectorModel();
    const result = await service.register({
        name: canonical,
        speakerLabel: canonical,
        voiceVector: vector,
        voiceVectorModel: model,
        voiceAnchorVerified: true,
    });
    if (result.ok || result.reason !== 'duplicate') return result.ok === true;
    const rows = await service.list();
    const existing = rows.find((p) => String(p.name || '').trim().toLowerCase() === canonical.toLowerCase());
    if (!existing) return false;
    // NO RE-ANCLAR CON ECO/TTS: un vector que no es de la MISMA voz no puede
    // sustituir el ancla verificada de una persona. Antes cualquier "soy Luis"
    // posterior (incluida la cola del TTS) reescribia el ancla del titular con la
    // voz equivocada (defecto medido 2026-10-21: `Luis Registrado` y `Luis` 0.536).
    const existingVector = Array.isArray(existing.voiceVector)
        ? normalizeEmbeddingVector(existing.voiceVector)
        : [];
    if (existing.voiceAnchorVerified === true && existingVector.length) {
        const similarity = compareCosineSignatures(existingVector, vector);
        if (similarity < sameVoiceFloor()) return false;
    }
    const reanchor = await service.upsert(existing.id, {
        voiceVector: vector,
        voiceVectorModel: model,
        voiceAnchorVerified: true,
    });
    return reanchor.ok === true;
}
