// ============================================================
// vozAnclaBaseSesionGuard - LA BASE SIEMBRA SUS ANCLAS EN LA SESION
// ------------------------------------------------------------
// MANDATO DEL DUENO (2026-10-18, validacion en vivo):
//   - "Voz conocida en la base la pone inmediatamente"
//
// DEFECTO MEDIDO (log del dueno 2026-10-18): la base de participantes TENIA el
// vector de "Luis" y TODOS sus turnos salian "Hablante 1": la base solo se
// consultaba al final, en el contrato (`resolveVoiceIdentity`), nunca en la
// decision de diarizacion.
//
// ESTE GUARD mide el PRIMER eslabon de la cadena REAL: `seedRegisteredAnchors`
// (src/voice/lib/speakerClusters.js) siembra las anclas MEDIDAS de la base en
// la sesion. Corte 2026-10-26 (feature/conversacion-modulo-nuevo): las
// secciones B-G de este guard se retiraron con su dueno
// (resolveConversationSpeaker/speakerDiarization.js, BORRADA en el commit
// 365eeef5); la decision de hablante vive ahora en el modulo nuevo
// (decidirIdentidad, src/voice/conversation/identidad.ts). seedRegisteredAnchors
// sigue consumido por useSessionSpeakerClusters.js y participantVoiceAnchors.ts.
// ============================================================
import { describe, expect, it } from 'vitest'
import { seedRegisteredAnchors } from '../src/voice/lib/speakerClusters.js'

const DIM = 64
/** Modelo de embedding vigente: un vector de OTRO modelo no es comparable. */
const MODELO = 'wavlm-sv-base'

/** Vector de una voz: un eje propio (voces ortogonales = coseno 0). */
function eje(indice: number): number[] {
  const vector = new Array(DIM).fill(0)
  vector[indice] = 1
  return vector
}

const VOZ_BASE = eje(0) // la voz registrada en la base de participantes ("Luis")
const VOZ_MUJER = eje(1) // TV / hija: desconocida y acusticamente DISTINTA

const ANCLA_BASE = [{ name: 'Luis', vector: VOZ_BASE, model: MODELO }]

/** Sesion recien sembrada con las anclas de la base (como al arrancar el hook). */
function sembrar(anchors = ANCLA_BASE): any[] {
  return seedRegisteredAnchors([], anchors, { model: MODELO }) || []
}

describe('A - la base de participantes siembra sus anclas en la SESION', () => {
  it('siembra un nombre propio con su vector MEDIDO del mismo modelo', () => {
    const seeded = sembrar()
    expect(seeded.map((cluster) => cluster.label)).toEqual(['Luis'])
    expect(seeded[0].signature).toEqual(VOZ_BASE)
    expect(seeded[0].anchorSource).toBe('participant-base')
  })

  it('NO siembra vectores vacios/degenerados, ni de otro modelo, ni etiquetas que no son personas', () => {
    const anchors = [
      { name: 'Vacio', vector: [], model: MODELO },
      { name: 'Ceros', vector: new Array(DIM).fill(0), model: MODELO },
      { name: 'Otro Modelo', vector: eje(3), model: 'otro-modelo' },
      { name: 'Hablante 7', vector: eje(4), model: MODELO },
      { name: 'FLU', vector: eje(5), model: MODELO },
    ]
    expect(seedRegisteredAnchors([], anchors, { model: MODELO })).toBeNull()
  })

  it('NO siembra un ancla SIN modelo ni una de otro dtype: sin clave no es comparable', () => {
    // MEDIDO 2026-10-18: el ancla "Luis" de la base casaba a 0.44 con su propia voz porque
    // su vector (otro dtype / sin clave) se comparaba como si fuera del espacio vigente.
    expect(seedRegisteredAnchors([], [{ name: 'Luis', vector: VOZ_BASE }], { model: MODELO })).toBeNull()
    expect(
      seedRegisteredAnchors([], [{ name: 'Luis', vector: VOZ_BASE, model: `${MODELO}|q8` }], { model: `${MODELO}|fp32` }),
    ).toBeNull()
  })

  it('la SESION manda: un nombre ya vivo no se reescribe con el vector de la base', () => {
    const vivo = { label: 'Luis', signature: VOZ_MUJER, signatureHistory: [VOZ_MUJER] }
    const out = seedRegisteredAnchors([vivo], ANCLA_BASE, { model: MODELO })
    expect(out, 'sin cambios no hay nueva lista').toBeNull()
    expect(vivo.signature, 'la firma aprendida en vivo se conserva').toEqual(VOZ_MUJER)
  })

  it('es idempotente: sembrar dos veces no duplica el ancla ("solo una vez")', () => {
    const una = sembrar()
    const dos = seedRegisteredAnchors(una, [{ name: 'luis', vector: VOZ_BASE, model: MODELO }], { model: MODELO })
    expect(dos).toBeNull()
    expect(una).toHaveLength(1)
  })
})
