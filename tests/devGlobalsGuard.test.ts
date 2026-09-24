/**
 * P6.1 / P6.3 - devGlobals: los globales de depuracion viven SOLO en desarrollo.
 *
 * EVIDENCIA MEDIDA (por que NO se gatearon los 6 de la auditoria): App.tsx hace
 * "const w = window" y dispatchArbiterIntent lee w.__fluHandle{Diary,Note,Shopping,
 * AgendaCommand}Text. Esos 4 NO son superficie de depuracion: son el mecanismo REAL
 * de despacho, asi que gatearlos romperia diario/notas/compras/agenda EN PRODUCCION.
 * Los otros 2 (__fluHandleConocerFluText, __fluHandleDeviceActionText) no tenian
 * ningun lector en src/ ni en tests/e2e: pasan a exponerse solo en DEV
 * (App.exposeDevHook).
 *
 * REGLA VIGILADA: toda asignacion "window.<__algo> =" o "window.FLU_CONFIG =" debe
 * (a) estar dentro de un gate import.meta.env.DEV, o (b) ser un puente FUNCIONAL
 * documentado en FUNCTIONAL_BRIDGE y con un lector real que lo justifique.
 *
 * ALCANCE DELIBERADO: la regla cubre los puentes __fluHandle* y FLU_CONFIG (el sujeto
 * de P6.1/P6.3). NO cubre el subsistema de depuracion/traza (__fluDebug,
 * __FLU_DEBUG_ENABLED, __fluDev, __FLU_LISTEN_DEBUG, __bunnyPreloadDone), que es un
 * flag de diseño con relay remoto y fue el sujeto de P6.2 (ya cerrado): mezclarlo
 * aqui convertiria este guard en una lista de excepciones.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
/** Puentes que la app consume EN RUNTIME: no pueden ser DEV-only. */
export const FUNCTIONAL_BRIDGE: readonly string[] = [
  '__fluHandleDiaryText',
  '__fluHandleNoteText',
  '__fluHandleShoppingText',
  '__fluHandleAgendaCommandText',
]
const DEV_GATE = 'import.meta.env.DEV'
const GATE_LOOKBACK = 20
const ASSIGN_RE = /window\s*\.\s*(__fluHandle[A-Za-z0-9_]*|FLU_CONFIG)\s*=(?!=)/
const isCommentLine = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line)
export interface GlobalAssignment {
  path: string
  name: string
  line: number
  gated: boolean
}
/** Asignaciones a globales de depuracion/config presentes en un fuente. */
export function globalAssignments(src: string, path: string): GlobalAssignment[] {
  const lines = src.split(/\r?\n/)
  const out: GlobalAssignment[] = []
  lines.forEach((raw, i) => {
    if (isCommentLine(raw)) return
    const m = ASSIGN_RE.exec(raw)
    if (!m) return
    const from = Math.max(0, i - GATE_LOOKBACK)
    const gated = lines.slice(from, i + 1).some((l) => l.includes(DEV_GATE))
    out.push({ path, name: m[1], line: i + 1, gated })
  })
  return out
}
/** Asignaciones que ni estan en un gate DEV ni son puente funcional documentado. */
export function ungatedGlobals(src: string, path: string): string[] {
  return globalAssignments(src, path)
    .filter((a) => !a.gated && !FUNCTIONAL_BRIDGE.includes(a.name))
    .map((a) => a.path + ':' + a.line + ' window.' + a.name)
}
/** Menciones que NO son la propia asignacion (es decir, un lector real). */
export function readerOccurrences(src: string, name: string): number {
  const assign = new RegExp('window\\s*\\.\\s*' + name + '\\s*=(?!=)')
  return src
    .split(/\r?\n/)
    .filter((raw) => !isCommentLine(raw) && raw.includes(name) && !assign.test(raw)).length
}
const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs)$/
function scanSrc(): string[] {
  const files: string[] = []
  const walkDir = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walkDir(full)
      else if (SCAN_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(full)
    }
  }
  walkDir(join(process.cwd(), 'src'))
  return files
}
describe('P6.1/P6.3 devGlobals - ningun global de depuracion sin gate DEV', () => {
  it('src/ no expone globales de depuracion/config sin gate DEV', () => {
    const root = process.cwd()
    const hits: string[] = []
    for (const abs of scanSrc()) {
      const rel = abs.slice(root.length + 1).replace(/\\/g, '/')
      hits.push(...ungatedGlobals(readFileSync(abs, 'utf8'), rel))
    }
    expect(
      hits,
      'Globales sin gate DEV (N=' + hits.length + '):\n  ' + hits.join('\n  ') + '\n' +
        'Envueltos en if (import.meta.env.DEV) o declarados en FUNCTIONAL_BRIDGE con lector real.',
    ).toEqual([])
  })
  it('cada puente funcional declarado tiene un lector real (si no, la lista miente)', () => {
    const sources = scanSrc().map((abs) => readFileSync(abs, 'utf8'))
    const sinLector = FUNCTIONAL_BRIDGE.filter(
      (name) => sources.reduce((acc, src) => acc + readerOccurrences(src, name), 0) === 0,
    )
    expect(
      sinLector,
      'Puentes declarados sin lector (N=' + sinLector.length + '): ' + sinLector.join(', ') +
        ' -> o son codigo muerto (gatealos o borralos) o sobra la entrada en FUNCTIONAL_BRIDGE.',
    ).toEqual([])
  })
})
describe('P6.1/P6.3 devGlobals - el detector no es decorativo', () => {
  it('marca un puente de handler nuevo sin gate (la familia __fluHandle*)', () => {
    expect(ungatedGlobals('window.__fluHandleNuevoText = 1;', 'src/x.ts')).toEqual([
      'src/x.ts:1 window.__fluHandleNuevoText',
    ])
  })

  it('no se pronuncia sobre el subsistema de debug/traza (P6.2, fuera de alcance)', () => {
    expect(ungatedGlobals('window.__fluDebug = createDebug();', 'src/voice/lib/fluDebug.js')).toEqual([])
  })
  it('marca window.FLU_CONFIG sin gate (el caso de P6.3)', () => {
    expect(ungatedGlobals('window.FLU_CONFIG = FLU_CONFIG;', 'src/main.tsx')).toHaveLength(1)
  })
  it('no marca si hay gate DEV cerca (misma linea o hasta 20 lineas antes)', () => {
    const gated = 'if (import.meta.env.DEV) {\n  window.FLU_CONFIG = FLU_CONFIG;\n}'
    expect(ungatedGlobals(gated, 'src/main.tsx')).toEqual([])
  })
  it('no marca los 4 puentes funcionales (la app los lee en runtime)', () => {
    for (const name of FUNCTIONAL_BRIDGE) {
      expect(ungatedGlobals('window.' + name + ' = useCallback(fn, []);', 'src/App.tsx')).toEqual([])
    }
  })
  it('marca un puente que NO este en la lista', () => {
    expect(ungatedGlobals('window.__fluHandleInventadoText = fn;', 'src/App.tsx')).toHaveLength(1)
  })
  it('ignora comentarios', () => {
    expect(ungatedGlobals('// antes: window.__fluViejo = 1;', 'src/x.ts')).toEqual([])
    expect(ungatedGlobals(' * window.__fluViejo = 1;', 'src/x.ts')).toEqual([])
  })
  it('readerOccurrences distingue lectura de asignacion', () => {
    expect(readerOccurrences('window.__aText = fn;', '__aText')).toBe(0)
    expect(readerOccurrences('const r = w.__aText(x);', '__aText')).toBe(1)
    expect(readerOccurrences('// w.__aText(x)', '__aText')).toBe(0)
  })
})