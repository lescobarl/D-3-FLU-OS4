// ============================================================
// agendaUiSwap.test.ts — Guard del swap de UI del calendario
// ------------------------------------------------------------
// Invariantes (nace ROJO):
//   A) los paneles viejos de agenda (RemindersPanel/TemporalItemsPanel/HoyPanel)
//      ya no se importan en NINGÚN lado (se retiran).
//   B) el panel UNICO AgendaPanel esta CONECTADO (importado Y renderizado) en la app.
// ============================================================
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Enmienda 2026-09-22 (C49): la asercion B media presencia del texto 'AgendaPanel'
// en App.tsx y solo pasaba por un import MUERTO (TS6133). El diseno real monta el
// panel en el host lateral (WorkspaceHub). Se endurece a import + render en src.

const ROOT = process.cwd()

/** Patrones de la regla (extraidos para poder probar el DETECTOR, P2.4). */
const RE_PANELES_VIEJOS = /from\s+['"][^'"]*(RemindersPanel|TemporalItemsPanel|HoyPanel)['"]/
const RE_IMPORT_AGENDA = /import\s*\{[^}]*\bAgendaPanel\b[^}]*\}\s*from\s*['"][^'"]*AgendaPanel['"]/
const RE_RENDER_AGENDA = /<\s*AgendaPanel\b/

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

describe('agenda — swap de UI a un solo panel', () => {
  it('A: los paneles viejos de agenda ya no se importan', () => {
    const imports = grep(RE_PANELES_VIEJOS)
    expect(imports, `imports de paneles viejos (N=${imports.length}); deben ser 0:\n  ${imports.join('\n  ')}`).toHaveLength(0)
  })

  it('B: AgendaPanel esta conectado (importado y renderizado) en la app', () => {
    const imports = grep(RE_IMPORT_AGENDA)
    const renders = grep(RE_RENDER_AGENDA)
    expect(imports.length, 'AgendaPanel debe importarse al menos una vez').toBeGreaterThan(0)
    expect(renders.length, 'AgendaPanel debe renderizarse al menos una vez (<AgendaPanel .../>)').toBeGreaterThan(0)
  })
})

/** P2.4 - prueba de DETECTOR: escribe entradas sinteticas en un directorio temporal
 *  y comprueba que el detector MARCA la infractora y PERDONA la limpia. */
function dirSintetico(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'p24-'))
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c)
  return dir
}

describe('P2.4 agendaUiSwap - el detector no es decorativo', () => {
  it('marca los paneles viejos y el cableado de AgendaPanel', () => {
    const dir = dirSintetico({
      'infractor.tsx': "import { HoyPanel } from './HoyPanel'",
      'limpio.tsx': "import { AgendaPanel } from './AgendaPanel'\n<AgendaPanel items={x} />",
    })
    try {
      expect(grep(RE_PANELES_VIEJOS, dir)).toHaveLength(1)
      expect(grep(RE_IMPORT_AGENDA, dir)).toHaveLength(1)
      expect(grep(RE_RENDER_AGENDA, dir)).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
