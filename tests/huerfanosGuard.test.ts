/**
 * C17 — huerfanos: sin docs/utilidades sin referencia.
 * Nace ROJO (6 archivos existen).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const ORPHANS = [
  'plan_solucion_basura.md',
  'CONTEXTO_FLU_OS2.md',
  'ESTADO_SISTEMA.md',
  'mermaid-diagrama1.png',
  'tools/e2e-sims/sim-pollinations-caida-openrouter.spec.ts',
  'tools/live-check.mjs',
]

describe('C17 huerfanos — sin docs/utilidades huérfanas', () => {
  it('los archivos sin referencia están eliminados', () => {
    const remaining = ORPHANS.filter((p) => existsSync(join(ROOT, p)))
    expect(
      remaining,
      `Huérfanos que siguen existiendo (N=${remaining.length}):\n  ${remaining.join('\n  ')}`,
    ).toEqual([])
  })
})
