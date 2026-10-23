// @vitest-environment node
/**
 * GUARD: en MODO MONOLOGO una fila cerrada de usuario no se queda en la etiqueta
 * pendiente ("Hablante ?") cuando hay una VOZ de la que heredar la etiqueta.
 *
 * Regla (mandato del dueno 2026-10-23):
 *  - con UN solo cluster de voz, la etiqueta de continuidad de ESA voz es la respuesta;
 *  - "?" sigue siendo legitimo cuando hay 2+ voces o no hay etiqueta que conservar;
 *  - ningun nombre propio se afirma sin `namedAssignmentConfirmed`.
 *
 * DOS EXCEPCIONES DECLARADAS (por escrito, decision del dueno 2026-10-23 — no son verdes
 * silenciosos):
 *  1. NOMBRE PROPIO sin confirmacion (aunque su ancla este verificada y sea la unica voz):
 *     la continuidad NO lo afirma; la fila queda en "?". La confirmacion exige la MEDIDA del
 *     turno contra el ancla, y en un turno sin medida no existe. Preferimos "?" a estampar un
 *     nombre por continuidad (es el defecto medido de la mujer saliendo "Luis").
 *  2. CERO clusters medidos y CERO etiqueta en el historial: no hay ninguna voz de la que
 *     heredar, asi que "?" es la respuesta correcta (no se inventa "Hablante 1").
 */
import { describe, expect, it } from 'vitest'
import {
  continuityLabelForMonologue,
  resolveConversationSpeaker,
} from '../src/voice/lib/speakerDiarization.js'
import { pendingSpeakerLabel } from '../src/voice/lib/speakerLabels.js'
import { resolvePendingSpeakerRows } from '../src/voice/lib/conversationTurnRow'
import { useIntegrationStore } from '../src/store/integrationStore'

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

/**
 * GUARD del mandato: en MONOLOGO la etiqueta final NUNCA puede ser la pendiente.
 * Es la barrera con su falsificacion: alimentarla con `?` la pone roja.
 * @param label etiqueta que devolvio el resolutor
 */
function exigirEtiquetaFinalDeMonologo(label: string) {
  if (label === PENDING) throw new Error(`monologo con etiqueta pendiente: "${label}"`)
}

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

  it('la continuidad se elige por INDICE numerico, no por orden textual', () => {
    // `.sort()` textual colocaria "Hablante 10" antes que "Hablante 2" (auditoria 2026-10-23).
    // Con la MISMA firma los dos clusters son la misma voz -> monologo; manda el de menor indice.
    expect(
      continuityLabelForMonologue([
        { label: 'Hablante 10', signature: [...LUIS] },
        { label: 'Hablante 2', signature: [...LUIS] },
      ]),
    ).toBe('Hablante 2')
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
      exigirEtiquetaFinalDeMonologo(label)
    }
  })

  it('G U A R D (mutacion): forzar el pendiente pone rojo el detector', () => {
    // Falsificacion del guard: si un camino devolviera `?`, `exigirEtiquetaFinalDeMonologo`
    // lanza. Sin esto el guard podria pasar sin medir nada.
    expect(() => exigirEtiquetaFinalDeMonologo(PENDING)).toThrow(/pendiente/)
    expect(() => exigirEtiquetaFinalDeMonologo('Hablante 1')).not.toThrow()
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

  it('EXCEPCION DECLARADA: ancla verificada unica SIN medida -> "?" (no se afirma el nombre)', () => {
    const clusters = [{ label: 'Luis', signature: [...LUIS], anchorVerified: true }]
    const label = resolver([], clusters)
    // Se conserva "?" a proposito: afirmar "Luis" por continuidad es exactamente el defecto
    // medido (la mujer con la etiqueta del dueno). Ver la cabecera del guard, excepcion 1.
    expect(label, 'sin medida del turno no hay confirmacion de nombre').not.toBe('Luis')
    expect(label).toBe(PENDING)
  })
})

describe('fila CERRADA (capa de escritura) en monologo', () => {
  it('la fila pendiente de un MONOLOGO se resuelve a la etiqueta de la unica voz', () => {
    useIntegrationStore.setState({
      conversationHistory: [
        {
          id: 'r-pend',
          role: 'user',
          text: 'frase del monologo sin medida',
          timestamp: 1,
          speakerId: 'speaker_1',
          speakerName: PENDING,
          signature: [...LUIS],
        },
      ],
      conversationEpoch: 0,
    })
    const cambiadas = resolvePendingSpeakerRows([{ label: 'Hablante 1', signature: [...LUIS] }])
    expect(cambiadas).toBe(1)
    expect(String(useIntegrationStore.getState().conversationHistory[0].speakerName || '')).toBe('Hablante 1')
  })

  it('G U A R D: con DOS voces (firma por debajo del piso) la fila SIGUE pendiente', () => {
    useIntegrationStore.setState({
      conversationHistory: [
        {
          id: 'r-otra',
          role: 'user',
          text: 'frase de otra voz',
          timestamp: 1,
          speakerId: 'speaker_1',
          speakerName: PENDING,
          signature: [...MUJER],
        },
      ],
      conversationEpoch: 0,
    })
    const cambiadas = resolvePendingSpeakerRows([{ label: 'Hablante 1', signature: [...LUIS] }])
    expect(cambiadas).toBe(0)
    expect(String(useIntegrationStore.getState().conversationHistory[0].speakerName || '')).toBe(PENDING)
  })

  it('la PRIMERA fila (sin historial con etiqueta y SIN firma) sale por la continuidad del cluster', () => {
    // Auditoria 2026-10-23: la rama solo miraba `etiquetaUnicaDeLaSesion`; con la primera fila
    // no hay historial con etiqueta y la fila se quedaba en "?". Ahora cae a
    // `continuityLabelForMonologue(clusters)`, el dueño de la continuidad de la unica voz.
    useIntegrationStore.setState({
      conversationHistory: [
        {
          id: 'r-primera',
          role: 'user',
          text: 'primera frase del monologo',
          timestamp: 1,
          speakerId: 'speaker_1',
          speakerName: PENDING,
        },
      ],
      conversationEpoch: 0,
    })
    const cambiadas = resolvePendingSpeakerRows([{ label: 'Hablante 1', signature: [...LUIS] }])
    expect(cambiadas).toBe(1)
    expect(String(useIntegrationStore.getState().conversationHistory[0].speakerName || '')).toBe('Hablante 1')
  })

  it('EXCEPCION DECLARADA: primera fila sin cluster MEDIDO ni etiqueta en el historial -> "?"', () => {
    // No hay ninguna voz de la que heredar (0 clusters medidos) ni historial con etiqueta: la
    // unica respuesta honesta es la pendiente. Ver la cabecera del guard, excepcion 2.
    useIntegrationStore.setState({
      conversationHistory: [
        {
          id: 'r-sin-evidencia',
          role: 'user',
          text: 'primera frase sin evidencia',
          timestamp: 1,
          speakerName: PENDING,
        },
      ],
      conversationEpoch: 0,
    })

    const cambiadas = resolvePendingSpeakerRows([{ label: 'Hablante 1' }])
    expect(cambiadas).toBe(0)
    expect(String(useIntegrationStore.getState().conversationHistory[0].speakerName || '')).toBe(PENDING)
  })
})
