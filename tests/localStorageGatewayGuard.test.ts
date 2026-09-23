/**
 * P5.9 - localStorageGateway: un solo sitio mira el almacenamiento.
 *
 * CONTEXTO MEDIDO: 118 lineas de src/ nombraban localStorage por su cuenta (cada
 * una decidiendo si el almacen existe y a donde caer) y habia 4 invenciones
 * locales de "storage seguro" (resolveSafeStorage, readStorage/writeStorage,
 * safeGet, getLocalStorage). Hoy la unica puerta es
 * src/core/storage/localStore.ts, y este guard impide que vuelva a abrirse.
 *
 * El detector se prueba por los dos lados (prueba de mutacion): se le da una
 * linea infractora sintetica y tiene que marcarla; y se le da el TEXTO de un
 * comentario o de un string y NO tiene que marcarla. Sin eso el guard podria
 * estar en verde midiendo otra cosa.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** La unica puerta: es el unico fichero que puede nombrar el identificador. */
export const GATEWAY = 'src/core/storage/localStore.ts'

/** Extensiones que entran en el universo medido. */
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs)$/

/**
 * Vacia el CONTENIDO de los literales ('...', "..." y el TEXTO de los templates)
 * conservando las expresiones `${...}`, que si son codigo: nombrar localStorage
 * en un mensaje de log no es un acceso, pero `${localStorage.length}` si lo es.
 */
export function maskLiterals(line: string): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c !== "'" && c !== '"' && c !== '`') {
      out += c
      i += 1
      continue
    }
    const quote = c
    out += quote
    i += 1
    while (i < line.length) {
      const d = line[i]
      if (d === '\\') {
        i += 2
        continue
      }
      if (quote === '`' && d === '$' && line[i + 1] === '{') {
        let depth = 1
        out += '${'
        i += 2
        while (i < line.length && depth > 0) {
          if (line[i] === '{') depth += 1
          else if (line[i] === '}') depth -= 1
          if (depth > 0) out += line[i]
          i += 1
        }
        out += '}'
        continue
      }
      if (d === quote) {
        out += quote
        i += 1
        break
      }
      i += 1
    }
  }
  return out
}

const isComment = (line: string): boolean => /^\s*(?:\/\/|\*|\/\*)/.test(line)

/** Lineas (1-based) que nombran el identificador fuera de un literal/comentario. */
export function directStorageLines(source: string): number[] {
  const hits: number[] = []
  source.split(/\r?\n/).forEach((line, i) => {
    if (isComment(line)) return
    if (/\blocalStorage\b/.test(maskLiterals(line))) hits.push(i + 1)
  })
  return hits
}

/** Ficheros de src/ (sin la puerta) con algun acceso directo. */
export function offenders(readSource: (f: string) => string, files: string[]): string[] {
  return files
    .filter((f) => SOURCE_RE.test(f))
    .filter((f) => f !== GATEWAY)
    .filter((f) => directStorageLines(readSource(f)).length > 0)
}

const ROOT = process.cwd()

function trackedSources(): string[] {
  return execSync('git ls-files src', { encoding: 'utf8', cwd: ROOT }).split('\n').filter(Boolean)
}

describe('P5.9 localStorageGateway - la puerta es la unica que mira el almacen', () => {
  it('el detector marca el acceso directo y la guarda, y no el comentario ni el string', () => {
    expect(directStorageLines("const raw = localStorage.getItem('k');")).toEqual([1])
    expect(directStorageLines("if (typeof localStorage === 'undefined') return {};")).toEqual([1])
    expect(directStorageLines('localSet(k, v);')).toEqual([])
    expect(directStorageLines("// antes: window.localStorage.setItem(k, v)")).toEqual([])
    expect(directStorageLines("const msg = 'localStorage no disponible';")).toEqual([])
  })

  it('el detector cuenta la expresion de una plantilla y no su texto (prueba de mutacion)', () => {
    expect(directStorageLines('const n = `${localStorage.length}`;')).toEqual([1])
    expect(directStorageLines('logCaughtError(`[x] localStorage no disponible`);')).toEqual([])
  })

  it('cero accesos directos en src/ fuera de la puerta', () => {
    const files = trackedSources()
    expect(files.length, 'no se pudo leer el universo de ficheros').toBeGreaterThan(100)
    const bad = offenders((f) => readFileSync(join(ROOT, f), 'utf8'), files)
    expect(
      bad,
      'estos ficheros miran localStorage por su cuenta; pasa por ' + GATEWAY + ':\n  ' + bad.join('\n  '),
    ).toEqual([])
  })

  it('la metrica congelada coincide con el detector', () => {
    const out = execSync('node scripts/audit-metric.mjs localstorage-directo', { encoding: 'utf8', cwd: ROOT })
    expect(out.trim(), 'metrica y guard en desacuerdo (el detector derive)').toBe('0')
  })
})
