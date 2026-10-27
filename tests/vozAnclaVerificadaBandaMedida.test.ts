// ============================================================
// vozAnclaVerificadaBandaMedida - la base produce anclas VERIFICADAS
// ------------------------------------------------------------
// DEFECTO MEDIDO (sesion 18f3888c): la base de participantes TENIA el ancla
// verificada de "Luis", pero su voz quedo «Hablante 2» toda la sesion. La banda
// medida de la MISMA voz contra su ancla es 0.629–0.714 (otra ventana y otro
// dia); el piso registrado general (0.76) exige mas de lo que la misma persona
// alcanza, asi que la identidad verificada no confirmaba.
//
// ESTE GUARD mide los PRIMEROS eslabones de la cadena REAL, sin mocks:
//   participante (voiceAnchorVerified) -> participantVoiceAnchorsForDiarization
//   -> seedRegisteredAnchors (anchorVerified en el cluster).
// Corte 2026-10-26 (feature/conversacion-modulo-nuevo): las secciones B-D de
// este guard se retiraron con su dueno (resolveConversationSpeaker, BORRADO en
// el commit 365eeef5); la decision de hablante vive ahora en el modulo nuevo
// (decidirIdentidad, src/voice/conversation/identidad.ts). Los eslabones que
// quedan siguen vivos: participantVoiceAnchorsForDiarization lo consumen
// App.tsx, useParticipants.ts y api/identity.ts; seedRegisteredAnchors,
// useSessionSpeakerClusters.js.
// ============================================================
import { describe, expect, it } from 'vitest'
import { participantVoiceAnchorsForDiarization } from '../src/voice/lib/participantVoiceAnchors'
import { seedRegisteredAnchors } from '../src/voice/lib/speakerClusters.js'

const DIM = 64
/** Modelo de embedding vigente: un vector de OTRO modelo no es comparable. */
const MODELO = 'wavlm-sv-base'

function eje(indice: number): number[] {
  const vector = new Array(DIM).fill(0)
  vector[indice] = 1
  return vector
}

const ANCLA_LUIS = eje(0) // vector guardado y verificado en la base de participantes

/** Participante con su ancla MEDIDA y VERIFICADA, como la guarda la base. */
const PARTICIPANTE_LUIS = {
  name: 'Luis',
  voiceVector: ANCLA_LUIS,
  voiceVectorModel: MODELO,
  voiceAnchorVerified: true,
}

/** Sesion sembrada por la cadena REAL de produccion (participante -> cluster). */
function sembrarDesdeLaBase(participantes: any[] = [PARTICIPANTE_LUIS]): any[] {
  const anchors = participantVoiceAnchorsForDiarization(participantes)
  return seedRegisteredAnchors([], anchors, { model: MODELO }) || []
}

describe('A · la base produce anclas verificadas y la sesion las siembra como tales', () => {
  it('un participante con voiceAnchorVerified llega al cluster con anchorVerified: true', () => {
    const clusters = sembrarDesdeLaBase()
    expect(clusters.map((cluster) => cluster.label)).toEqual(['Luis'])
    expect(clusters[0].anchorSource).toBe('participant-base')
    expect(clusters[0].anchorVerified, 'sin la marca se usaria el piso registrado general').toBe(true)
    expect(clusters[0].signature).toEqual(ANCLA_LUIS)
  })
})
