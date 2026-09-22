/**
 * C60 gameRounds — una sola lectura de `rounds` con clamps.
 *
 * Antes (RED): 12 motores reimplementaban
 *   const rounds = Number(cfg?.rounds) || Number(cfg?.defaultRounds) || DEFAULT_ROUNDS;
 *   return clamp(rounds, 1, MAX_ROUNDS);
 *   (abecedario, adivinaCancion, calculoMental, memoriaSecuencias, ordenaSecuencia,
 *   palabrasEncadenadas, quienSoy, repiteTraduce, riddles, trabalenguas, trivia,
 *   veoVeo). Ahora todos usan gameUtils.readRounds.
 *
 * NO unificado A PROPÓSITO: respiracion.readRondas usa las claves `rondas`/
 * `defaultRondas` (contrato de config distinto); unificarlo cambiaría su
 * comportamiento y su config. Se documenta como decisión, no como deuda.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readRounds } from '../src/core/games/gameUtils'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const PATTERN =
  /Number\(cfg\?\.rounds\)\s*\|\|\s*Number\(cfg\?\.defaultRounds\)\s*\|\|\s*DEFAULT_ROUNDS/

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Archivos con una copia local de la lectura de rounds. */
export function roundsCopyFiles(files: string[] = walk(SRC)): string[] {
  const hits: string[] = []
  for (const f of files) {
    if (PATTERN.test(readFileSync(f, 'utf8'))) {
      hits.push(relative(ROOT, f).split(sep).join('/'))
    }
  }
  return hits.sort()
}

describe('C60 gameRounds — una sola lectura de rounds', () => {
  it('ningún motor reimplementa la lectura de rounds', () => {
    const impls = roundsCopyFiles()
    expect(
      impls,
      `Copias locales de lectura de rounds (N=${impls.length}): ${impls.join(', ')}`,
    ).toEqual([])
  })
})

describe('C60 gameRounds — contrato de comportamiento', () => {
  it('usa cfg.rounds', () => {
    expect(readRounds({ rounds: 7 }, 3, 20)).toBe(7)
  })
  it('cae a cfg.defaultRounds', () => {
    expect(readRounds({ defaultRounds: 5 }, 3, 20)).toBe(5)
  })
  it('cae al default del motor', () => {
    expect(readRounds({}, 4, 20)).toBe(4)
  })
  it('aplica clamps [1, maxRounds]', () => {
    expect(readRounds({ rounds: -5 }, 3, 20)).toBe(1)
    expect(readRounds({ rounds: 99 }, 3, 20)).toBe(20)
  })
})
