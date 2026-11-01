// @vitest-environment node
/**
 * ALMACÉN REAL Dexie del módulo CONVERSACIÓN.
 *
 * Usa `fake-indexeddb` (devDependency existente) y la ÚNICA tabla de
 * conversación del producto (`conversations`, v26). Fija: upsert idempotente
 * por `locutionId` (id de la fila), UUID, tupla `[revision, updated_at, deleted]`,
 * borrado lógico y consulta por `sessionId` indexado.
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
    firma: null,
    idioma: 'es',
    overlap: false,
    provisional: false,
    reason: 'user',
    ...overrides,
  }
}

describe('almacén Dexie de filas de conversación', () => {
  beforeEach(async () => {
    await fluDb.conversations.clear()
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
    const crudo = await fluDb.conversations.get(LOCUTION_ID)
    expect(crudo?.sync).toEqual({
      revision: 1,
      updated_at: '2023-11-14T22:13:21.000Z',
      deleted: false,
    })
    expect(crudo?.sessionId).toBe('sesion-1')
    expect(crudo?.meta?.conversacion).toEqual({
      tramo: { inicio: 16_000, fin: 32_000 },
      sampleRate: 16_000,
      turnId: 'turno-1',
      etiqueta: 'Hablante 1',
      evidencia: 'semilla',
      idioma: 'es',
      overlap: false,
      provisional: false,
      reason: 'user',
    })
  })

  it('repetir el mismo locutionId es upsert: una fila y revisión incremental', async () => {
    const almacen = crearAlmacenDexieProducto({ reloj: crearReloj() })
    await almacen.guardar(filaNueva())
    const segunda = await almacen.guardar(filaNueva({ texto: 'hola otra vez' }))

    expect(segunda.revision).toBe(2)
    expect(segunda.texto).toBe('hola otra vez')
    expect(await fluDb.conversations.count()).toBe(1)
  })

  it('actualizar reetiqueta el hablante y su firma; texto y tramo quedan inmutables', async () => {
    const almacen = crearAlmacenDexieProducto({ reloj: crearReloj() })
    const original = await almacen.guardar(filaNueva())
    // Mandato del dueño 2026-10-30: el único campo actualizable es el hablante.
    const actualizada = await almacen.actualizar(LOCUTION_ID, {
      etiqueta: 'Luis',
      evidencia: 'medida',
      firma: [0.5, 0.25, 0.75],
    })

    expect(actualizada).toMatchObject({
      etiqueta: 'Luis',
      evidencia: 'medida',
      firma: [0.5, 0.25, 0.75],
      revision: 2,
    })
    expect(actualizada).toMatchObject({
      texto: original.texto,
      tramo: original.tramo,
      deleted: false,
    })
    expect(await fluDb.conversations.count()).toBe(1)
    const crudo = await fluDb.conversations.get(LOCUTION_ID)
    expect(crudo?.sync.revision).toBe(2)
    expect(crudo?.sync.deleted).toBe(false)
    expect(crudo?.text).toBe('hola flu')
    expect(crudo?.signature).toEqual([0.5, 0.25, 0.75])
  })

  it('sessionId indexado separa las filas de cada sesión', async () => {
    const almacen = crearAlmacenDexieProducto({ reloj: crearReloj() })
    await almacen.guardar(filaNueva())
    await almacen.guardar(
      filaNueva({
        locutionId: '00000000-0000-4000-8000-000000000043',
        sessionId: 'sesion-2',
      }),
    )

    const sesion1 = await fluDb.conversations.where('sessionId').equals('sesion-1').toArray()
    const sesion2 = await fluDb.conversations.where('sessionId').equals('sesion-2').toArray()
    expect(sesion1.map((fila) => fila.id)).toEqual([LOCUTION_ID])
    expect(sesion2.map((fila) => fila.id)).toEqual(['00000000-0000-4000-8000-000000000043'])
  })

  it('actualizar una locución inexistente devuelve null sin escribir', async () => {
    const almacen = crearAlmacenDexieProducto({ reloj: crearReloj() })
    expect(await almacen.actualizar('00000000-0000-4000-8000-000000000099', { etiqueta: 'Luis' })).toBeNull()
    expect(await fluDb.conversations.count()).toBe(0)
  })
})
