// ============================================================
// vozReplayDecisionDueno20261018 - REPLAY DE LA DECISION con los numeros del log REAL
// ------------------------------------------------------------
// FUENTE (log del dueno preservado, turn 19, 00:15:43.046):
//   VozProbe identity {"turn":19,"decision":"production-reuse-no-evidence","name":"Hablante 1",
//     "vec":512,"clusters":2,"evidence":false,"boundary":true,"voiced":96000,"ms":2000,
//     "lastSim":0,"bestSim":0.14374636121638906,"bestLabel":"Hablante 2",
//     "pares":[{"label":"Luis","sim":0.463},{"label":"Hablante 2","sim":0.144}]}
// DEFECTO: `lastSpeaker` era el RESPALDO ("Hablante 1") SIN cluster medido (lastSim 0) y la
// rama de reuso lo estampaba sin aprender la voz: el dueno quedo "Hablante 1" toda la sesion
// y la voz de la mujer se mezclo ahi.
// ALCANCE HONESTO: el log NO trae audio ni vectores de 512d -> no se reinyecta PCM. Este
// guard reinyecta el ESTADO y los COSENOS EXACTOS medidos, por la MISMA funcion de decision
// (`resolveConversationSpeaker`) que usa el pipeline; no es un atajo del test.
// ============================================================
import { describe, expect, it } from 'vitest'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'
import { compareCosineSignatures } from '../src/voice/lib/speakerCore.js'
import { resolveVoiceIdentity, voiceVectorModel } from '../src/voice/lib/speakerDirectory.js'

const DIM = 4
/** Eje de la voz "Luis" en la base de participantes. */
const E_LUIS = [1, 0, 0, 0]
/** Eje del cluster "Hablante 2" de la sesion. */
const E_HABLANTE_2 = [0, 1, 0, 0]

/** Vector con COSENO EXACTO medido en el log: 0.463 con Luis y 0.144 con Hablante 2. */
function vectorDelLog(): number[] {
  const luis = 0.463
  const hablante2 = 0.144
  const resto = Math.sqrt(1 - luis * luis - hablante2 * hablante2)
  return [luis, hablante2, resto, 0]
}

/** Turno sostenido del log: 2.0 s de voz (96000 muestras a 48 kHz). */
const TURNO_SOSTENIDO = {
  voicedSampleCount: 96000,
  minVoicedSamples: 12000,
  sampleRate: 48000,
  utteranceText: 'esta es una frase sostenida de prueba para medir la voz',
  atTurnBoundary: true,
  allowNewCluster: true,
}

/** Clusters del log: el respaldo sin firma y la voz anonima ya medida. */
function clustersDelLog() {
  return [
    { label: 'Hablante 1', signature: [] },
    { label: 'Hablante 2', signature: [...E_HABLANTE_2], signatureHistory: [[...E_HABLANTE_2]] },
  ]
}

function resolver(lastSpeaker: string, clusters = clustersDelLog()) {
  const diagnosis: Record<string, unknown> = {}
  const label = resolveConversationSpeaker({
    ...TURNO_SOSTENIDO,
    signatureVector: vectorDelLog(),
    speakerClusters: clusters,
    lastSpeaker,
    diagnosis,
  } as never)
  return { label, diagnosis, clusters }
}

describe('replay turn 19: el RESPALDO sin medida no se estampa', () => {
  it('DETECTOR del defecto: lastSpeaker "Hablante 1" SIN cluster medido NO se reusa; la voz abre su cluster', () => {
    const { label, diagnosis, clusters } = resolver('Hablante 1')
    expect(diagnosis.reason, 'la rama medida exige un cluster con firma').not.toBe('production-reuse-no-evidence')
    expect(label, 'el respaldo no puede quedar como identidad de una voz medida').not.toBe('Hablante 1')
    expect(label).toMatch(/^Hablante \d+$/)
    // La voz quedo APRENDIDA: su etiqueta tiene firma (antes se rotulaba sin crear cluster).
    const suyo = clusters.find((cluster) => cluster.label === label)
    expect(suyo?.signature, 'sin cluster no hay voz: era el defecto').toHaveLength(DIM)
    expect(compareCosineSignatures(suyo?.signature, vectorDelLog()), 'la firma es ESTA voz medida').toBeCloseTo(1, 10)
    // El cluster fantasma del respaldo sigue sin firma: no se le atribuyo la medida.
    expect(clusters.find((cluster) => cluster.label === 'Hablante 1')?.signature).toEqual([])
  })

  it('CONTROL del mandato: con un "Hablante 2" MEDIDO, un coseno de 0.144 es OTRA voz y NO hereda su etiqueta', () => {
    // El defecto medido era exactamente este: 0.144 se estampaba como continuidad del
    // anterior ("production-reuse-no-evidence") y dos personas quedaban bajo una etiqueta.
    // La regla del dueno es voz distinta = etiqueta distinta, sin heredar por cercania.
    const { label, diagnosis, clusters } = resolver('Hablante 2')
    expect(label, 'una voz distinta no puede conservar la etiqueta de la anterior').not.toBe('Hablante 2')
    expect(label).toBe('Hablante 3')
    expect(diagnosis.reason).toBe('production-forced-new-voice')
    expect(clusters, 'la voz distinta abre SU cluster').toHaveLength(3)
  })

  it('los 0.463 medidos contra la base NO afirman el nombre "Luis" (piso registrado 0.76)', () => {
    expect(
      resolveVoiceIdentity(vectorDelLog(), {
        candidates: [{ name: 'Luis', vector: E_LUIS, model: voiceVectorModel() }],
      }),
      'un ancla de otro dtype/modelo casaba a 0.46 y se estampaba como Luis',
    ).toBeNull()
  })
})
