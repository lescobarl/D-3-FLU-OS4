// ============================================================
// agendaUiSwap.test.ts — Guard del swap de UI del calendario
// ------------------------------------------------------------
// Invariantes (nace ROJO):
//   A) los paneles viejos de agenda (RemindersPanel/TemporalItemsPanel/HoyPanel)
//      ya no se importan en NINGÚN lado (se retiran).
//   B) el panel único AgendaPanel está CONECTADO en App.tsx.
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

describe('agenda — swap de UI a un solo panel', () => {
  it('A: los paneles viejos de agenda ya no se importan', () => {
    const imports = grep(/from\s+['"][^'"]*(RemindersPanel|TemporalItemsPanel|HoyPanel)['"]/)
    expect(imports, `imports de paneles viejos (N=${imports.length}); deben ser 0:\n  ${imports.join('\n  ')}`).toHaveLength(0)
  })

  it('B: AgendaPanel está conectado en App.tsx', () => {
    const app = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf8')
    expect(app).toContain('AgendaPanel')
  })
})
