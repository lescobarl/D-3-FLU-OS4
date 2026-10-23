// @vitest-environment node
/**
 * GUARD: una LOCUCION es UNA voz.
 *
 * Defecto medido (7fce0045, 2026-10-23): 8 locuciones aparecen dos veces con etiquetas
 * distintas. `#54/#55` sale "Hablante 2" y, 4,5 s despues, la misma captura se commitea otra
 * vez como "Hablante 1", y el preflight de ESA segunda fila la reescribe a "Luis Registrado":
 * una locucion, tres etiquetas. El producto no se toca aqui (Anexo B.14 prohibe la dedupe de
 * emision identica); el numero se MIDE y se reporta.
 *
 * Falsificacion: la misma frase repetida por la MISMA voz NO es un defecto.
 */
import { describe, expect, it } from 'vitest'
import { locucionesConEtiquetasDistintas, sourceRowDiff } from '../scripts/replay/compareExpected.mjs'

describe('locuciones con 2+ etiquetas en la fuente', () => {
  it('misma frase con DOS hablantes -> se mide con sus indices y etiquetas', () => {
    const filas = [
      { text: 'no tengo pruebas', speaker: 'Hablante 2' },
      { text: 'otra cosa distinta', speaker: 'Hablante 1' },
      { text: 'no tengo pruebas', speaker: 'Hablante 1' },
    ]

    const flips = locucionesConEtiquetasDistintas(filas)

    expect(flips).toHaveLength(1)
    expect(flips[0].labels).toEqual(['Hablante 2', 'Hablante 1'])
    expect(flips[0].indices).toEqual([0, 2])
  })

  it('FALSIFICACION: la misma frase repetida por la MISMA voz no es defecto', () => {
    const filas = [
      { text: 'no tengo pruebas', speaker: 'Hablante 2' },
      { text: 'no tengo pruebas', speaker: 'Hablante 2' },
    ]

    expect(locucionesConEtiquetasDistintas(filas)).toEqual([])
  })

  it('la grafia del ASR no separa la locucion (acentos y signos se ignoran)', () => {
    const filas = [
      { text: 'Qué hija, déjame acompañarte por favor', speaker: 'Hablante 2' },
      { text: 'que hija dejame acompanarte por favor', speaker: 'Hablante 1' },
    ]

    const flips = locucionesConEtiquetasDistintas(filas)

    expect(flips, 'misma locucion con otra grafia: se mide').toHaveLength(1)
  })

  it('el diff de fuente EXPONE el numero (no queda solo en la funcion)', () => {
    const fuente = [
      { text: 'hola a todos', speaker: 'Hablante 1' },
      { text: 'hola a todos', speaker: 'Hablante 2' },
    ]

    const diff = sourceRowDiff(fuente, [])

    expect(diff.speakerFlips).toHaveLength(1)
    expect(diff.sourceDuplicates).toBe(1)
  })
})
