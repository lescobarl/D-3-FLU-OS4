/**
 * C58 dayKey — fuente única de la clave de día local (YYYY-MM-DD).
 *
 * Antes (RED): 8 copias del mismo formateador en
 *   - src/App.tsx                          (inline `dateKey`)
 *   - src/components/panelUtils.ts         (todayLocalDate)
 *   - src/core/agenda/agendaSummary.ts     (localDayKey)
 *   - src/core/browser/browserSession.ts   (dayKey)
 *   - src/core/contacts/contactService.ts  (toDateKey)
 *   - src/core/days/dayRollover.ts         (dayKey)
 *   - src/core/habits/habitService.ts      (toDateKey)
 *   - src/core/multiuser/participantRegistry.ts (toDateKey)
 * Ahora solo `src/lib/dateKey.ts` lo implementa; el resto lo importa.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dayKey } from '../src/lib/dateKey'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CANONICAL = 'src/lib/dateKey.ts'
const isCommentLine = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line)

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Un fuente define el formateador de dia local (mismo criterio del guard). */
export function isDateKeyImplementation(src: string): boolean {
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i]) || !/getFullYear\s*\(/.test(lines[i])) continue
    const win = lines.slice(i, i + 6).join("\n")
    if (
      /`[^`]*\$\{[^`}]*\}-\$\{[^`}]*\}-\$\{[^`}]*\}[^`]*`/.test(win) &&
      /getMonth\(\)\s*\+\s*1/.test(win) &&
      /getDate\(\)/.test(win) &&
      !/getHours\(|getMinutes\(|getDay\(/.test(win)
    ) return true
  }
  return false
}

/** Archivos con una implementación del formateador local getFullYear/getMonth/getDate. */
export function dateKeyImplementations(files: string[] = walk(SRC)): string[] {
  const hits: string[] = []
  for (const f of files) {
    if (isDateKeyImplementation(readFileSync(f, 'utf8'))) {
      hits.push(relative(ROOT, f).replace(/\\/g, '/'))
    }
  }
  return hits.sort()
}

describe('C58 dayKey — una sola implementación', () => {
  it('solo src/lib/dateKey.ts define el formateador de día local', () => {
    const impls = dateKeyImplementations()
    expect(
      impls,
      `Implementaciones de la clave de día (N=${impls.length}): ${impls.join(', ')}`,
    ).toEqual([CANONICAL])
  })
})

describe('C58 dayKey — contrato de comportamiento', () => {
  it('acepta Date', () => {
    expect(dayKey(new Date(2026, 0, 5, 13, 30))).toBe('2026-01-05')
  })
  it('acepta timestamp', () => {
    expect(dayKey(new Date(2026, 8, 22, 1, 0).getTime())).toBe('2026-09-22')
  })
  it('por defecto usa hoy (mismo día local que Date)', () => {
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(dayKey()).toBe(expected)
  })
  it('rellena mes y día con dos dígitos', () => {
    expect(dayKey(new Date(2026, 2, 9))).toBe('2026-03-09')
  })
})

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('C58 dayKey - el detector no es decorativo', () => {
  it('marca el formateador de dia sintetico y no el que solo formatea la hora', () => {
    const impl = [
      'const d = new Date()',
      'const k = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`',
    ].join('\n')
    expect(isDateKeyImplementation(impl)).toBe(true)
    const conHora = impl.replace('d.getDate()', 'd.getDate()}H${d.getHours()')
    expect(isDateKeyImplementation(conHora)).toBe(false)
    expect(isDateKeyImplementation('import { dayKey } from "../lib/dateKey"')).toBe(false)
  })
})