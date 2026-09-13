// ============================================================
// taskGateInvariant.test.ts — GUARD DEL GUARD (AGENTS.md §B/§10)
// ------------------------------------------------------------
// Verifica que la puerta de invariantes NO pueda aprobar un proxy:
//   - un guard que PASA en base (no distingue el defecto) debe ser rechazado;
//   - una métrica que no bajó debe ser rechazada;
//   - un guard que falla en el árbol actual debe ser rechazado.
// Si alguien "suaviza" scripts/task-gate-invariant.mjs para dejar pasar eso,
// este test se pone ROJO. Es el criterio congelado por hash en .task/frozen.json.
// ============================================================
import { describe, expect, it } from 'vitest'
import { evaluateInvariant, parseMetricValue } from '../scripts/task-gate-invariant.mjs'

const GREEN = { code: 0, out: '', err: '' }
const RED = { code: 1, out: '', err: 'guard falló' }

describe('task-gate-invariant — la puerta no acepta proxies', () => {
  it('parseMetricValue extrae el primer entero (o null si no hay)', () => {
    expect(parseMetricValue('7')).toBe(7)
    expect(parseMetricValue('  12\r\n')).toBe(12)
    expect(parseMetricValue('sin numeros')).toBeNull()
  })

  it('RECHAZA un guard que PASA en base (no distingue el defecto)', () => {
    const v = evaluateInvariant({
      metricBase: () => 12,
      metricNow: () => 0,
      guardBase: () => GREEN,
      guardNow: () => GREEN,
      target: 0,
    })
    expect(v.ok).toBe(false)
    expect(v.failures.join(' ')).toMatch(/PASA en base/)
  })

  it('RECHAZA una métrica que no cambió (hito cosmético)', () => {
    const v = evaluateInvariant({
      metricBase: () => 3,
      metricNow: () => 3,
      guardBase: () => RED,
      guardNow: () => GREEN,
      target: 1,
    })
    expect(v.ok).toBe(false)
    expect(v.failures.join(' ')).toMatch(/no cambió/)
    expect(v.failures.join(' ')).toMatch(/target/)
  })

  it('RECHAZA un guard que FALLA en el árbol actual', () => {
    const v = evaluateInvariant({
      metricBase: () => 12,
      metricNow: () => 0,
      guardBase: () => RED,
      guardNow: () => RED,
      target: 0,
    })
    expect(v.ok).toBe(false)
    expect(v.failures.join(' ')).toMatch(/FALLA en el árbol actual/)
  })

  it('APRUEBA solo si base rojo + actual verde + métrica bajó al target', () => {
    const v = evaluateInvariant({
      metricBase: () => 12,
      metricNow: () => 0,
      guardBase: () => RED,
      guardNow: () => GREEN,
      target: 0,
    })
    expect(v.failures).toEqual([])
    expect(v.ok).toBe(true)
  })
})
