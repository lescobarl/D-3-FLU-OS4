/**
 * participantVoiceAnchors — derivación ÚNICA de las anclas de voz MEDIDAS de la base
 * de participantes al vocabulario que consumen la diarización (`seedRegisteredAnchors`,
 * siembra de la sesión) y la resolución de identidad por voz (`resolveVoiceIdentity`,
 * `candidates` del contrato).
 *
 * ANTES había dos copias del mismo `map` participante → `{ name, vector, model }` (una
 * en cada ruta), con el riesgo de que una aceptara participantes sin vector y la otra
 * no: ruta doble de datos (§6.3). Una sola fuente hace verdad:
 *   - `model` viaja SIEMPRE con `vector`: un embedding de OTRO modelo no es comparable
 *     y la diarización lo descarta (nada de comparar en silencio).
 *   - Un participante SIN vector medido no es ancla: no hay evidencia que sembrar.
 *   - Un vector SIN VERIFICAR tampoco: un nombre con un número viejo/no medido es basura
 *     y sembraba el nombre equivocado (mandato del dueño 2026-10-18: la comparación es
 *     sobre los VECTORES; el nombre es solo su etiqueta).
 */

/** Lo que este módulo necesita leer de un participante (no acopla a Dexie ni al store). */
export interface IParticipantWithVoice {
  name?: string
  voiceVector?: number[]
  voiceVectorModel?: string
  voiceAnchorVerified?: boolean
}

/** Ancla de voz en la forma que consumen `seedRegisteredAnchors` y `resolveVoiceIdentity`. */
export interface ParticipantVoiceAnchor {
  name?: string
  vector?: number[]
  model?: string
  /** SIEMPRE verdadera: este modulo solo entrega anclas con `voiceAnchorVerified`. La marca
   * habilita el piso propio del ancla verificada (medido 0.629–0.714 con la MISMA voz) en la
   * sesion (`anchorVerified` del cluster) y en `resolveVoiceIdentity`. */
  verified?: boolean
}

/**
 * @param participants Participantes de la base (solo se leen nombre y voz).
 * @returns Anclas `{ name, vector, model }` con vector MEDIDO y VERIFICADO; las demás se descartan.
 */
export function participantVoiceAnchorsForDiarization(
  participants: IParticipantWithVoice[] | null | undefined,
): ParticipantVoiceAnchor[] {
  return (participants || [])
    .filter((participant) => participant?.voiceAnchorVerified === true)
    .map((participant) => ({
      name: participant?.name,
      vector: participant?.voiceVector,
      model: participant?.voiceVectorModel,
      verified: true,
    }))
    .filter((anchor) => Array.isArray(anchor.vector) && anchor.vector.length > 0)
}
