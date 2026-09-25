// ============================================================
// schedulerSingleDefinition.test.ts — GUARD (una sola definición del scheduler)
// ------------------------------------------------------------
// Invariante: `isDue`, `collectDue` y `collectDueOrdered` se DEFINEN una sola vez
// (con `export function`), en el dueño canónico `scheduleEngine.ts`. Cualquier
// otro archivo puede RE-EXPORTAR o adaptar con `export const`/wrapper, pero NO
// volver a declarar `export function`.
//
// Nace ROJO: hoy `reminderScheduler.ts` redeclara las 3.
// ============================================================
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
export const CANONICAL = 'src/core/temporal/scheduleEngine.ts'
export const SYMBOLS = ['isDue', 'collectDue', 'collectDueOrdered'] as const

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) acc.push(p)
  }
  return acc
}

/** Definiciones `export function <symbol>` en todo `src`, como `archivo:linea`. */
export function findDefinitions(symbols: readonly string[] = SYMBOLS): string[] {
  const re = new RegExp(`export\\s+function\\s+(${symbols.join('|')})\\b`)
  const out: string[] = []
  for (const f of walk(join(ROOT, 'src'))) {
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (re.test(line)) out.push(`${relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}`)
      })
  }
  return out
}

describe('scheduler — una sola definición de la lógica de vencimiento', () => {
  it('isDue/collectDue/collectDueOrdered se declaran solo en scheduleEngine.ts', () => {
    const devs = findDefinitions()
    const offenders = devs.filter((d) => !d.startsWith(`${CANONICAL}:`))
    expect(
      offenders,
      `Definiciones fuera de ${CANONICAL} (N=${offenders.length}); usa re-export/adaptador:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
    expect(
      devs.length,
      `El dueño canónico debe declarar los ${SYMBOLS.length} símbolos; hay ${devs.length} definiciones:\n  ${devs.join('\n  ')}`,
    ).toBe(SYMBOLS.length)
  })
})
