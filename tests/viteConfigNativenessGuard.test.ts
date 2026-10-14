// ============================================================
// viteConfigNativenessGuard - el grafo del config es cargable por el loader NATIVO.
// ------------------------------------------------------------
// DEFECTO MEDIDO (Vite 8.3.4, 2026-10-14): al arrancar el dev server (o el build), Vite
// escupia un aviso de ~250 lineas -"Your Vite config uses features that are unsupported by
// 'configLoader: native', which is planned to become the default in a future major version"-:
// 251 imports + 1 import-de-index del GRAFO DEL BUNDLE del config sin extension de fichero.
// Arreglado en el commit que acompana a esta barrera (252 imports con su extension real).
//
// SEMANTICA = la de Vite (medida, no supuesta): el aviso cubre los modulos del BUNDLE
// (los `import type` NO traen un modulo al bundle, asi que las importaciones propias de ese
// modulo no se revisan) pero SI revisa los imports `type` escritos en los modulos del
// bundle. Este guard recorre el mismo grafo con la misma regla: expande solo aristas de
// runtime y marca TODOS los imports sin extension de los modulos alcanzados.
//
// NACE ROJO: con el arbol anterior al arreglo marcaba los 252 (medido con el stash del fix,
// misma lista que el aviso de Vite). PRUEBA DE DETECTOR: con un grafo sintetico con un
// import sin extension, marca; y no marca el que ya la lleva.
// ============================================================
import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const ROOT = process.cwd()
const EXTS = ['.ts', '.tsx', '.js', '.jsx']

/** Fichero real al que resuelve un import relativo (o null) segun el predicado `existe`. */
export function resuelve(fromFile: string, spec: string, existe: (f: string) => boolean): string | null {
  if (!spec.startsWith('.')) return null
  const base = join(dirname(fromFile), spec)
  if (/\.[A-Za-z0-9]+$/.test(spec)) return existe(base) ? base : null
  for (const e of EXTS) if (existe(base + e)) return base + e
  for (const e of EXTS) if (existe(join(base, 'index' + e))) return join(base, 'index' + e)
  return null
}

/** Imports relativos de un fuente: spec, linea y si es `import type` (sin arista de runtime). */
export function relativeImports(src: string): Array<{ spec: string; line: number; typeOnly: boolean }> {
  const out: Array<{ spec: string; line: number; typeOnly: boolean }> = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|(?:^|\n)\s*import\s+)(['"])(\.[^'"]+)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1
    const linea = src.slice(lineStart, m.index).trim()
    if (linea.startsWith('//') || linea.startsWith('*') || linea.startsWith('/*')) continue
    const typeOnly = /^(?:import|export)\s+type\s/.test(linea)
    out.push({ spec: m[2], line: src.slice(0, m.index).split('\n').length, typeOnly })
  }
  return out
}

const existeReal = (f: string) => {
  try {
    return statSync(f).isFile()
  } catch {
    return false
  }
}

/** Imports sin extension del grafo del bundle del config, como `archivo:linea: spec`. */
export function importsSinExtension(
  entrada: string,
  leer: (f: string) => string,
  existe: (f: string) => boolean,
  raiz = ROOT,
): string[] {
  const cola = [entrada]
  const vistos = new Set<string>()
  const malos: string[] = []
  const rel = (f: string) => relative(raiz, f).replace(/\\/g, '/')
  while (cola.length) {
    const file = cola.shift() as string
    if (vistos.has(file) || !existe(file)) continue
    vistos.add(file)
    for (const { spec, line, typeOnly } of relativeImports(leer(file))) {
      const target = resuelve(file, spec, existe)
      if (!target) continue
      if (!/\.[A-Za-z0-9]+$/.test(spec)) {
        malos.push(`${rel(file)}:${line}: ${spec} (resuelve a ${rel(target)})`)
      }
      if (!typeOnly) cola.push(target)
    }
  }
  return malos
}

describe('el grafo del config de Vite carga sin extensiones implicitas', () => {
  it('0 imports relativos sin extension en el grafo del bundle del config', () => {
    const malos = importsSinExtension(
      join(ROOT, 'vite.config.ts'),
      (f) => readFileSync(f, 'utf8'),
      existeReal,
    )
    expect(malos, 'imports sin extension (si aparecen, Vite avisa en consola)').toEqual([])
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): sintetico sin extension se marca, con extension no', () => {
    const fixture: Record<string, string> = {
      'a.ts': "import { x } from './b.ts'\nimport { y } from './c'\nimport type { Z } from './solo-tipo'\n",
      'b.ts': 'export const x = 1\n',
      'c.ts': 'export const y = 1\n',
      'solo-tipo.ts': 'export type Z = number\n',
    }
    const raiz = join(process.cwd(), 'fixture-sintetica')
    const clave = (f: string) => relative(raiz, f).replace(/\\/g, '/')
    const leer = (f: string) => fixture[clave(f)] || ''
    const existe = (f: string) => Boolean(fixture[clave(f)])
    const malos = importsSinExtension(join(raiz, 'a.ts'), leer, existe, raiz)
    // Marca el import sin extension (./c y el type-only './solo-tipo'); NO marca './b.ts'.
    expect(malos).toHaveLength(2)
    expect(malos.join('\n')).toContain('./c')
    expect(malos.join('\n')).toContain('./solo-tipo')
    expect(malos.join('\n')).not.toContain('./b')
  })
})
