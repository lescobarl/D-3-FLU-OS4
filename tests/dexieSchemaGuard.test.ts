/**
 * C46 — dexieSchema: sin tablas legacy vivas en el esquema efectivo.
 *
 * Antes (RED): `reminders` (v5), `horario` (v11) y `temporalItems` (v12/v19)
 * seguian declaradas en el esquema, pero la agenda unificada (v21) es la unica
 * fuente; nadie las usa. Se borran con una version nueva (`: null`).
 *
 * El esquema efectivo = todas las `stores` en orden; una tabla con `: null` queda
 * borrada. El segundo describe prueba que el detector falla de verdad.
 *
 * P1.4 movio el esquema a DEXIE_VERSIONS y este guard se quedo leyendo llamadas
 * `.stores({...})`, que ya no existen: encontraba 0 bloques, asi que devolvia
 * `undefined` para las tres tablas. El test de "no hay legacy vivas" pasaba por
 * vaciedad (undefined !== 'declared') y el de "debe quedar borrada" fallaba sin
 * decir nada util: un guard sordo, fuera de lint:guards, en rojo desde entonces.
 * Ahora el detector lee DEXIE_VERSIONS y exige, como anti-vaciedad, HABER VISTO
 * cada tabla declarada antes de verla borrada: si vuelve a quedarse sordo, esto se
 * pone rojo en vez de pasar en silencio.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SCHEMA_FILE = join(ROOT, 'src/core/db/fluDatabase.ts')
const LEGACY_TABLES = ['reminders', 'horario', 'temporalItems']

type TableState = 'declared' | 'deleted'

/** Historial de cada tabla, en orden de aparicion, leyendo DEXIE_VERSIONS. */
function dexieTableHistory(src: string): Map<string, TableState[]> {
  const history = new Map<string, TableState[]>()
  const start = src.indexOf('DEXIE_VERSIONS')
  const body = start === -1 ? '' : src.slice(start)
  for (const block of body.matchAll(/stores:\s*\{([\s\S]*?)\}/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(null|['"])/)
      if (!m) continue
      const seen = history.get(m[1]) ?? []
      seen.push(m[2] === 'null' ? 'deleted' : 'declared')
      history.set(m[1], seen)
    }
  }
  return history
}

/** Estado efectivo: lo que declara la ultima version que menciona la tabla. */
function dexieSchemaStates(src: string): Map<string, TableState> {
  const state = new Map<string, TableState>()
  for (const [name, seen] of dexieTableHistory(src)) state.set(name, seen[seen.length - 1])
  return state
}

function liveLegacyTables(src: string): string[] {
  const state = dexieSchemaStates(src)
  return LEGACY_TABLES.filter((t) => state.get(t) === 'declared')
}

const REAL = readFileSync(SCHEMA_FILE, 'utf8')

describe('C46 dexieSchema — sin tablas legacy vivas', () => {
  it('reminders/horario/temporalItems no siguen declaradas en el esquema efectivo', () => {
    const live = liveLegacyTables(REAL)
    expect(live, `Tablas legacy vivas (N=${live.length}): ${live.join(', ')}`).toEqual([])
  })

  it('existe una version que borra las tablas legacy (: null)', () => {
    const state = dexieSchemaStates(REAL)
    for (const t of LEGACY_TABLES) {
      expect(state.get(t), `${t} debe quedar borrada`).toBe('deleted')
    }
  })

  it('el detector ve el esquema real (anti-vaciedad)', () => {
    const state = dexieSchemaStates(REAL)
    // Umbral holgado a proposito: el esquema real trae mas de 20 tablas. Si el
    // esquema se muda otra vez, esto cae en vez de pasar vacio.
    expect(state.size, 'DEXIE_VERSIONS no resuelve tablas: el detector esta sordo').toBeGreaterThan(15)
  })

  it('cada tabla legacy se declaro y luego se borro', () => {
    const history = dexieTableHistory(REAL)
    for (const t of LEGACY_TABLES) {
      const seen = history.get(t) ?? []
      expect(seen[0], `${t} nunca se declaro en DEXIE_VERSIONS`).toBe('declared')
      expect(seen[seen.length - 1], `${t} no queda borrada`).toBe('deleted')
    }
  })
})

describe('C46 dexieSchema — el detector no es decorativo', () => {
  const schema = (rows: string) => `const DEXIE_VERSIONS = [\n${rows}\n]`
  it('marca una tabla declarada como viva', () => {
    expect(liveLegacyTables(schema("  { version: 5, stores: { reminders: 'id, status' } },"))).toEqual(['reminders'])
  })
  it('no marca una tabla borrada con null', () => {
    expect(
      liveLegacyTables(
        schema(
          "  { version: 5, stores: { reminders: 'id, status' } },\n" +
            '  { version: 22, stores: { reminders: null } },',
        ),
      ),
    ).toEqual([])
  })
  it('ignora tablas que no son legacy', () => {
    expect(liveLegacyTables(schema("  { version: 21, stores: { agenda: 'id, kind' } },"))).toEqual([])
  })
  it('la forma vieja (.stores) ya no resuelve nada: por eso el guard exige >15', () => {
    expect(dexieSchemaStates("this.version(5).stores({ reminders: 'id, status' })").size).toBe(0)
  })
})
