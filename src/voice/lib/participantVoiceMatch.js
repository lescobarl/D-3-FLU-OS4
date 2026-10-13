// ============================================================
// participantVoiceMatch — DUEÑO ÚNICO de "¿este VECTOR es un participante de la base?".
// ------------------------------------------------------------
// Diseño del dueño (2026-10-13): la diarización entrega, por hablante, una cadena de números
// que ES la identificación de la VOZ (su vector). El nombre es una ETIQUETA de esa voz, no su
// identidad:
//   - al decir "ok flu soy luis" se guarda el VECTOR de esa voz con el participante;
//   - en otra sesión, la misma voz llega como "Hablante N" con un vector SIMILAR: se busca en
//     la base y, si coincide, deja de ser "Hablante N" y pasa a ser "luis";
//   - una voz DISTINTA (vector no similar) NUNCA hereda ese nombre: eso es no mezclar.
//
// La similitud la mide el dueño único del coseno (`speakerCore.compareCosineSignatures`) y el
// piso es el MISMO de reutilización de voz de los clusters (`sameVoiceFloor`): un umbral, un
// sitio.
// ============================================================

import { compareCosineSignatures, normalizeEmbeddingVector } from './speakerCore.js'
import { sameVoiceFloor } from './speakerClusters.js'

/**
 * Participante de la base cuya VOZ (vector) coincide con el vector dado.
 *
 * @param {number[]} vector Vector de la voz del turno (la "cadena de numeros" de la diarizacion).
 * @param {Array<{ name?: string, voiceVector?: number[] }>} participants Base de participantes.
 * @param {{ floor?: number }} [options] Piso de similitud (por defecto, el de reutilizacion de voz).
 * @returns {{ name?: string, voiceVector?: number[] } | null} El participante que ES esa voz, o null.
 */
export function matchParticipantByVoice(vector, participants = [], { floor = sameVoiceFloor() } = {}) {
  const v = normalizeEmbeddingVector(Array.isArray(vector) ? vector : [])
  if (!v.length || !Array.isArray(participants) || !participants.length) return null
  let best = null
  let bestSim = -1
  for (const p of participants) {
    const sig = normalizeEmbeddingVector(Array.isArray(p?.voiceVector) ? p.voiceVector : [])
    if (!sig.length || !p?.name) continue
    const sim = compareCosineSignatures(v, sig)
    if (sim > bestSim) {
      bestSim = sim
      best = p
    }
  }
  return bestSim >= Number(floor) ? best : null
}
