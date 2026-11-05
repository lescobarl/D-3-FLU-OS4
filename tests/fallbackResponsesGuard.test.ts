/**
 * C34 — fallbackResponses: sin módulo muerto de respuestas de fallback.
 * Nace ROJO (src/services/fallbackResponses.ts existe sin importador de producción).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const DEAD = 'src/services/fallbackResponses.ts'

/**
 * Detector: de una lista de rutas, las que SIGUEN existiendo.
 * Exportado para poder falsificarlo (guardMutationGuard: sin prueba de detector es teatro).
 * @param paths Rutas relativas a la raiz del repo.
 * @param existe Comprobador inyectado (en el caso real, existsSync).
 */
export function existentes(paths: string[], existe: (p: string) => boolean): string[] {
  return paths.filter((p) => existe(p))
}

describe('C34 fallbackResponses — sin módulo muerto', () => {
  it('el módulo fallbackResponses está eliminado', () => {
    expect(existentes([DEAD], (p) => existsSync(join(ROOT, p))), `Sigue existiendo ${DEAD}`).toEqual([])
  })

  it('PRUEBA DE DETECTOR: el detector marca el modulo que sigue existiendo y no marca el ausente', () => {
    const existe = (p: string) => existsSync(join(ROOT, p))
    expect(existentes(['package.json', 'no-existe-xyz.ts'], existe)).toEqual(['package.json'])
    expect(existentes(['no-existe-xyz.ts'], existe)).toEqual([])
    expect(existentes([DEAD], existe)).toEqual([])
  })
})
