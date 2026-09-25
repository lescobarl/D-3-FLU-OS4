/**
 * C51 - sinAsercionesNoNull: en `src/` no queda ninguna asercion no-null (`expr!`).
 *
 * QUE PROBLEMA CIERRA: `!` apaga el chequeo del compilador justo donde el codigo
 * afirma "esto no es null". Si la afirmacion es cierta, el tipo puede demostrarlo
 * (guard, early return, `??` con default); si es falsa, el `!` traslada el fallo al
 * runtime, lejos del sitio que lo causo. Medido al abrir P6.11: 51 aserciones en 10
 * ficheros (20 en bunnyAnimator, 20 en autoOptimization), y 0 tras el cambio.
 *
 * QUE SE MIDE (AGENTS.md 7.7.d: implementaciones, no literales): el AST de
 * TypeScript, no el texto. Un regex sobre el mismo arbol daba 83 marcas donde el
 * parser ve 51: el resto eran `!` de plantillas y de comentarios, y comparaciones
 * `a !== b`. El detector recorre los nodos NonNullExpression, que es exactamente lo
 * que el compilador trata como asercion (y lo que borra al emitir).
 *
 * El segundo describe comprueba el propio detector: uno que nunca puede marcar una
 * entrada infractora es decorativo, no una barrera.
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
/** Universo medido: todo fichero JS/TS de src, recursivo y sin exclusiones. */
export function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}
function kindOf(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (file.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}
/** Lineas (1-based) con asercion no-null en `text`. Puro: testeable sin ficheros. */
export function nonNullLines(text: string, file = 'suelto.ts'): number[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(file))
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.NonNullExpression) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}
/** Marcas `ruta:linea` del universo dado (por defecto, todo src). */
export function nonNullOffenders(files: string[] = walk(SRC)): string[] {
  const out: string[] = []
  for (const f of files) {
    for (const line of nonNullLines(readFileSync(f, 'utf8'), f)) {
      out.push(`${relative(ROOT, f).split('\\').join('/')}:${line}`)
    }
  }
  return out
}
describe('C51 sinAsercionesNoNull - src no aserta "esto no es null"', () => {
  it('no queda ninguna asercion no-null en src', () => {
    const offenders = nonNullOffenders()
    expect(
      offenders,
      `Aserciones no-null (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
  it('el universo medido es todo src: ninguna exclusion silenciosa', () => {
    const naive = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = join(d, e.name)
        return e.isDirectory()
          ? naive(p)
          : /\.(ts|tsx|js|jsx|mjs)$/.test(e.name)
            ? [p]
            : []
      })
    const norm = (f: string) => f.split('\\').join('/')
    const measured = walk(SRC).map(norm).sort()
    expect(measured.length).toBeGreaterThan(250)
    expect(measured).toEqual(naive(SRC).map(norm).sort())
  })
})
describe('C51 sinAsercionesNoNull - el detector no es decorativo', () => {
  it('el detector marca la asercion del parser y no el `!` del texto', () => {
    expect(nonNullLines('const a = b.c!.d\n')).toEqual([1])
    expect(nonNullLines('const a = b.c!.d\nconst e = f!.g\n')).toEqual([1, 2])
    // El mismo caracter `!` que NO es asercion no cuenta:
    expect(nonNullLines('if (a !== b) return\n')).toEqual([])
    expect(nonNullLines('const s = "a!"\n')).toEqual([])
    expect(nonNullLines('const t = `x${a}!`\n')).toEqual([])
    expect(nonNullLines('// ojo: x!\n/* otro x! */\n')).toEqual([])
    expect(nonNullLines('const u = v?.w\n')).toEqual([])
    expect(nonNullLines('const y = z as Foo\n')).toEqual([])
  })
  it('mutation: una asercion real en el universo produce marca', () => {
    const fake = join(tmpdir(), `c51_mutante_${process.pid}.ts`)
    writeFileSync(fake, 'export const a = b!.c\n')
    try {
      const offenders = nonNullOffenders([fake])
      expect(offenders.length, 'el detector no marco la asercion inyectada').toBe(1)
      expect(offenders[0]).toContain('c51_mutante')
      expect(offenders[0].endsWith(':1')).toBe(true)
    } finally {
      rmSync(fake, { force: true })
    }
  })
})
