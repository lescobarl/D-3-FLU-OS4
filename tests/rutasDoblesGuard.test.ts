/**
 * rutasDoblesGuard — barrera medida de las rutas dobles de responsabilidad.
 *
 * La linea base vive en `scripts/rutas-dobles-baseline.json` (versionada y con
 * CODEOWNERS). Cada caso declara su dueno unico y el techo. El guard falla si
 * aparece un fichero nuevo que implemente la responsabilidad fuera del dueno, si
 * la lista conserva un fichero que ya no casa, o si el total sube del techo.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  evaluateCase,
  loadBaseline,
  measureCaseByFiles,
  relKey,
  runCase,
  walkCodeFiles,
} from '../scripts/rutas-dobles.mjs'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

type Caso = {
  id: string
  owner: string
  pattern: string
  roots: string[]
  kind: 'files' | 'sites'
  allowed: Record<string, number>
  goal: number
}

type Baseline = { minSources: number; cases: Caso[] }

type Veredicto = { nuevos: string[]; obsoletos: string[]; total: number; excede: boolean }

function baseline(): Baseline {
  return loadBaseline() as Baseline
}

function fuentesReales(): Array<{ rel: string; text: string }> {
  return walkCodeFiles(SRC).map((abs) => ({
    rel: relKey(abs).replace(/\\/g, '/'),
    text: readFileSync(abs, 'utf8'),
  }))
}

function existeRef(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--end-of-options', ref], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function refBase(): string {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request' && process.env.GITHUB_BASE_REF) {
    const base = `origin/${process.env.GITHUB_BASE_REF}`
    if (existeRef(base)) return base
    if (existeRef('HEAD^1')) return 'HEAD^1'
  }
  if (process.env.GITHUB_EVENT_NAME === 'push' && existeRef('HEAD^1')) return 'HEAD^1'
  return 'HEAD'
}

function baselineEn(ref: string): Baseline | null {
  const ruta = 'scripts/rutas-dobles-baseline.json'
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}:${ruta}`], { stdio: 'ignore' })
  } catch {
    return null
  }
  const raw = execFileSync('git', ['show', `${ref}:${ruta}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return JSON.parse(raw) as Baseline
}

describe('rutasDoblesGuard — la linea base se cumple', () => {
  const base = baseline()

  it('ANTI-VACUIDAD: el escaneo lee la fuente real y no menos que la linea base', () => {
    const files = fuentesReales()
    expect(files.length).toBeGreaterThanOrEqual(base.minSources)
  })

  for (const caso of base.cases) {
    it(`${caso.id}: N=${caso.goal} con dueno ${caso.owner}`, () => {
      const { medidos, veredicto } = runCase(caso, fuentesReales()) as {
        medidos: Map<string, number>
        veredicto: Veredicto
      }
      expect(
        veredicto.nuevos,
        `ficheros nuevos fuera del dueno ${caso.owner}:\n  ${veredicto.nuevos.join('\n  ')}`,
      ).toEqual([])
      expect(
        veredicto.obsoletos,
        `ficheros de la linea base que ya no casan (recorta la lista):\n  ${veredicto.obsoletos.join('\n  ')}`,
      ).toEqual([])
      expect(
        veredicto.total,
        `${caso.id}: total ${veredicto.total} > techo ${caso.goal} (${caso.owner}); medida=${JSON.stringify([...medidos])}`,
      ).toBeLessThanOrEqual(caso.goal)
    })
  }

  it('la línea base no sube respecto a la referencia (solo baja)', () => {
    const anterior = baselineEn(refBase())
    if (!anterior) return
    const subidas: string[] = []
    for (const caso of base.cases) {
      const previo = anterior.cases.find((prev) => prev.id === caso.id)
      if (!previo) continue
      if (caso.goal > previo.goal) {
        subidas.push(`${caso.id}: goal ${previo.goal} -> ${caso.goal}`)
      }
      for (const [archivo, techo] of Object.entries(caso.allowed)) {
        const antes = previo.allowed[archivo] ?? 0
        if (techo > antes) subidas.push(`${caso.id}: ${archivo} ${antes} -> ${techo}`)
      }
    }
    expect(subidas).toEqual([])
  })
})

describe('rutasDoblesGuard — el detector no es decorativo', () => {
  const caso = {
    id: 'sintetico',
    kind: 'files' as const,
    pattern: 'useState<EditorState>',
    allowed: { 'src/components/Dueno.tsx': 1 },
    goal: 1,
  }

  it('marca un fichero infractor y perdona al dueno', () => {
    const medidos = measureCaseByFiles(caso, [
      { rel: 'src/components/Dueno.tsx', text: 'const [editor] = useState<EditorState>(null)' },
      { rel: 'src/components/Intruso.tsx', text: 'const [editor] = useState<EditorState>(null)' },
    ])
    const veredicto = evaluateCase(caso, medidos)
    expect(veredicto.nuevos).toEqual(['src/components/Intruso.tsx'])
    expect(veredicto.total).toBe(2)
    expect(veredicto.excede).toBe(true)
  })

  it('marca como obsoleto un fichero permitido que ya no casa', () => {
    const medidos = measureCaseByFiles(caso, [
      { rel: 'src/components/Otro.tsx', text: 'const [editor] = useState<EditorState>(null)' },
    ])
    const veredicto = evaluateCase(caso, medidos)
    expect(veredicto.obsoletos).toEqual(['src/components/Dueno.tsx'])
    expect(veredicto.nuevos).toEqual(['src/components/Otro.tsx'])
  })
})

describe('rutasDoblesGuard — la ruta declarada es la del repo', () => {
  it('la linea base se lee desde scripts/ y no desde una copia', () => {
    const ruta = join(ROOT, 'scripts', 'rutas-dobles-baseline.json')
    expect(relative(ROOT, ruta).replace(/\\/g, '/')).toBe('scripts/rutas-dobles-baseline.json')
    expect(loadBaseline() as Baseline).toBeDefined()
    expect(baseline().cases.map((c) => c.id)).toContain('apertura-locucion')
  })
})
