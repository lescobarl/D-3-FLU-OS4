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
//   I3 todo pendiente cita evidencia;
//   I5 todo `done` esta justificado por su commit;
//   I6 todo item `done` tiene cierre en `done`;
//   I7 todo `decision` cita su veredicto.
// ============================================================
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  readLedger,
  readGitClosures,
  commitExists,
  validateLedger,
  parseClosureCommits,
  LEDGER_PATH,
} from '../scripts/task-ledger.mjs'

describe('taskLedger - el ledger no puede desincronizarse de git', () => {
  it('I1..I7 - el ledger REAL contra git esta sincronizado', () => {
    const ledger = readLedger(LEDGER_PATH)
    const closures = readGitClosures()
    const { ok, failures } = validateLedger(ledger, { closures, exists: commitExists })
    // Muestra el listado programatico de lo que falta (archivo:sujeto).
    expect(failures.join('\n')).toBe('')
    expect(ok).toBe(true)
  })
})

describe('validateLedger - el detector discrimina (no aprueba por nombre)', () => {
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

  it('RECHAZA un codigo de cierre declarado en git y ausente del ledger (I1b)', () => {
    // El commit ya estaba registrado con OTRO id, asi que la puerta vieja (que
    // solo miraba el hash) lo daba por bueno: medido con C53 -> 268e0c7.
    const closures = [{ hash: 'abc1234', codes: ['C53'], subject: 'z' }]
    const { ok, failures } = validateLedger(base(), { closures, exists: () => true })
    expect(ok).toBe(false)
    expect(failures.join('\n')).toContain('C53')
  })

  it('ACEPTA que el codigo lo cubra su familia (P3 cubre P3.1)', () => {
    const l = { items: [], done: [{ id: 'P3.1', commit: 'abc1234', titulo: 'y' }] }
    const closures = [{ hash: 'abc1234', codes: ['P3'], subject: 'z' }]
    expect(validateLedger(l, { closures, exists: () => true }).ok).toBe(true)
  })

  it('RECHAZA un `done` cuyo commit no existe', () => {
    const { ok, failures } = validateLedger(base(), { closures: [], exists: () => false })
    expect(ok).toBe(false)
    expect(failures.join('\n')).toContain('abc1234')
  })

  it('RECHAZA un cierre colgado de un commit ajeno (I5)', () => {
    // Caso medido: P4.11/P4.12/P4.14/P6.5/P6.8 colgaban de e0d5a1c, cuyo asunto
    // es "cierre de P1.5"; el hash estaba en done[] y la puerta vieja lo aprobaba.
    const l = {
      items: [{ id: 'P4.11', titulo: 'x', estado: 'done', evidencia: 'src/core/games/gameUtils.ts:25' }],
      done: [{ id: 'P4.11', commit: 'e0d5a1c', titulo: 'y' }],
    }
    const subjects = new Map([['e0d5a1c', 'chore(ledger): cierre de P1.5 verificado por el gate']])
    const { ok, failures } = validateLedger(l, { exists: () => true, subjects })
    expect(ok).toBe(false)
    expect(failures.join('\n')).toContain('no justificado')
  })

  it('ACEPTA el cierre cuyo commit toco la evidencia del item', () => {
    // P0.1/P0.2/P0.3 se cerraron en f23889d, que creo sus artefactos sin citarlos.
    const l = {
      items: [{ id: 'P0.1', titulo: 'x', estado: 'done', evidencia: 'plans/ledger.json' }],
      done: [{ id: 'P0.1', commit: 'f23889d', titulo: 'y' }],
    }
    const subjects = new Map([['f23889d', 'chore(ledger): pendientes en el repo como fuente unica + guard']])
    const files = new Map([['f23889d', new Set(['plans/ledger.json', 'AGENTS.md'])]])
    expect(validateLedger(l, { exists: () => true, subjects, files }).ok).toBe(true)
  })

  it('RECHAZA un item `done` sin cierre registrado ni veredicto (I6)', () => {
    const l = { items: [{ id: 'P0.1', titulo: 'x', estado: 'done', evidencia: 'plans/ledger.json' }], done: [] }
    const { ok, failures } = validateLedger(l, {})
    expect(ok).toBe(false)
    expect(failures.join('\n')).toContain('P0.1')
  })

  it('ACEPTA el cierre por VEREDICTO sin commit (el repo lo decidio asi)', () => {
    // Caso medido: P4.11/P4.12/P4.14/P6.5/P6.8/P4.10 estan `done` con su VEREDICTO
    // y SIN commit propio. Su sitio es `done` (decisionVerdictGuard, congelado):
    // `decision` seria reabrir una decision ya tomada.
    const l = {
      items: [{ id: 'P4.11', titulo: 'x', estado: 'done', evidencia: 'VEREDICTO: FALSO POSITIVO. ...' }],
      done: [],
    }
    expect(validateLedger(l, {}).ok).toBe(true)
  })

  it('RECHAZA un cierre por veredicto sin evidencia (I7)', () => {
    const l = { items: [{ id: 'P6.5', titulo: 'x', estado: 'decision', evidencia: '' }], done: [] }
    const { ok, failures } = validateLedger(l, {})
    expect(ok).toBe(false)
    expect(failures.join('\n')).toContain('P6.5')
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

describe('parseClosureCommits - leer el codigo donde git lo escribe', () => {
  it('ve el codigo del parentesis FINAL (C53 era invisible para la barrera)', () => {
    const got = parseClosureCommits(['268e0c7\x1fchore(P6.9): auditoria de higiene medida (C53)'])
    expect(got).toEqual([
      { hash: '268e0c7', codes: ['C53'], subject: 'auditoria de higiene medida (C53)' },
    ])
  })

  it('NO toma por cierre un codigo citado en medio de la prosa', () => {
    const got = parseClosureCommits(['aecd093\x1fchore(ledger): durante el cierre de T1 quedo un pendiente'])
    expect(got).toEqual([])
  })
})

describe('AGENTS.md - el ledger es fuente unica (regla de arranque)', () => {
  it('obliga a leer el ledger y declara el chat como NO fuente', () => {
    const agents = fs.readFileSync('AGENTS.md', 'utf8')
    expect(agents).toMatch(/plans\/ledger\.json/)
    expect(agents).toMatch(/ledger/i)
  })
})
