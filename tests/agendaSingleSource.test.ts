// ============================================================
// agendaSingleSource.test.ts — Guard: calendario con UNA sola fuente
// ------------------------------------------------------------
// Invariantes:
//   A) los CRUD viejos (reminder/temporal/horario) ya no se definen.
//   B) ningún consumidor importa los módulos viejos de CRUD.
// Nace ROJO mientras convivan agendaService + los 3 CRUD viejos.
// ============================================================
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

function grep(re: RegExp): string[] {
  const out: string[] = []
  for (const f of walk(join(ROOT, 'src'))) {
    const rf = relative(ROOT, f).replace(/\\/g, '/')
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (re.test(line)) out.push(`${rf}:${i + 1}`)
      })
  }
  return out
}

describe('agenda — una sola fuente (calendario unificado)', () => {
  it('A: los CRUD viejos (reminder/temporal/horario) ya no se definen', () => {
    const defs = grep(/export\s+function\s+create(Reminder|Temporal|Horario)Service\b/)
    expect(defs, `CRUD viejos definidos (N=${defs.length}); deben ser 0:\n${defs.join('\n  ')}`).toHaveLength(0)
  })

  it('B: ningún consumidor importa los módulos viejos de CRUD', () => {
    const imports = grep(/from\s+['"][^'"]*(reminderService|temporalService|horarioService)['"]/)
    expect(imports, `imports de módulos viejos (N=${imports.length}); deben ser 0:\n${imports.join('\n  ')}`).toHaveLength(0)
  })
})
