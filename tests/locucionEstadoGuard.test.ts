// @vitest-environment node
/**
 * GUARD del ESTADO DE LA LOCUCIÓN (dos preguntas, no un `||`).
 *
 * Falla si alguien vuelve a mezclar «el ASR reemitió el mismo audio» con «el dictado creció»:
 * son preguntas distintas y el estado las responde por separado.
 */
import { describe, expect, it } from 'vitest'
import { estadoDeLocucion } from '../src/voice/core/locucion.js'

describe('estadoDeLocucion: revisión y crecimiento son preguntas DISTINTAS', () => {
  it('CRECIMIENTO: el dictado sigue y contiene lo anterior (no es locución nueva)', () => {
    const estado = estadoDeLocucion('Qué pasó', 'Qué pasó el juez me sacó')
    expect(estado.crecimiento).toBe(true)
    expect(estado.locucionNueva).toBe(false)
  })

  it('REVISIÓN del ASR: mismo audio, otra grafía (no es locución nueva)', () => {
    const estado = estadoDeLocucion('no vayas a hacer una tontería', 'no vayas a hacer una tontera')
    expect(estado.mismaRevision).toBe(true)
    expect(estado.locucionNueva).toBe(false)
  })

  it('MUTACIÓN: dos locuciones distintas NO son revisión ni crecimiento', () => {
    const estado = estadoDeLocucion('Qué pasó', 'no vayas a hacer una tontería')
    expect(estado.mismaRevision).toBe(false)
    expect(estado.crecimiento).toBe(false)
    expect(estado.locucionNueva).toBe(true)
  })

  it('sin texto anterior o sin texto nuevo no hay estado (no se inventa)', () => {
    expect(estadoDeLocucion('', 'hola')).toEqual({ mismaRevision: false, crecimiento: false, locucionNueva: false })
    expect(estadoDeLocucion('hola', '')).toEqual({ mismaRevision: false, crecimiento: false, locucionNueva: false })
  })
})
