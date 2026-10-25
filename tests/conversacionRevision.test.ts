// @vitest-environment node
/**
 * REGLA 3 — revisión de la locución por `tramoId`.
 *
 * Cada caso falla si se quita la rama que mide: extensión por más palabras,
 * revisión por las mismas palabras, guarda de no-pérdida y locución nueva.
 * La unidad es la palabra: un texto con menos palabras no se pinta aunque tenga
 * más caracteres.
 */
import { describe, expect, it } from 'vitest'
import { decidirRevision } from '../src/voice/conversation/revision'
import type {
  DecisionRevision,
  TramoAbierto,
} from '../src/voice/conversation/revision'

const abierto = (id: string, texto: string): TramoAbierto => ({ id, texto })

const decidir = (
  tramoAbierto: TramoAbierto | null,
  tramoId: string,
  texto: string,
  final = false,
): DecisionRevision => decidirRevision({ tramoAbierto, tramoId, texto, final })

describe('regla 3 — mismo tramo, revisa o extiende', () => {
  it('más palabras extiende aunque cambie la primera palabra (prefijo no obligatorio)', () => {
    expect(decidir(abierto('t1', 'hola mundo'), 't1', 'adios mundo entero')).toEqual({
      tipo: 'extiende',
      texto: 'adios mundo entero',
      pintar: true,
      completa: false,
    })
  })

  it('las mismas palabras revisan y permiten reemplazar', () => {
    expect(decidir(abierto('t1', 'hola mundo'), 't1', 'hola amigo')).toEqual({
      tipo: 'revisa',
      texto: 'hola amigo',
      pintar: true,
      completa: false,
    })
  })

  it('una revisión que pierde palabras NO se pinta: conserva el texto anterior', () => {
    expect(decidir(abierto('t1', 'hola mundo entero'), 't1', 'hola mundo')).toEqual({
      tipo: 'revisa',
      texto: 'hola mundo entero',
      pintar: false,
      completa: false,
    })
  })

  it('un final que pierde palabras completa con la mejor versión, sin pintar la pérdida', () => {
    expect(decidir(abierto('t1', 'hola mundo entero'), 't1', 'hola mundo', true)).toEqual({
      tipo: 'revisa',
      texto: 'hola mundo entero',
      pintar: false,
      completa: true,
    })
  })

  it('un texto vacío no borra la locución abierta', () => {
    expect(decidir(abierto('t1', 'hola'), 't1', '   ')).toEqual({
      tipo: 'revisa',
      texto: 'hola',
      pintar: false,
      completa: false,
    })
  })

  it('mide palabras, no caracteres: una palabra larga no es más larga que dos cortas', () => {
    expect(decidir(abierto('t1', 'a b'), 't1', 'supercalifragilistico')).toEqual({
      tipo: 'revisa',
      texto: 'a b',
      pintar: false,
      completa: false,
    })
  })

  it('dos palabras cortas sí extienden a una larga', () => {
    expect(decidir(abierto('t1', 'supercalifragilistico'), 't1', 'a b')).toEqual({
      tipo: 'extiende',
      texto: 'a b',
      pintar: true,
      completa: false,
    })
  })
})

describe('regla 3 — tramo distinto abre locución nueva', () => {
  it('otro tramo no se mezcla con el abierto', () => {
    expect(decidir(abierto('t1', 'hola mundo'), 't2', 'buenas')).toEqual({
      tipo: 'nueva',
      texto: 'buenas',
      pintar: true,
      completa: false,
    })
  })

  it('el final de otro tramo abre y completa', () => {
    expect(decidir(abierto('t1', 'hola mundo'), 't2', 'buenas', true)).toEqual({
      tipo: 'nueva',
      texto: 'buenas',
      pintar: true,
      completa: true,
    })
  })

  it('sin locución abierta, el primer resultado abre', () => {
    expect(decidir(null, 't1', 'hola', true)).toEqual({
      tipo: 'nueva',
      texto: 'hola',
      pintar: true,
      completa: true,
    })
  })
})

describe('regla 3 — contrato de entrada', () => {
  it('sin tramoId no hay locución', () => {
    expect(() => decidir(null, '   ', 'hola')).toThrow(/tramoId/)
  })

  it('no muta la entrada', () => {
    const tramo = Object.freeze({ id: 't1', texto: 'hola mundo' })
    const entrada = Object.freeze({
      tramoAbierto: tramo,
      tramoId: 't1',
      texto: 'hola',
      final: true,
    })
    const antes = JSON.stringify(entrada)
    const decision: DecisionRevision = decidirRevision(entrada)
    expect(JSON.stringify(entrada)).toBe(antes)
    expect(decision.texto).toBe('hola mundo')
  })
})
