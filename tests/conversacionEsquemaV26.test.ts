// @vitest-environment node
/**
 * ESQUEMA v26 — un solo almacén de conversación.
 *
 * Dos hechos, dos aserciones:
 *  1. ni las tablas reales de Dexie ni `schemaTableNames()` declaran
 *     `conversationFilas` (y sí conservan `conversations`);
 *  2. la entrada v26 de `DEXIE_VERSIONS` da de baja `conversationFilas: null`.
 * El dato se lee del esquema (no de una copia literal en el test).
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DEXIE_VERSIONS, fluDb, schemaTableNames } from '../src/core/db/fluDatabase'

describe('esquema v26 — conversationFilas se retira', () => {
  it('db.tables y schemaTableNames quedan sin conversationFilas', async () => {
    await fluDb.open()
    const conversacion = {
      db: fluDb.tables.map((tabla) => tabla.name).filter((nombre) => nombre.startsWith('conversation')),
      schema: schemaTableNames().filter((nombre) => nombre.startsWith('conversation')),
    }
    expect(conversacion).toEqual({
      db: ['conversations'],
      schema: ['conversations'],
    })
  })

  it('la entrada v26 de DEXIE_VERSIONS declara conversationFilas: null', () => {
    const v26 = DEXIE_VERSIONS.find(({ version }) => version === 26)
    if (!v26) throw new Error('DEXIE_VERSIONS no declara la version 26')
    expect(v26.stores.conversationFilas).toBeNull()
  })
})
