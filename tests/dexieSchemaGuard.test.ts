/**
 * C46 — dexieSchema: sin tablas legacy vivas en el esquema efectivo.
 *
 * Antes (RED): `reminders` (v5), `horario` (v11) y `temporalItems` (v12/v19)
 * seguian declaradas en el esquema, pero la agenda unificada (v21) es la unica
 * fuente; nadie las usa. Se borran con una version nueva (`: null`).
 *
 * El esquema efectivo = todas las `.stores()` en orden; una tabla con `: null`
 * queda borrada. El segundo describe prueba que el detector falla de verdad.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SCHEMA_FILE = join(ROOT, 'src/core/db/fluDatabase.ts')
const LEGACY_TABLES = ['reminders', 'horario', 'temporalItems']

/** Estado efectivo por tabla ('declared' | 'deleted') segun los `.stores()`. */
function dexieSchemaState(src: string): Map<string, string> {
  const state = new Map<string, string>()
  for (const block of src.matchAll(/\.stores\(\{([\s\S]*?)\}\)/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(null|['"])/)
      if (m) state.set(m[1], m[2] === 'null' ? 'deleted' : 'declared')
    }
  }
  return state
}

function liveLegacyTables(src: string): string[] {
  const state = dexieSchemaState(src)
  return LEGACY_TABLES.filter((t) => state.get(t) === 'declared')
}

describe('C46 dexieSchema — sin tablas legacy vivas', () => {
  it('reminders/horario/temporalItems no siguen declaradas en el esquema efectivo', () => {
    const live = liveLegacyTables(readFileSync(SCHEMA_FILE, 'utf8'))
    expect(live, `Tablas legacy vivas (N=${live.length}): ${live.join(', ')}`).toEqual([])
  })

  it('existe una version que borra las tablas legacy (: null)', () => {
    const state = dexieSchemaState(readFileSync(SCHEMA_FILE, 'utf8'))
    for (const t of LEGACY_TABLES) {
      expect(state.get(t), `${t} debe quedar borrada`).toBe('deleted')
    }
  })
})

describe('C46 dexieSchema — el detector no es decorativo', () => {
  it('marca una tabla declarada como viva', () => {
    expect(liveLegacyTables("this.version(5).stores({ reminders: 'id, status' })")).toEqual(['reminders'])
  })
  it('no marca una tabla borrada con null', () => {
    expect(
      liveLegacyTables(
        "this.version(5).stores({ reminders: 'id, status' })\nthis.version(22).stores({ reminders: null })",
      ),
    ).toEqual([])
  })
  it('ignora tablas que no son legacy', () => {
    expect(liveLegacyTables("this.version(21).stores({ agenda: 'id, kind' })")).toEqual([])
  })
})
