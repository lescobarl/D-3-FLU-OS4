// @vitest-environment node
/**
 * GUARD: en MODO MONOLOGO una fila cerrada de usuario nunca se queda en la etiqueta
 * pendiente ("Hablante ?").
 *
 * Regla (mandato del dueno 2026-10-23):
 *  - con UN solo cluster de voz, la etiqueta de continuidad de ESA voz es la respuesta;
 *  - "?" sigue siendo legitimo cuando hay 2+ voces o no hay etiqueta que conservar;
 *  - ningun nombre propio se afirma sin `namedAssignmentConfirmed`.
 */
import { describe, expect, it } from 'vitest'
import {
  continuityLabelForMonologue,
  resolveConversationSpeaker,
} from '../src/voice/lib/speakerDiarization.js'
import { pendingSpeakerLabel } from '../src/voice/lib/speakerLabels.js'

const unit = (pairs: Array<[number, number]>) => {
  const v = new Array(512).fill(0)
  for (const [i, x] of pairs) v[i] = x
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / norm)
}
const LUIS = unit([[0, 1]])
const MUJER = unit([[0, 0.5], [1, Math.sqrt(0.75)]])

function resolver(
  vector: number[],
  clusters: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  return resolveConversationSpeaker({
    signatureVector: vector,
    speakerClusters: clusters,
    lastSpeaker: '',
    lastSignature: null,
    voicedSampleCount: 96000,
    sampleRate: 48000,
    utteranceText: 'esta es una frase larga para medir la voz del turno',
    atTurnBoundary: true,
    allowNewCluster: false,
    ...extra,
  } as never)
}

const PENDING = pendingSpeakerLabel()

describe('continuidad de monologo', () => {
  it('un solo cluster CON MEDIDA con etiqueta automatica -> esa etiqueta', () => {
    expect(continuityLabelForMonologue([{ label: 'Hablante 1', signature: [...LUIS] }])).toBe('Hablante 1')
  })

  it('un cluster SIN MEDIDA no parte el monologo (no es una voz comparable)', () => {
    expect(
      continuityLabelForMonologue([
        { label: 'Hablante 1', signature: [...LUIS] },
        { label: 'Hablante 2', signature: [] },
      ]),
    ).toBe('Hablante 1')
  })

  it('un cluster PENDIENTE no sirve de continuidad', () => {
    expect(continuityLabelForMonologue([{ label: PENDING }])).toBe('')
  })

  it('dos clusters -> no se fuerza etiqueta', () => {
    expect(continuityLabelForMonologue([{ label: 'Hablante 1' }, { label: 'Hablante 2' }])).toBe('')
  })

  it('un NOMBRE propio sin ancla verificada no es continuidad de monologo', () => {
    expect(continuityLabelForMonologue([{ label: 'Luis', signature: [...LUIS] }])).toBe('')
  })
})

describe('resolutor en monologo (mutacion: hasVoiceMeasurement = false)', () => {
  it('vector VACIO con un solo cluster -> continuidad, no "?"', () => {
    const label = resolver([], [{ label: 'Hablante 1', signature: [...LUIS] }])
    expect(label, 'sin medida no hay identidad, pero en monologo si hay continuidad').toBe('Hablante 1')
    expect(label).not.toBe(PENDING)
  })

  it('G U A R D: ningun camino de monologo deja la fila en "?"', () => {
    const clusters = [{ label: 'Hablante 1', signature: [...LUIS] }]
    const vectores: number[][] = [
      [],
      new Array(512).fill(0),
      LUIS,
      MUJER,
      unit([[0, 0.62], [1, 0.78]]),
    ]
    for (const vector of vectores) {
      const label = resolver(vector, clusters)
      expect(label, `monologo con vector de ${vector.length} no puede quedar en "?"`).not.toBe(PENDING)
      expect(label, 'y no inventa otro hablante').toBe('Hablante 1')
    }
  })

  it('DOS voces: "?" sigue siendo legitimo (no se fuerza la etiqueta)', () => {
    const clusters = [
      { label: 'Hablante 1', signature: [...LUIS] },
      { label: 'Hablante 2', signature: [...MUJER] },
    ]
    const label = resolver([], clusters)
    expect(label).toBe(PENDING)
  })

  it('sin namedAssignmentConfirmed no se afirma un nombre propio SIN ancla verificada', () => {
    const clusters = [{ label: 'Luis', signature: [...LUIS] }]
    const label = resolver([], clusters)
    expect(label, 'sin ancla verificada no se afirma "Luis"').not.toBe('Luis')
    expect(label).toBe(PENDING)
  })

  it('ANCLA VERIFICADA unica: la continuidad es su nombre (no se inventa etiqueta)', () => {
    const clusters = [{ label: 'Luis', signature: [...LUIS], anchorVerified: true }]
    expect(resolver([], clusters)).toBe('Luis')
  })
})
