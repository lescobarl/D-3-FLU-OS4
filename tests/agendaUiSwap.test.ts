// ============================================================
// agendaUiSwap.test.ts — Guard del swap de UI del calendario
// ------------------------------------------------------------
// Invariantes (nace ROJO):
//   A) los paneles viejos de agenda (RemindersPanel/TemporalItemsPanel/HoyPanel)
//      ya no se importan en NINGÚN lado (se retiran).
//   B) el panel UNICO AgendaPanel esta CONECTADO (importado Y renderizado) en la app.
// ============================================================
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Enmienda 2026-09-22 (C49): la asercion B media presencia del texto 'AgendaPanel'
// en App.tsx y solo pasaba por un import MUERTO (TS6133). El diseno real monta el
// panel en el host lateral (WorkspaceHub). Se endurece a import + render en src.

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

describe('agenda — swap de UI a un solo panel', () => {
  it('A: los paneles viejos de agenda ya no se importan', () => {
    const imports = grep(/from\s+['"][^'"]*(RemindersPanel|TemporalItemsPanel|HoyPanel)['"]/)
    expect(imports, `imports de paneles viejos (N=${imports.length}); deben ser 0:\n  ${imports.join('\n  ')}`).toHaveLength(0)
  })

  it('B: AgendaPanel esta conectado (importado y renderizado) en la app', () => {
    const imports = grep(/import\s*\{[^}]*\bAgendaPanel\b[^}]*\}\s*from\s*['"][^'"]*AgendaPanel['"]/)
    const renders = grep(/<\s*AgendaPanel\b/)
    expect(imports.length, 'AgendaPanel debe importarse al menos una vez').toBeGreaterThan(0)
    expect(renders.length, 'AgendaPanel debe renderizarse al menos una vez (<AgendaPanel .../>)').toBeGreaterThan(0)
  })
})
