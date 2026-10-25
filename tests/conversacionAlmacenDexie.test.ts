// @vitest-environment node
/**
 * ALMACÉN REAL Dexie del módulo CONVERSACIÓN.
 *
 * Usa `fake-indexeddb` (devDependency existente) y la MISMA tabla que el
 * producto (`conversationFilas`, v25). Fija: upsert idempotente por
 * `locutionId`, UUID, tupla `[revision, updated_at, deleted]` y borrado lógico.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearAlmacenDexieProducto } from '../src/voice/conversation/index'
import type { FilaNueva } from '../src/voice/conversation/ports'

const LOCUTION_ID = '00000000-0000-4000-8000-000000000042'

/** Reloj controlado: cada lectura avanza un segundo. */
function crearReloj() {
  let ahora = 1_700_000_000_000
  return {
    ahora: () => {
      ahora += 1_000
      return ahora
    },
  }
}

/** Fila lista para el almacén, con la forma exacta del dominio. */
function filaNueva(overrides: Partial<FilaNueva> = {}): FilaNueva {
  return {
    locutionId: LOCUTION_ID,
    sessionId: 'sesion-1',
    turnId: 'turno-1',
    texto: 'hola flu',
    tramo: { inicio: 16_000, fin: 32_000, sampleRate: 16_000 },
    etiqueta: 'Hablante 1',
    evidencia: 'semilla',
    idioma: 'es',
    overlap: false,
    provisional: false,
    reason: 'user',
    ...overrides,
  }
}

describe('almacén Dexie de filas de conversación', () => {
  beforeEach(async () => {
    await fluDb.conversationFilas.clear()
  })

  it('guarda una fila con UUID y tupla canónica', async () => {
    const almacen = crearAlmacenDexieProducto({ reloj: crearReloj() })
    const fila = await almacen.guardar(filaNueva())

    expect(fila).toMatchObject({
      locutionId: LOCUTION_ID,
      revision: 1,
      deleted: false,
      etiqueta: 'Hablante 1',
    })
    expect(new Date(fila.updated_at).toISOString()).toBe('2023-11-14T22:13:21.000Z')
    const crudo = await fluDb.conversationFilas.get(LOCUTION_ID)
    expect(crudo?.sync).toEqual({
      revision: 1,
      updated_at: '2023-11-14T22:13:21.000Z',
      deleted: false,
    })
  })

  it('repetir el mismo locutionId es upsert: una fila y revisión incremental', async () => {
    const almacen = crearAlmacenDexieProducto({ reloj: crearReloj() })
    await almacen.guardar(filaNueva())
    const segunda = await almacen.guardar(filaNueva({ texto: 'hola otra vez' }))

    expect(segunda.revision).toBe(2)
    expect(segunda.texto).toBe('hola otra vez')
    expect(await almacen.leerSesion('sesion-1')).toHaveLength(1)
    expect(await fluDb.conversationFilas.count()).toBe(1)
  })

  it('actualizar incrementa revisión y el borrado es lógico', async () => {
    const almacen = crearAlmacenDexieProducto({ reloj: crearReloj() })
    await almacen.guardar(filaNueva())
    const actualizada = await almacen.actualizar(LOCUTION_ID, {
      texto: 'hola flu corregido',
      deleted: true,
    })

    expect(actualizada).toMatchObject({
      texto: 'hola flu corregido',
      revision: 2,
      deleted: true,
    })
    expect(await fluDb.conversationFilas.count()).toBe(1)
    expect(await almacen.leerSesion('sesion-1')).toHaveLength(1)
  })

  it('leerSesion filtra por sesión y no devuelve filas ajenas', async () => {
    const almacen = crearAlmacenDexieProducto({ reloj: crearReloj() })
    await almacen.guardar(filaNueva())
    await almacen.guardar(
      filaNueva({
        locutionId: '00000000-0000-4000-8000-000000000043',
        sessionId: 'sesion-2',
      }),
    )

    expect(await almacen.leerSesion('sesion-1')).toHaveLength(1)
    expect(await almacen.leerSesion('sesion-2')).toHaveLength(1)
  })

  it('actualizar una locución inexistente devuelve null sin escribir', async () => {
    const almacen = crearAlmacenDexieProducto({ reloj: crearReloj() })
    expect(await almacen.actualizar('00000000-0000-4000-8000-000000000099', { texto: 'x' })).toBeNull()
    expect(await fluDb.conversationFilas.count()).toBe(0)
  })
})
