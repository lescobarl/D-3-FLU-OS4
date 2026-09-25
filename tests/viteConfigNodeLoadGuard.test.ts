/**
 * P6.13 - el config de Vite se tiene que poder CARGAR en Node.
 *
 * CONTEXTO MEDIDO: `npm run build` no arrancaba. No fallaba al compilar, fallaba
 * al CARGAR la config: TypeError: Cannot read properties of undefined (reading
 * 'DEV') y despues ('VITE_APP_NAME'). Vite empaqueta la config y la importa en
 * Node, donde `import.meta.env` NO existe; la cadena vite.config.ts ->
 * src/server/* -> src/core/config/appConfig.ts lee sus VITE_* en scope de modulo.
 *
 * La prueba empaqueta el config como lo empaqueta Vite y lo importa EN UN
 * PROCESO NODE HIJO, no dentro de Vitest: Vitest corre con el entorno de Vite y
 * alli `import.meta.env` SI existe, asi que medido dentro el fallo seria
 * invisible. El detector se comprueba por los dos lados (prueba de mutacion): un
 * modulo que lee import.meta.env.X en scope de modulo tiene que reventar, y uno
 * que usa la guarda no. Sin eso el guard podria estar en verde midiendo otra cosa.
 *
 * Ademas fija la decision que pedia el item: `build.rollupOptions.external` no
 * puede nombrar nada instalado en node_modules. Marcar react/three/r3f/drei/
 * zustand/@huggingface/transformers como external dejaba el dist con imports
 * desnudos que el navegador no resuelve (index.html no tiene importmap):
 * medido, la auditoria del dist (47 chunks) queda en 0 imports desnudos.
 */
import { buildSync } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/**
 * Los bundles de prueba viven DENTRO del proyecto: el config importa 'vite',
 * 'react', etc. como external y desde el directorio temporal del sistema esa
 * resolucion no existe (el test fallaba por eso, no por el fallo que vigila).
 */
const SANDBOX = join(ROOT, 'node_modules', '.cache', 'vite-config-guard')

function sandbox(nombre: string): string {
  const dir = join(SANDBOX, nombre)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Empaqueta un modulo tal como Vite empaqueta el config (Node + external). */
export function bundleForNode(entry: string, outfile: string): void {
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    packages: 'external',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  })
}

/** Codigo del runner: importa el bundle, resuelve la config y reporta plugins. */
const RUNNER = [
  'const url = process.argv[2]',
  'let mod',
  'try { mod = await import(url) } catch (e) { console.error(String(e)); process.exit(3) }',
  'let config = mod.default',
  'if (typeof config === "function") config = await config({ mode: "test", command: "build" })',
  'console.log("plugins=" + (config?.plugins?.length ?? -1))',
].join('\n')

/**
 * Importa el bundle en un proceso Node LIMPIO (sin el entorno de Vite de
 * Vitest). Devuelve stdout, o null si el import revienta.
 */
export function loadsInNode(outfile: string): string | null {
  const runner = outfile.replace(/\.mjs$/, '') + '.runner.mjs'
  writeFileSync(runner, RUNNER + '\n', 'utf8')
  try {
    return execFileSync(process.execPath, [runner, pathToFileURL(outfile).href], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }
}

/** Paquetes declarados por la app que ademas estan instalados (empaquetables). */
export function paquetesInstalados(pkg: {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}): Set<string> {
  const declarados = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]
  return new Set(declarados.filter((d) => existsSync(join('node_modules', d))))
}

/** Externals que se podrian empaquetar (estan instalados) y no deberian estarlo. */
export function externalsQueSePodrianEmpaquetar(external: string[], instalados: Set<string>): string[] {
  return external.filter((e) => {
    const raiz = e.startsWith('@') ? e.split('/').slice(0, 2).join('/') : e.split('/')[0]
    return instalados.has(raiz)
  })
}

/** Lista `external` declarada en el config real. */
export function externalesDelConfig(source: string): string[] {
  const m = source.match(/external:\s*\[([^\]]*)\]/s)
  if (!m) throw new Error('no se pudo leer `external` de vite.config.ts')
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

describe('P6.13 configEnNode - el config de Vite carga en Node', () => {
  it('el detector marca la entrada infractora y no la correcta (prueba de mutacion)', () => {
    const dir = sandbox('sintetico')
    const malo = join(dir, 'malo.mjs')
    writeFileSync(malo, 'export const IS_DEV = import.meta.env.DEV ? 1 : 0\n', 'utf8')
    expect(loadsInNode(malo), 'el detector NO marca la lectura en scope de modulo').toBeNull()

    const bueno = join(dir, 'bueno.mjs')
    writeFileSync(bueno, 'export const IS_DEV = Boolean(import.meta.env?.DEV)\n', 'utf8')
    expect(loadsInNode(bueno), 'el detector marca una lectura que si es segura').not.toBeNull()
  })

  it('la config real se empaqueta, se importa en Node limpio y produce plugins', () => {
    const dir = sandbox('real')
    const out = join(dir, 'vite.config.mjs')
    bundleForNode(join(ROOT, 'vite.config.ts'), out)
    const salida = loadsInNode(out)
    expect(salida, 'el config de Vite NO carga en Node (P6.13 vuelve)').not.toBeNull()
    expect(salida, 'la config no produjo plugins: los proxies no se cargaron').toContain('plugins=4')
  })

  it('external no nombra nada instalado, que si se puede empaquetar', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    const instalados = paquetesInstalados(pkg)
    expect(instalados.size, 'no se pudieron leer las dependencias instaladas').toBeGreaterThan(0)
    expect(
      externalsQueSePodrianEmpaquetar(['react', 'three', '@huggingface/transformers'], instalados),
      'el detector no marca paquetes instalados marcados como external',
    ).toEqual(['react', 'three', '@huggingface/transformers'])

    const external = externalesDelConfig(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8'))
    const malos = externalsQueSePodrianEmpaquetar(external, instalados)
    expect(
      malos,
      'estos paquetes estan instalados y aun asi se marcan external: el dist queda\n' +
        'con imports desnudos que el navegador no puede resolver (index.html no tiene\n' +
        'importmap), y la composicion del bundle deja de ser medible:\n  ' +
        malos.join('\n  '),
    ).toEqual([])
  })
})
