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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adoptRandom } from '../src/core/games/gameUtils'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CANONICAL = 'src/core/games/gameUtils.ts'
const PATTERN = /typeof\s+cfg\.random\s*===\s*'function'/



/** Archivos que reimplementan la adopción del RNG. */
export function adoptRandomFiles(files: string[] = walkFiles(SRC, /\.(ts|tsx|js|jsx)$/)): string[] {
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

describe('C59 gameAdoptRandom - prueba de detector', () => {
  // Prueba de detector: el detector debe marcar al infractor sintetico y NO al
  // limpio. Si el patron dejara de discriminar, este caso cae y el guard queda
  // senalado como teatro (P2.4).
  it('el detector marca una copia sintetica y no el fichero limpio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adopt-'))
    const malo = join(dir, 'malo.ts')
    const limpio = join(dir, 'limpio.ts')
    writeFileSync(malo, "if (cfg && typeof cfg.random === 'function') rng = cfg.random\n")
    writeFileSync(limpio, 'export const x = 1\n')
    expect(adoptRandomFiles([malo])).toEqual([relative(ROOT, malo).split(sep).join('/')])
    expect(adoptRandomFiles([limpio])).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
})
