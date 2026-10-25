// @vitest-environment node
/**
 * UPGRADE REAL v25 → v26 con fake-indexeddb.
 *
 * La instancia A declara SOLO v25 y escribe en `conversationFilas` y en
 * `conversations`. La instancia B se abre sobre la MISMA base declarando v25 Y
 * v26: ahí Dexie ejecuta el upgrade. Declarar solo v26 habría creado una base
 * nueva y el test habría pasado sin migrar nada.
 *
 * Se comprueba que la v26 retira `conversationFilas` (en `db.tables` y en
 * `schemaTableNames()`), que la fila de `conversations` escrita en v25 SOBREVIVE
 * (hubo migración, no creación limpia) y que `conversations` sigue escribiendo.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DEXIE_VERSIONS, schemaTableNames } from '../src/core/db/fluDatabase'

const NOMBRE_BASE = 'flu-os3-upgrade-v25-v26'

/** Esquema de la v25 tal como estaba: conversations heredada + conversationFilas. */
const ESQUEMA_V25 = {
  conversations: 'id, role, timestamp, speakerId, participantId',
  conversationFilas: 'locutionId, sessionId',
}

/** Entrada real de una versión del esquema (dato, no copia literal del test). */
function versionDe(version: number): { version: number; stores: Record<string, string | null> } {
  const entrada = DEXIE_VERSIONS.find((candidata) => candidata.version === version)
  if (!entrada) throw new Error(`DEXIE_VERSIONS no declara la version ${version}`)
  return entrada
}

const abiertas: Dexie[] = []

afterEach(async () => {
  for (const base of abiertas) base.close()
  abiertas.length = 0
  await Dexie.delete(NOMBRE_BASE)
})

describe('upgrade real v25 → v26 de la base de conversación', () => {
  it('migra la base existente, retira conversationFilas y conserva conversations', async () => {
    const v26 = versionDe(26)

    // ---- Instancia A: SOLO v25, como el navegador que ya aplicó esa versión ----
    const a = new Dexie(NOMBRE_BASE)
    abiertas.push(a)
    a.version(25).stores(ESQUEMA_V25)
    await a.open()
    expect(a.tables.map((tabla) => tabla.name)).toContain('conversationFilas')

    await a.table('conversationFilas').put({
      locutionId: 'loc-v25',
      sessionId: 'sesion-v25',
      texto: 'fila del motor retirado',
    })
    await a.table('conversations').put({
      id: 'fila-v25',
      role: 'user',
      text: 'hola desde v25',
      speakerId: 'usuario',
      speakerName: '',
      timestamp: 1_700_000_000_000,
      sync: { revision: 1, updated_at: '2026-10-25T12:00:00.000Z', deleted: false },
    })
    a.close()

    // ---- Instancia B: v25 + v26 sobre la MISMA base ----
    // Aquí Dexie ejecuta el upgrade. Si faltara la v25 o hubiera VersionError,
    // `open()` lanzaría y este test fallaría.
    const b = new Dexie(NOMBRE_BASE)
    abiertas.push(b)
    b.version(25).stores(ESQUEMA_V25)
    b.version(26).stores(v26.stores)
    await b.open()

    expect(b.verno).toBe(26)
    expect(b.tables.map((tabla) => tabla.name)).toContain('conversations')
    expect(b.tables.map((tabla) => tabla.name)).not.toContain('conversationFilas')
    expect(schemaTableNames().filter((nombre) => nombre.startsWith('conversation'))).toEqual([
      'conversations',
    ])

    // La fila escrita en v25 SOBREVIVE: la base se migró, no se recreó.
    const vieja = await b.table('conversations').get('fila-v25')
    expect(vieja).toMatchObject({ role: 'user', text: 'hola desde v25' })

    // `conversations` sigue leyendo y escribiendo tras el upgrade, con sessionId.
    await b.table('conversations').put({
      id: 'fila-v26',
      role: 'user',
      text: 'hola desde v26',
      speakerId: 'usuario',
      speakerName: '',
      timestamp: 1_700_000_000_001,
      sessionId: 'sesion-v26',
      sync: { revision: 1, updated_at: '2026-10-25T12:00:01.000Z', deleted: false },
    })
    expect(await b.table('conversations').count()).toBe(2)
    const nueva = await b.table('conversations').get('fila-v26')
    expect(nueva).toMatchObject({ text: 'hola desde v26', sessionId: 'sesion-v26' })
  })
})
