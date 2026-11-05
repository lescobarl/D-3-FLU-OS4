// ============================================================
// recordCopy - CONDUCTA de la copia superficial de una fila.
//
// `copyRecord` es el punto unico que usan los servicios core para
// entregar copias de las filas de Dexie sin mutar el objeto original.
// Aqui se mide SOLO esa conducta observable: identidad nueva,
// mismos valores, aislamiento de nivel 1 y (lo deliberado) que la
// copia es SUPERFICIAL: los valores anidados se comparten.
// ============================================================
import { describe, it, expect } from 'vitest'

import { copyRecord } from '../src/core/db/recordCopy'

interface NotaRow {
  id: string
  label: string
  body?: string
  done?: boolean
  createdAt?: number
}

describe('copyRecord - copia superficial de una fila persistida', () => {
  it('devuelve un objeto NUEVO (identidad distinta del original)', () => {
    const fila = { id: 'n1', label: 'Super' }
    const copia = copyRecord(fila)

    expect(copia).not.toBe(fila)
    expect(copia).toEqual(fila)
  })

  it('conserva todas las claves y valores de la fila', () => {
    const fila: NotaRow = { id: 'n1', label: 'Super', body: 'cloro\npan', done: false, createdAt: 123 }

    expect(copyRecord(fila)).toEqual(fila)
  })

  it('mutar la copia NO afecta a la fila original (aislamiento de nivel 1)', () => {
    const fila: NotaRow = { id: 'n1', label: 'Super', body: 'cloro' }
    const copia = copyRecord(fila)

    copia.label = 'Otra'
    copia.body = 'pan'

    expect(fila.label).toBe('Super')
    expect(fila.body).toBe('cloro')
  })

  it('mutar el original NO afecta a la copia ya entregada', () => {
    const fila: NotaRow = { id: 'n1', label: 'Super' }
    const copia = copyRecord(fila)

    fila.label = 'Cambiada'

    expect(copia.label).toBe('Super')
  })

  it('la copia es SUPERFICIAL: los valores anidados se comparten por referencia', () => {
    const fila = { id: 'n1', meta: { tags: ['a'] } }
    const copia = copyRecord(fila)

    expect(copia.meta).toBe(fila.meta)
    copia.meta.tags.push('b')
    expect(fila.meta.tags).toEqual(['a', 'b'])
  })

  it('conserva valores falsy (0, false, null, undefined) sin perderlos', () => {
    const fila = { id: 'n1', done: false, count: 0, nota: null as string | null, extra: undefined as string | undefined }
    const copia = copyRecord(fila)

    expect(copia.done).toBe(false)
    expect(copia.count).toBe(0)
    expect(copia.nota).toBeNull()
    expect('extra' in copia).toBe(true)
    expect(copia.extra).toBeUndefined()
  })

  it('copia un objeto vacio a otro objeto vacio', () => {
    const copia = copyRecord({})
    expect(copia).toEqual({})
    expect(Object.keys(copia)).toHaveLength(0)
  })

  it('una instancia de clase pierde su prototipo: la copia es un objeto plano', () => {
    class Fila {
      id = 'n1'
      saludar() { return 'hola' }
    }
    const copia = copyRecord(new Fila())

    expect(Object.getPrototypeOf(copia)).toBe(Object.prototype)
    expect((copia as { saludar?: unknown }).saludar).toBeUndefined()
    expect(copia.id).toBe('n1')
  })

  it('un getter de instancia se materializa como valor plano en la copia', () => {
    const fila = {
      id: 'n1',
      get label() { return 'Super' },
    }
    const copia = copyRecord(fila)

    // La copia guarda el VALOR, no el acceso: reasignar el getter en el
    // original no cambia lo ya copiado.
    expect(copia.label).toBe('Super')
    const copiaConCampo = copia as Record<string, unknown>
    expect(Object.getOwnPropertyDescriptor(copiaConCampo, 'label')?.get).toBeUndefined()
  })
})
