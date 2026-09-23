/**
 * C53 — higiene (P6.9): tres indicadores del audit, medidos en vez de creídos.
 *
 * El audit de P6.9 denunciaba tres cosas. Al medirlas, DOS eran falsos positivos del
 * propio detector del audit:
 *
 *   1) «91 TODO». No hay un solo marcador TODO real en `src`: las coincidencias que quedan
 *      son la palabra española «TODO/TODOS» («Se listan TODOS los estados»). El detector
 *      del audit buscaba la subcadena sin exigir marca de comentario ni `:`. Aquí se fija
 *      el detector correcto, con su prueba por los dos lados.
 *
 *   2) «audit-metric duplicado». No lo está: `scripts/audit-metric.mjs` (congelado por
 *      hash: es el medidor del gate) cuenta LITERALES CONCRETOS de cada hallazgo
 *      (`uuid-no-v4` = /voice-\$\{Date\.now\(\)\}/, `console-debug` = /console\.debug\(/),
 *      mientras `scripts/auditoria.mjs` (catálogo humano, editable) cuenta CLASES
 *      (`V1` = Date.now()+Math.random(), `V4` = console.log). Ni una sola regex es
 *      idéntica entre los dos. Eso no es duplicación, es la separación que hace segura la
 *      congelación: el medidor del gate NO puede depender del fichero editable.
 *      La prueba levanta un taller sintético y demuestra que cada medidor ve su forma y NO
 *      la del otro: si fueran el mismo detector, el estrecho contaría la forma ancha.
 *
 *   3) «LFS texturas». Es real, pero no se ejecuta aquí sin romper la trazabilidad: ver el
 *      VEREDICTO en plans/ledger.json (P6.9). Lo que sí se fija es la barrera de peso: un
 *      activo nuevo >= 2 MB obliga a decidir (LFS o allowlist), no entra por silencio.
 */
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = process.cwd()

// ---------------------------------------------------------------------------
// 1) Marcadores de deuda reales
// ---------------------------------------------------------------------------

/** Marcador real: token en MAYÚSCULAS como marca de comentario, con `:` o solo. */
export function realDebtMarkers(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(?:\/\/|\/\*|\*)\s*(TODO|FIXME|HACK)\b\s*(?::|$|\()/)
    if (m) out.push(m[1])
  }
  return out
}

function walkSrc(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walkSrc(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('C53 higiene — marcadores de deuda reales', () => {
  it('src no tiene un solo TODO/FIXME/HACK de verdad', () => {
    const hits: string[] = []
    for (const f of walkSrc(join(ROOT, 'src'))) {
      const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/')
      for (const mark of realDebtMarkers(readFileSync(f, 'utf8'))) hits.push(`${rel}:${mark}`)
    }
    expect(hits, `marcadores reales (N=${hits.length}):\n  ${hits.join('\n  ')}`).toEqual([])
  })

  it('el detector no confunde la palabra «TODOS» con deuda (falso positivo del audit)', () => {
    expect(realDebtMarkers('// Se listan TODOS los estados (no solo pending)')).toEqual([])
    expect(realDebtMarkers(' * Genérico para TODOS los juegos: el enrutador lo consulta')).toEqual([])
    expect(realDebtMarkers('// TODO el manejo de Web Speech API vive aquí')).toEqual([])
  })

  it('el detector sí ve la deuda real (no es decorativo)', () => {
    expect(realDebtMarkers('// TODO: unificar con el motor')).toEqual(['TODO'])
    expect(realDebtMarkers('/* FIXME: rompe en iOS */')).toEqual(['FIXME'])
    expect(realDebtMarkers(' * HACK: parche temporal')).toEqual(['HACK'])
    expect(realDebtMarkers('  // TODO')).toEqual(['TODO'])
  })
})

// ---------------------------------------------------------------------------
// 2) Los dos auditores: distintos por diseño, y los dos vivos
// ---------------------------------------------------------------------------

const AM = join(ROOT, 'scripts', 'audit-metric.mjs')
const AU = join(ROOT, 'scripts', 'auditoria.mjs')

const FIXTURE: Record<string, string> = {
  'src/core/narrowVoiceId.js': 'export const id = () => `voice-${Date.now()}`\n',
  'src/core/narrowDebug.ts': "export function d(){ console.debug('x') }\n",
  'src/core/broadGen.ts': 'export const n = () => Date.now() + Math.random()\n',
  'src/core/broadLog.ts': "export function l(){ console.log('x') }\n",
}

/** Taller sintético con solo las formas pedidas, para ver qué ve cada medidor. */
function fixtureDir(only?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'flu-hyg-'))
  mkdirSync(join(dir, 'src', 'core'), { recursive: true })
  mkdirSync(join(dir, 'tests'), { recursive: true })
  for (const [rel, body] of Object.entries(FIXTURE)) {
    if (only && !rel.includes(only)) continue
    writeFileSync(join(dir, rel), body, 'utf8')
  }
  return dir
}

