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

/**
 * Detector: de una lista de rutas, las huerfanas que SIGUEN existiendo.
 * Exportado para poder falsificarlo (guardMutationGuard: sin prueba de detector es teatro).
 * @param paths Rutas relativas a la raiz del repo.
 * @param existe Comprobador inyectado (en el caso real, existsSync).
 */
export function huerfanos(paths: string[], existe: (p: string) => boolean): string[] {
  return paths.filter((p) => existe(p))
}

describe('C17 huerfanos — sin docs/utilidades huérfanas', () => {
  it('los archivos sin referencia están eliminados', () => {
    const remaining = huerfanos(ORPHANS, (p) => existsSync(join(ROOT, p)))
    expect(
      remaining,
      `Huérfanos que siguen existiendo (N=${remaining.length}):\n  ${remaining.join('\n  ')}`,
    ).toEqual([])
  })

  it('PRUEBA DE DETECTOR: el detector marca el huerfano presente y no marca el ausente', () => {
    const existe = (p: string) => existsSync(join(ROOT, p))
    expect(huerfanos(['package.json', 'no-existe-xyz.ts'], existe)).toEqual(['package.json'])
    expect(huerfanos(['no-existe-xyz.ts'], existe)).toEqual([])
  })
})
