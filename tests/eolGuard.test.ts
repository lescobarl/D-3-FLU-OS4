/**
 * P0.7 — eolGuard: la convencion EOL del repo no se rompe por accidente.
 *
 * CONTEXTO REAL: core.autocrlf=false y NO existe .gitattributes. Los editores de
 * texto pueden guardar en CRLF un archivo cuyo blob esta en LF; git entonces
 * considera que TODAS las lineas cambiaron. Consecuencias medidas:
 *   - f1a1ca6 tuvo que rehacerse: el diff era de miles de lineas por un cambio real
 *     de 22+/20-.
 *   - .task/frozen.json hashea BYTES del arbol de trabajo: un flip de EOL cambia el
 *     hash y el gate falla por una razon que no tiene nada que ver con la tarea.
 *
 * Este guard NO impone una politica nueva (el repo es mixto a proposito: 378 en LF,
 * 331 en CRLF, 63 mixtos). Solo exige lo que ya se cumple hoy: el fichero del arbol
 * de trabajo conserva la MISMA clase de EOL que su blob en el indice. Si editas un
 * archivo conservando su EOL, no te afecta.
 */
import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
/** Clase de EOL segun `git ls-files --eol`: lf | crlf | mixed | none | -text. */
export type EolKind = string
export interface EolRow {
  i: EolKind
  w: EolKind
  path: string
}
/** Extrae la clase de EOL de un campo tipo "i/lf" o "w/mixed". */
export function eolKind(field: string): EolKind {
  const idx = field.indexOf('/')
  return idx === -1 ? '' : field.slice(idx + 1)
}
/**
 * Filas donde el arbol de trabajo cambio la clase de EOL respecto al indice.
 * Se ignoran los binarios/no-texto: git no los normaliza.
 */
export function eolMismatches(rows: EolRow[]): string[] {
  const out: string[] = []
  for (const r of rows) {
    const i = eolKind(r.i)
    const w = eolKind(r.w)
    if (w === '-text' || w === 'none' || i === '-text' || i === 'none') continue
    if (i !== w) out.push(`${r.path}: indice=${i} -> arbol=${w}`)
  }
  return out
}
function lsFilesEol(): EolRow[] {
  const out = execSync('git ls-files --eol', { encoding: 'utf8' })
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t')
      const meta = line.slice(0, tab).trim().split(/\s+/)
      return { i: meta[0], w: meta[1], path: line.slice(tab + 1) }
    })
}
describe('P0.7 eolGuard — el arbol de trabajo conserva la clase EOL del indice', () => {
  it('ningun archivo versionado cambia de EOL solo por editarlo', () => {
    const offenders = eolMismatches(lsFilesEol())
    expect(
      offenders,
      `EOL cambiado respecto al indice (N=${offenders.length}):\n  ${offenders.join('\n  ')}\n` +
        'Conserva la EOL del archivo al editarlo (y recuerda: frozen.json hashea bytes).',
    ).toEqual([])
  })
})
describe('P0.7 eolGuard — el detector no es decorativo', () => {
  it('marca un archivo con blob en LF guardado en CRLF (el caso que rompio f1a1ca6)', () => {
    expect(eolMismatches([{ i: 'i/lf', w: 'w/crlf', path: 'src/x.ts' }])).toHaveLength(1)
  })
  it('marca un blob en CRLF guardado en LF (flip inverso)', () => {
    expect(eolMismatches([{ i: 'i/crlf', w: 'w/lf', path: 'src/x.ts' }])).toHaveLength(1)
  })
  it('no marca cuando la clase coincide', () => {
    expect(eolMismatches([{ i: 'i/lf', w: 'w/lf', path: 'a' }])).toHaveLength(0)
    expect(eolMismatches([{ i: 'i/crlf', w: 'w/crlf', path: 'b' }])).toHaveLength(0)
    expect(eolMismatches([{ i: 'i/mixed', w: 'w/mixed', path: 'c' }])).toHaveLength(0)
  })
  it('ignora binarios/no-texto (git no los normaliza)', () => {
    expect(eolMismatches([{ i: 'i/-text', w: 'w/-text', path: 'logo.png' }])).toHaveLength(0)
    expect(eolMismatches([{ i: 'i/lf', w: 'w/-text', path: 'raro.bin' }])).toHaveLength(0)
  })
  it('encuentra el desajuste aunque haya muchos archivos correctos', () => {
    const rows: EolRow[] = [
      { i: 'i/lf', w: 'w/lf', path: 'ok1' },
      { i: 'i/crlf', w: 'w/crlf', path: 'ok2' },
      { i: 'i/lf', w: 'w/mixed', path: 'malo' },
    ]
    expect(eolMismatches(rows)).toEqual(['malo: indice=lf -> arbol=mixed'])
  })
})
