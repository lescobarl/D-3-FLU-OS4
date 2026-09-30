// ============================================================
// agendaSingleSource.test.ts — Guard: calendario con UNA sola fuente
// ------------------------------------------------------------
// Invariantes:
//   A) los CRUD viejos (reminder/temporal/horario) ya no se definen.
//   B) ningún consumidor importa los módulos viejos de CRUD.
// Nace ROJO mientras convivan agendaService + los 3 CRUD viejos.
// ============================================================
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** Patrones de la regla (extraidos para poder probar el DETECTOR, P2.4). */
const RE_CRUD_VIEJO = /export\s+function\s+create(Reminder|Temporal|Horario)Service\b/
const RE_IMPORT_VIEJO = /from\s+['"][^'"]*(reminderService|temporalService|horarioService)['"]/

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

function grep(re: RegExp, root: string = join(ROOT, 'src')): string[] {
  const out: string[] = []
  for (const f of walk(root)) {
    const rf = relative(root, f).replace(/\\/g, '/')
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
    const defs = grep(RE_CRUD_VIEJO)
    expect(defs, `CRUD viejos definidos (N=${defs.length}); deben ser 0:\n${defs.join('\n  ')}`).toHaveLength(0)
  })

  it('B: ningún consumidor importa los módulos viejos de CRUD', () => {
    const imports = grep(RE_IMPORT_VIEJO)
    expect(imports, `imports de módulos viejos (N=${imports.length}); deben ser 0:\n${imports.join('\n  ')}`).toHaveLength(0)
  })
})

/** P2.4 - prueba de DETECTOR: escribe entradas sinteticas en un directorio temporal
 *  y comprueba que el detector MARCA la infractora y PERDONA la limpia. */
function dirSintetico(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'p24-'))
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c)
  return dir
}

describe('P2.4 agendaSingleSource - el detector no es decorativo', () => {
  it('marca el CRUD viejo sintetico y perdona la limpia', () => {
    const dir = dirSintetico({
      'infractor.ts': 'export function createReminderService() {}',
      'limpio.ts': 'export function createAgendaService() {}',
    })
    try {
      expect(grep(RE_CRUD_VIEJO, dir)).toHaveLength(1)
      expect(grep(RE_CRUD_VIEJO, dir)[0]).toContain('infractor.ts')
      expect(grep(RE_IMPORT_VIEJO, dir)).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
