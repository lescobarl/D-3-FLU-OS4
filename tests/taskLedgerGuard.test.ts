// ============================================================
// taskLedgerGuard.test.ts - GUARD del ledger de pendientes
// ------------------------------------------------------------
// Nace ROJO: el ledger existe pero ningun commit de cierre esta
// registrado, y AGENTS.md aun no obliga a leerlo. Su proposito es
// que NINGUN pendiente/cierre se pierda al compactarse el chat:
// el repo es la fuente, no el resumen de la conversacion.
//
// Invariantes (ver scripts/task-ledger.mjs):
//   I1 todo commit de cierre (scope=codigo) esta en `done`;
//   I2 todo `done` apunta a un commit existente;
//   I3 todo pendiente cita evidencia.
// ============================================================
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  readLedger,
  readGitClosures,
  commitExists,
  validateLedger,
  LEDGER_PATH,
} from '../scripts/task-ledger.mjs'

describe('taskLedger - el ledger no puede desincronizarse de git', () => {
  it('I1/I2/I3 - el ledger REAL contra git esta sincronizado', () => {
    const ledger = readLedger(LEDGER_PATH)
    const closures = readGitClosures()
    const { ok, failures } = validateLedger(ledger, { closures, exists: commitExists })
    // Muestra el listado programatico de lo que falta (archivo:sujeto).
    expect(failures.join('\n')).toBe('')
    expect(ok).toBe(true)
  })
})

describe('validateLedger - discrimina (no aprueba por nombre)', () => {
  const base = () => ({
    items: [{ id: 'P1', titulo: 'x', estado: 'todo', evidencia: 'src/a.ts:1' }],
    done: [{ id: 'C1', commit: 'abc1234', titulo: 'y' }],
  })

  it('RECHAZA un commit de cierre ausente del ledger', () => {
    const closures = [{ hash: 'deadbee', codes: ['C9'], subject: 'z' }]
    const { ok, failures } = validateLedger(base(), { closures, exists: () => true })
    expect(ok).toBe(false)
    expect(failures.join('\n')).toContain('deadbee')
  })

  it('RECHAZA un `done` cuyo commit no existe', () => {
    const { ok, failures } = validateLedger(base(), { closures: [], exists: () => false })
    expect(ok).toBe(false)
    expect(failures.join('\n')).toContain('abc1234')
  })

  it('RECHAZA un pendiente sin evidencia', () => {
    const l = base()
    l.items[0].evidencia = ''
    const { ok } = validateLedger(l, { closures: [], exists: () => true })
    expect(ok).toBe(false)
  })

  it('APRUEBA cuando todo esta sincronizado', () => {
    const { ok } = validateLedger(base(), { closures: [], exists: () => true })
    expect(ok).toBe(true)
  })
})

describe('AGENTS.md - el ledger es fuente unica (regla de arranque)', () => {
  it('obliga a leer el ledger y declara el chat como NO fuente', () => {
    const agents = fs.readFileSync('AGENTS.md', 'utf8')
    expect(agents).toMatch(/plans\/ledger\.json/)
    expect(agents).toMatch(/ledger/i)
  })
})
