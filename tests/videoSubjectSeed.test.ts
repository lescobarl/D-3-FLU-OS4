/**
 * C66 - la semilla del sujeto de video se DERIVA, no se sortea.
 *
 * EVIDENCIA MEDIDA (por que existe este guard): el pipeline visual deriva la semilla del
 * prompt (buildPollinationsArtifact -> hashPromptSeed(seedInput || prompt)) y la ruta de
 * imagen hace lo mismo (imageGeneration.js:101). La ruta de VIDEO era la excepcion:
 * sembraba con Math.floor(Math.random() * 999999), asi que dos peticiones del mismo video
 * daban imagenes distintas e irreproducibles: DOS POLITICAS DE SEMILLA para lo mismo.
 *
 * REGLA VIGILADA: pedir dos veces lo mismo produce la MISMA URL (determinista).
 */
import { describe, expect, it } from 'vitest'
import { buildSubjectImageUrl } from '../src/services/videoAssembler'

const PROMPT = 'un conejo saltando'

describe('C66 - semilla del sujeto de video derivada del prompt', () => {
  it('la misma peticion produce la MISMA URL (determinista)', () => {
    const a = buildSubjectImageUrl(PROMPT)
    const b = buildSubjectImageUrl(PROMPT)
    expect(a, 'la URL no deberia quedar vacia').not.toBe('')
    expect(a, 'la URL deberia llevar semilla').toMatch(/seed=\d+/)
    expect(b, 'dos peticiones identicas deben dar la misma URL').toBe(a)
  })

  it('prompts distintos dan URLs distintas (la semilla depende del texto)', () => {
    expect(buildSubjectImageUrl(PROMPT)).not.toBe(buildSubjectImageUrl('un gato durmiendo'))
  })
})
