/**
 * orphanModules - ningun modulo de PRODUCCION inalcanzable.
 *
 * POR QUE ESTE GUARD: `huerfanosGuard` (C17) y `modulosMuertosGuard` (C16) son
 * LISTAS FIJAS escritas a mano: solo vigilan las rutas que alguien recordo anadir.
 * Cualquier modulo que quede huerfano DESPUES es invisible para ellos, y ninguno
 * de los dos esta en `lint:guards`. Este guard cierra ese agujero por ESCANEO:
 * no enumera rutas conocidas, sino que calcula la alcanzabilidad desde los
 * entrypoints reales (`src/main.tsx` y `vite.config.ts`) y exige 0 modulos de
 * produccion que nadie importe.
 *
 * ALCANCE: es un guard de modulo COMPLETO (fichero sin importador real en el
 * grafo de produccion). NO mide exports sueltos sin usar dentro de un fichero
 * vivo, ni tablas de datos muertas: cada una de esas clases merece su propio
 * hito con su propio criterio (no se mezclan).
 *
 * EXCLUSIONES (no son codigo de produccion alcanzable por import):
 *  - `*.d.ts`      : declaraciones ambientales (tipan JS, no se importan en runtime).
 *  - `src/server/**`: middleware del dev-server; lo referencia `vite.config.ts`.
 *  - `src/dev/**`  : arnes de desarrollo, gateado aparte en `main.tsx`.
 *  - `*.worker.js`/`*.processor.js`: se cargan por `new URL(...)`, no por import.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, posix, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const SRC_EXT = /\.(ts|tsx|js|jsx|mjs)$/
// `src/voice/server.ts` es la fachada de SERVIDOR del modulo de voz (R7): la consumen los
// middlewares de `src/server/**`, que estan EXCLUIDOS del grafo por ser dev-server. Sin
// declararla entrypoint, su unico importador queda fuera y la fachada parece huerfana.
const ENTRYPOINTS = ['src/main.tsx', 'vite.config.ts', 'src/voice/api/server.ts']

/** Un fichero esta exento del escaneo por no ser produccion alcanzable por import. */
export function isExcluded(rel: string): boolean {
  if (rel.endsWith('.d.ts')) return true
  if (rel.startsWith('src/server/')) return true
  if (rel.startsWith('src/dev/')) return true
  return /\.(worker|processor)\.(js|ts)$/.test(rel)
}

/** Referencias que CREAN un enlace: import/export-from, import() dinamico, require y URL de worker. */
const REF = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|new\s+URL\(\s*['"]([^'"]+)['"]/g

/** Resuelve un especificador relativo al fichero que lo escribe, contra el conjunto de rutas existentes. */
export function resolveSpec(spec: string, fromRel: string, exists: Set<string>): string | null {
  if (!spec.startsWith('.')) return null
  const full = posix.normalize(posix.join(posix.dirname(fromRel), spec))
  const candidates = [
    full,
    `${full}.ts`, `${full}.tsx`, `${full}.js`, `${full}.jsx`, `${full}.mjs`,
    `${full}/index.ts`, `${full}/index.tsx`, `${full}/index.js`, `${full}/index.jsx`,
  ]
  for (const c of candidates) if (exists.has(c)) return c
  return null
}

/** Aristas salientes de un fichero (a que otros ficheros del conjunto referencia). */
export function edgesOf(rel: string, read: (r: string) => string, exists: Set<string>): string[] {
  const out: string[] = []
  const src = read(rel)
  let m: RegExpExecArray | null
  REF.lastIndex = 0
  while ((m = REF.exec(src))) {
    const spec = m[1] || m[2] || m[3] || m[4]
    if (!spec) continue
    const t = resolveSpec(spec, rel, exists)
    if (t && t !== rel) out.push(t)
  }
  return out
}

/** Ficheros de produccion (tras exclusiones) que ningun entrypoint alcanza. */
export function unreachableModules(
  files: string[],
  read: (r: string) => string,
  entrypoints: string[],
): string[] {
  const exists = new Set(files)
  const reachable = new Set<string>()
  const stack = entrypoints.filter((e) => exists.has(e))
  while (stack.length) {
    const cur = stack.pop() as string
    if (reachable.has(cur)) continue
    reachable.add(cur)
    for (const t of edgesOf(cur, read, exists)) if (!reachable.has(t)) stack.push(t)
  }
  return files
    .filter((f) => !isExcluded(f) && !reachable.has(f))
    .sort()
}

/** Lista recursiva de ficheros bajo `dir`, en rutas relativas a la raiz del repo. */
function listFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) listFiles(full, acc)
    else if (SRC_EXT.test(e.name)) acc.push(relative(ROOT, full).replace(/\\/g, '/'))
  }
  return acc
}

describe('orphanModules - sin modulos de produccion inalcanzables', () => {
  it('todo modulo de src/ lo alcanza un entrypoint (main.tsx o vite.config.ts)', () => {
    const files = listFiles(SRC)
    const read = (r: string) => readFileSync(join(ROOT, r), 'utf8')
    const orphans = unreachableModules(files, read, ENTRYPOINTS)
    expect(
      orphans,
      `Modulos de produccion que nadie importa (N=${orphans.length}):\n  ${orphans.join('\n  ')}`,
    ).toEqual([])
  })
})

describe('orphanModules - el detector no es decorativo', () => {
  const graph: Record<string, string> = {
    'src/main.tsx': "import { a } from './a'\n",
    'src/a.ts': "import { b } from './b'\nexport const a = b\n",
    'src/b.ts': 'export const b = 1\n',
    'src/orphan.ts': 'export const huerfano = 1\n',
    'src/dead-imports-orphan.ts': "import { b } from './b'\nexport const z = b\n",
    'src/worker.worker.js': 'export const w = 1\n',
    'src/server/proxy.ts': 'export const p = 1\n',
  }
  const read = (r: string) => graph[r] ?? ''
  const files = Object.keys(graph)

  it('marca el modulo que nadie alcanza y no el que si', () => {
    expect(unreachableModules(files, read, ['src/main.tsx'])).toEqual([
      'src/dead-imports-orphan.ts',
      'src/orphan.ts',
    ])
  })

  it('un huerfano que importa a otro NO resucita a su dependencia', () => {
    // dead-imports-orphan.ts importa b, pero nadie lo importa a EL: ni el ni b cuentan
    // como alcanzables. b solo se salva por la cadena main -> a -> b.
    expect(unreachableModules(files, read, ['src/main.tsx'])).not.toContain('src/b.ts')
  })

  it('usa el URL de worker como enlace (no lo marca huerfano)', () => {
    const g: Record<string, string> = {
      'src/main.tsx': "const w = new Worker(new URL('./worker.worker.js', import.meta.url))\n",
      'src/worker.worker.js': 'export const w = 1\n',
    }
    expect(unreachableModules(Object.keys(g), (r) => g[r] ?? '', ['src/main.tsx'])).toEqual([])
  })

  it('excluye d.ts, server y dev del criterio (no son produccion por import)', () => {
    expect(isExcluded('src/types/x.d.ts')).toBe(true)
    expect(isExcluded('src/server/proxy.ts')).toBe(true)
    expect(isExcluded('src/dev/asrLab/AsrLab.tsx')).toBe(true)
    expect(isExcluded('src/voice/workers/voiceId.worker.js')).toBe(true)
    expect(isExcluded('src/App.tsx')).toBe(false)
  })
})
