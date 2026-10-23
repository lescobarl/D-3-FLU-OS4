// @vitest-environment node
/**
 * GUARD de la CONTINUIDAD de etiqueta (mandato del dueno 2026-10-23): ninguna fila CERRADA
 * de usuario se queda en la etiqueta pendiente ("Hablante ?").
 *
 * Dueno unico de la decision: `continuityLabelForTurn` (speakerDiarization.js). Orden:
 *  1. monologo / sin clusters medidos -> la etiqueta de la unica voz;
 *  2. la etiqueta AUTOMATICA del turno anterior;
 *  3. la PRIMERA etiqueta automatica de la sesion;
 *  4. sin ninguna etiqueta anonima -> la primera del vocabulario.
 * NUNCA devuelve un nombre propio por continuidad (eso exige `namedAssignmentConfirmed`).
 *
 * Falsificacion en los dos sentidos: con una sola voz la etiqueta es SUYA; con dos voces la
 * continuidad es la del turno anterior, no la de cualquier otra persona.
 */
import { describe, expect, it } from 'vitest'
import { continuityLabelForTurn } from '../src/voice/lib/speakerDiarization.js'
import { pendingSpeakerLabel } from '../src/voice/lib/speakerLabels'

const PENDING = pendingSpeakerLabel()

/** Vector unitario de 4 dimensiones (la medida no depende de la dimension). */
function unit(pairs: Array<[number, number]>): number[] {
  const v = new Array(4).fill(0)
  for (const [i, x] of pairs) v[i] = x
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / n)
}

const VOZ_A = unit([[0, 1]])
const VOZ_B = unit([[1, 1]])

describe('continuityLabelForTurn: la fila cerrada nunca queda en "?"', () => {
  it('MONOLOGO (una sola voz medida): la etiqueta es la de esa voz', () => {
    const label = continuityLabelForTurn([{ label: 'Hablante 1', signature: [...VOZ_A] }], { lastSpeaker: '' })
    expect(label).toBe('Hablante 1')
    expect(label).not.toBe(PENDING)
  })

  it('SIN clusters medidos: la continuidad es la etiqueta automatica del turno anterior', () => {
    expect(continuityLabelForTurn([], { lastSpeaker: 'Hablante 2' })).toBe('Hablante 2')
  })

  it('DOS voces: la continuidad es la del TURNO ANTERIOR (no la de otra persona)', () => {
    const clusters = [
      { label: 'Hablante 1', signature: [...VOZ_A] },
      { label: 'Hablante 2', signature: [...VOZ_B] },
    ]
    expect(continuityLabelForTurn(clusters, { lastSpeaker: 'Hablante 2' })).toBe('Hablante 2')
    expect(continuityLabelForTurn(clusters, { lastSpeaker: 'Hablante 1' })).toBe('Hablante 1')
  })

  it('MUTACION: un NOMBRE PROPIO como ultimo hablante NO se hereda (exige medida)', () => {
    const clusters = [
      { label: 'Luis', signature: [...VOZ_A] },
      { label: 'Hablante 1', signature: [...VOZ_B] },
    ]
    const label = continuityLabelForTurn(clusters, { lastSpeaker: 'Luis' })
    expect(label, 'un nombre propio no se afirma por continuidad').not.toBe('Luis')
    expect(label).toBe('Hablante 1')
  })

  it('MUTACION: sesion SOLO de nombres -> la primera etiqueta anonima del vocabulario', () => {
    const clusters = [{ label: 'Luis', signature: [...VOZ_A], anchorVerified: true }]
    const label = continuityLabelForTurn(clusters, { lastSpeaker: 'Luis' })
    expect(label).not.toBe('Luis')
    expect(label).not.toBe(PENDING)
    expect(label).toBe('Hablante 1')
  })

  it('G U A R D: la etiqueta pendiente NUNCA sale de aqui', () => {
    const casos: Array<[Array<Record<string, unknown>>, string]> = [
      [[], ''],
      [[], 'Hablante ?'],
      [[{ label: 'Hablante 1', signature: [...VOZ_A] }], 'Hablante ?'],
      [[{ label: 'Luis', signature: [...VOZ_A] }], 'Luis'],
    ]
    for (const [clusters, lastSpeaker] of casos) {
      const label = continuityLabelForTurn(clusters as never, { lastSpeaker })
      expect(label, `caso last=${lastSpeaker}`).not.toBe(PENDING)
    }
  })
})
