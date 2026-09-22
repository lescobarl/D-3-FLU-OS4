/**
 * C59 gameAdoptRandom — una sola implementación de la adopción del RNG.
 *
 * Antes (RED): 16 motores de juego reimplementaban la misma lógica
 *   `if (cfg && typeof cfg.random === 'function') rng = cfg.random`
 *   (abecedario, adivinaNumero, ahorcado, calculoMental, cuentoColaborativo,
 *   karaoke, memoriaSecuencias, ordenaSecuencia, palabrasEncadenadas, quienSoy,
 *   repiteTraduce, riddles, simonDice, trabalenguas, trivia, veoVeo), además de
 *   la copia en gameUtils. Ahora solo `src/core/games/gameUtils.ts` la tiene.
 */
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { adoptRandom } from '../src/core/games/gameUtils'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CANONICAL = 'src/core/games/gameUtils.ts'
const PATTERN = /typeof\s+cfg\.random\s*===\s*'function'/

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Archivos que reimplementan la adopción del RNG. */
export function adoptRandomFiles(files: string[] = walk(SRC)): string[] {
  const hits: string[] = []
  for (const f of files) {
    if (PATTERN.test(readFileSync(f, 'utf8'))) {
      hits.push(relative(ROOT, f).split(sep).join('/'))
    }
  }
  return hits.sort()
}

describe('C59 gameAdoptRandom — una sola implementación', () => {
  it('solo gameUtils implementa la adopción del RNG', () => {
    const impls = adoptRandomFiles()
    expect(
      impls,
      `Implementaciones de adopción del RNG (N=${impls.length}): ${impls.join(', ')}`,
    ).toEqual([CANONICAL])
  })
})

describe('C59 gameAdoptRandom — contrato de comportamiento', () => {
  const rng = () => 0.5
  it('adopta cfg.random si es función', () => {
    const other = () => 0.1
    expect(adoptRandom(rng, { random: other })).toBe(other)
  })
  it('conserva el actual si cfg no trae random', () => {
    expect(adoptRandom(rng, {})).toBe(rng)
    expect(adoptRandom(rng, undefined)).toBe(rng)
  })
  it('ignora un cfg.random que no es función', () => {
    expect(adoptRandom(rng, { random: 42 })).toBe(rng)
  })
})
