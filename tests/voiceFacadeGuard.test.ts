// @vitest-environment node
/**
 * R7 — FACHADA DEL MÓDULO DE VOZ.
 *
 * `src/voice/lib/**` es INTERNO. Ningún archivo de producción fuera de `src/voice` puede
 * importarlo por su ruta profunda: la superficie pública son DOS entradas declaradas
 * (`src/voice/index.ts` para cliente y `src/voice/server.ts` para el dev-server).
 *
 * El detector se prueba con una entrada infractora y una limpia (no es decorativo), y el
 * caso de barrido exige ver los archivos: un guard que no ve la fuente no es una barrera.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()
const SRC = join(RAIZ, 'src')
const VOICE = join(SRC, 'voice')
const LIB = join(VOICE, 'lib')

/**
 * Superficie pública: UN módulo por CONCERN en `src/voice/api/`. No hay barrel único a
 * propósito: un `index` que re-exporte todo obliga a cada consumidor a evaluar el grafo
 * completo (el store, la identidad, el almacenamiento) al importar `FLU_CONFIG`.
 */
const ENTRADAS = [
  'voice/api/config',
  'voice/api/uiConfig',
  'voice/api/audio',
  'voice/api/speech',
  'voice/api/conversation',
  'voice/api/identity',
  'voice/api/commands',
  'voice/api/storage',
  'voice/api/sessionLog',
  'voice/api/media',
  'voice/api/workers',
  'voice/api/server',
]

function archivosDe(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entrada.name)
    if (entrada.isDirectory()) archivosDe(p, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entrada.name)) out.push(p)
  }
  return out
}

/** Resuelve un especificador relativo a un archivo fuente (mismo criterio que Vite/TS). */
function resuelve(desde: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const abs = resolve(dirname(desde), spec)
  const candidatos = [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`, `${abs}.jsx`, `${abs}.mjs`, join(abs, 'index.ts'), join(abs, 'index.js')]
  return candidatos.find((c) => existsSync(c)) || null
}

/** Especificadores importados por un archivo (import, export-from, dynamic import). */
export function especificadores(texto: string): string[] {
  const out: string[] = []
  const re = /(?:import|export)\s+(?:type\s+)?[^'";]*?\s+from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) out.push(m[1] || m[2])
  return out
}

/** ¿El especificador APUNTA al interior de `src/voice/lib`? Dueno unico del predicado. */
export function apuntaAlInteriorDeVozLib(desde: string, spec: string): boolean {
  if (spec.startsWith('@voice/lib/')) return true
  const destino = resuelve(desde, spec)
  return Boolean(destino && destino !== LIB && destino.startsWith(LIB + sep))
}

describe('R7 — fachada del módulo de voz', () => {
  it('ningun archivo de produccion fuera de src/voice importa src/voice/lib/**', () => {
    const infractores: string[] = []
    let escaneados = 0
    for (const archivo of archivosDe(SRC)) {
      if (archivo.startsWith(VOICE + sep) || archivo === VOICE) continue
      escaneados += 1
      const texto = readFileSync(archivo, 'utf8')
      for (const spec of especificadores(texto)) {
        if (apuntaAlInteriorDeVozLib(archivo, spec)) infractores.push(`${relative(RAIZ, archivo).replace(/\\/g, '/')} -> ${spec}`)
      }
    }
    expect(escaneados, 'el guard tiene que VER los archivos').toBeGreaterThan(50)
    expect(infractores, `imports profundos a voice/lib (N=${infractores.length})`).toEqual([])
  })

  it('las dos entradas existen y declaran la superficie SIN export *', () => {
    for (const entrada of ENTRADAS) {
      const archivo = join(SRC, `${entrada}.ts`)
      expect(existsSync(archivo), `falta la fachada ${entrada}`).toBe(true)
      const texto = readFileSync(archivo, 'utf8')
      expect(texto, `${entrada} no puede re-exportar a ciegas`).not.toMatch(/export\s+\*\s+from/)
    }
  })

  it('MUTACION: el detector marca un import profundo y perdona la fachada', () => {
    const archivo = join(SRC, 'components', 'ImageGrid.tsx')
    expect(apuntaAlInteriorDeVozLib(archivo, '../voice/lib/fluConfig')).toBe(true)
    expect(apuntaAlInteriorDeVozLib(archivo, '../voice/api/config')).toBe(false)
    expect(apuntaAlInteriorDeVozLib(archivo, '@voice/lib/fluConfig')).toBe(true)
    expect(especificadores(`import { x } from '../voice/lib/fluConfig'\nawait import('../voice/lib/asr/asrDefaults')`)).toEqual([
      '../voice/lib/fluConfig',
      '../voice/lib/asr/asrDefaults',
    ])
  })
})