function frozenMetric(id: string, cwd: string): number {
  return Number(execFileSync('node', [AM, id], { cwd, encoding: 'utf8' }).trim())
}

function catalogToday(id: string, cwd: string): number {
  const json = JSON.parse(
    execFileSync('node', [AU, '--json', '--only', id], { cwd, encoding: 'utf8' }),
  )
  const row = json.find((r: { id: string }) => r.id === id)
  return Number(row?.today)
}

const tmpDirs: string[] = []
function fx(only?: string): string {
  const d = fixtureDir(only)
  tmpDirs.push(d)
  return d
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})

describe('C53 higiene — los dos auditores no son un duplicado', () => {
  it('el medidor congelado ve SU literal exacto', () => {
    expect(frozenMetric('uuid-no-v4', fx('narrowVoiceId'))).toBe(1)
    expect(frozenMetric('console-debug', fx('narrowDebug'))).toBe(1)
  })

  it('y NO ve la forma ancha del catálogo: no son el mismo detector', () => {
    expect(frozenMetric('uuid-no-v4', fx('broadGen'))).toBe(0)
    expect(frozenMetric('console-debug', fx('broadLog'))).toBe(0)
  })

  it('el catálogo ve SU clase ancha (está vivo, no sordo)', () => {
    expect(catalogToday('V1', fx('broadGen'))).toBeGreaterThan(0)
    expect(catalogToday('V4', fx('broadLog'))).toBeGreaterThan(0)
  })

  it('en el repo real los dos coinciden en 0', () => {
    expect(frozenMetric('uuid-no-v4', ROOT)).toBe(0)
    expect(frozenMetric('console-debug', ROOT)).toBe(0)
    expect(catalogToday('V1', ROOT)).toBe(0)
    expect(catalogToday('V4', ROOT)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 3) Peso de binarios: la barrera que impide que empeore
// ---------------------------------------------------------------------------

const HEAVY_MB = 2
/** Activos ya versionados por encima del umbral: congelados. Un alta nueva exige decisión. */
const HEAVY_ALLOWLIST = [
  'public/ffmpeg/ffmpeg-core.wasm',
  'public/models/Bunny_body.fbx',
  'public/models/Bunny_full.fbx',
  'public/textures/Bunny_Body_1_D.png',
  'public/textures/Bunny_Body_1_N.png',
  'public/textures/Bunny_Body_1_R.png',
  'public/textures/Bunny_Cap_1_D.png',
  'public/textures/Bunny_Cap_1_N.png',
  'public/textures/Bunny_Face_1_D.png',
  'public/textures/Bunny_Face_1_N.png',
  'public/textures/Bunny_Pants_1_D.png',
  'public/textures/Bunny_Pants_1_N.png',
]

function heavyTracked(): string[] {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  return files
    .filter((f) => {
      try {
        return statSync(join(ROOT, f)).size >= HEAVY_MB * 1024 * 1024
      } catch {
        return false
      }
    })
    .sort()
}

describe('C53 higiene — peso de binarios (LFS aplazado a propósito)', () => {
  it('ningún activo pesado nuevo entra sin decisión explícita', () => {
    const found = heavyTracked()
    const news = found.filter((f) => !HEAVY_ALLOWLIST.includes(f))
    expect(news, `activos >=${HEAVY_MB} MB fuera de la allowlist:\n  ${news.join('\n  ')}`).toEqual([])
  })

  it('la allowlist describe la realidad (no es una lista muerta)', () => {
    const present = new Set(heavyTracked())
    const missing = HEAVY_ALLOWLIST.filter((f) => !present.has(f))
    expect(missing, `ya no pesan >=${HEAVY_MB} MB:\n  ${missing.join('\n  ')}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4) Texto versionado sin mojibake
// ---------------------------------------------------------------------------

/**
 * Mojibake = texto UTF-8 leído con la codepage OEM/Windows y vuelto a guardar como UTF-8.
 * Medido en este repo: cp437 (consola), cp850 y cp1252. Cada carácter acentuado se
 * convierte en una pareja delatora; los primeros caracteres de esas parejas son los que
 * busca el detector.
 *
 * Cuidado con el arte ASCII de `plans/*.md`: usa `├──`, `│` y `┬──`, que comparten primer
 * carácter con el mojibake. Por eso la clase de segundos caracteres EXCLUYE el rango de
 * cajas (U+2500-U+257F) salvo `│` (U+2502), que sí es la segunda mitad de 'ó'.
 */
const MOJIBAKE = [
  /[\u251c\u252c\u00d4\u0393][\u00a0-\u00ff\u2502\u2592\u2551\u255c\u2563]/,
  /[\u00c3\u00c2\u00e2][\u0080-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/,
]

export function mojibakeHits(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    for (const re of MOJIBAKE) {
      for (const m of line.matchAll(new RegExp(re.source, 'g'))) out.push(m[0])
    }
  }
  return out
}

describe('C53 higiene — texto versionado sin mojibake', () => {
  it('ningún fichero versionado arrastra UTF-8 mal decodificado', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.(json|md|ts|tsx|js|jsx|mjs|css|html)$/.test(f))
    const bad: string[] = []
    for (const f of files) {
      const hits = mojibakeHits(readFileSync(join(ROOT, f), 'utf8'))
      if (hits.length) bad.push(`${f}: ${hits.length} (${hits.slice(0, 3).join(' ')})`)
    }
    expect(bad, `ficheros con mojibake:\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('el detector no confunde el arte ASCII de los planes con mojibake', () => {
    expect(mojibakeHits('│  ├──────────────────────────┤ │')).toEqual([])
    expect(mojibakeHits('───────────────┬──────────────────────────────┤')).toEqual([])
    expect(mojibakeHits('└───────────────┬─────────────────────────────────────┘')).toEqual([])
    expect(mojibakeHits('├── transitorio  →  resultados[]')).toEqual([])
  })

  it('el detector ve el mojibake real y no marca el texto correcto', () => {
    expect(mojibakeHits('sesión de trabajo: navegación')).toEqual([])
    expect(mojibakeHits('// useNavigationCommands - comandos de navegaci\u00c3\u00b3n')).toHaveLength(1)
    expect(mojibakeHits('la secci\u251c\u2502n 4 del doc')).toHaveLength(1)
    expect(mojibakeHits('Protocolo \u0393\u00c7\u00f6 Guard')).toHaveLength(1)
    expect(mojibakeHits('(secci\u252c\u00ba7.7)')).toHaveLength(1)
    expect(mojibakeHits('a\u251c\u00a1adido de ra\u251c\u2502z')).toHaveLength(2)
  })
})
