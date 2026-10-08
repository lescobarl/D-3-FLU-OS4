/**
 * P7.88 - La puerta (dod) debe cubrir los tests de COMPORTAMIENTO del src tocado.
 *
 * DEFECTO MEDIDO (P7.81 -> P7.88): el cierre de P7.81 corrio el dod del contrato
 * (15 ficheros) y paso en VERDE mientras la suite completa caia con 1 caso ROJO
 * en el test del motor de cuentacuentos. Ese test IMPORTA un fichero de src que
 * el cambio tocaba, pero no estaba en el gate: el unico modo de verlo era correr
 * los 369 ficheros (autorizado aparte). Este guard convierte esa dependencia en
 * MECANICA, sin listas a mano.
 *
 * REGLA: si un cambio toca un fichero de src, todo test que lo IMPORTE (cobertura
 * de comportamiento, deducida del GRAFO DE IMPORTS) tiene que estar en el gate:
 * dod, guard o lint:guards. Si no, el cierre no es valido.
 *
 * No sustituye a 0.22/0.23/0.24: 0.24 cubre los guards de TEXTO sobre el src
 * tocado; esto cubre los tests de COMPORTAMIENTO, que son otro agujero.
 */
import { runAsync } from './_asyncExec'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUARD_FILES } from '../scripts/guard-files.mjs'

const ROOT = process.cwd()
const CONTRACT = JSON.parse(readFileSync(join(ROOT, '.task/contract.json'), 'utf8'))

/** Tests de comportamiento declarados en un comando (dod, guard o lint:guards). */
export function testsDeComando(comando: unknown): string[] {
    return String(comando || '').match(/tests\/[A-Za-z0-9_.\-/]+\.test\.tsx?/g) || []
}

/** true si el test ya corre en el gate (dod, guard o lint:guards). */
export function enElGate(comandos: unknown[], testFile: string): boolean {
    return comandos.some((c) => testsDeComando(c).includes(testFile))
}

/** Rutas candidatas de un import, incluido el `.js` de un import ESM sobre fuente `.ts`. */
export function candidatos(abs: string): string[] {
    const out = [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`, `${abs}.jsx`]
    if (abs.endsWith('.js')) {
        out.push(`${abs.slice(0, -3)}.ts`, `${abs.slice(0, -3)}.tsx`)
    }
    if (abs.endsWith('.jsx')) {
        out.push(`${abs.slice(0, -4)}.tsx`, `${abs.slice(0, -4)}.ts`)
    }
    return out
}

/** Ruta del repo a la que resuelve un import relativo, o null si no es relativo / no existe. */
export function resuelveImport(
    spec: string,
    desde: string,
    ctx: { existe: (p: string) => boolean; raiz: string },
): string | null {
    if (!spec.startsWith('.')) return null
    const abs = resolve(dirname(desde), spec)
    for (const c of candidatos(abs)) {
        if (ctx.existe(c)) return relative(ctx.raiz, c).split(sep).join('/')
    }
    return null
}

/** Tests que IMPORTAN `srcFile` (por el grafo de imports, no por su nombre). */
export function testsQueImportan(
    srcFile: string,
    tests: string[],
    ctx: { leer: (f: string) => string; existe: (p: string) => boolean; raiz: string },
): string[] {
    return tests.filter((t) => {
        const src = ctx.leer(t)
        for (const m of src.matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)) {
            const spec = m[1] || m[2]
            if (spec && resuelveImport(spec, t, ctx) === srcFile) return true
        }
        return false
    })
}

/** El agujero: tests que cubren el src tocado y NO estan en el gate. */
export function sinCobertura(
    srcTocados: string[],
    tests: string[],
    ctx: { leer: (f: string) => string; existe: (p: string) => boolean; raiz: string },
    enGate: (t: string) => boolean,
): string[] {
    const out = new Set<string>()
    for (const src of srcTocados) {
        for (const t of testsQueImportan(src, tests, ctx)) {
            if (!enGate(t)) out.add(`${t} cubre ${src}`)
        }
    }
    return [...out].sort()
}

async function git(args: string[]): Promise<string> {
    return (await runAsync('git', args)).stdout
}

/** Ficheros de src tocados por el cambio en curso (mismo criterio que la puerta). */
export async function srcTocados(base: string): Promise<string[]> {
    const lineas = [
        ...(await git(['diff', '--name-only', base])).split('\n'),
        ...(await git(['diff', '--cached', '--name-only'])).split('\n'),
        ...(await git(['ls-files', '--others', '--exclude-standard'])).split('\n'),
    ]
    return [...new Set(lineas.map((s) => s.trim()).filter(Boolean))]
        .filter((f) => f.startsWith('src/'))
        .sort()
}

const CTX = {
    leer: (f: string) => readFileSync(join(ROOT, f), 'utf8'),
    existe: (p: string) => existsSync(p),
    raiz: ROOT,
}
const TESTS = readdirSync(join(ROOT, 'tests'))
    .filter((f) => /\.test\.tsx?$/.test(f))
    .map((f) => `tests/${f}`)
const COMANDOS = [CONTRACT.dod, CONTRACT.guard, ...GUARD_FILES]

describe('P7.88 - todo test de comportamiento del src tocado corre en el gate', () => {
    it('no hay tests que cubran el src tocado fuera del gate', async () => {
        const malos = sinCobertura(await srcTocados(CONTRACT.base), TESTS, CTX, (t) => enElGate(COMANDOS, t))
        expect(
            malos,
            'Estos tests IMPORTAN ficheros de src que el cambio toca y NO corren en el gate (dod/guard/lint:guards): el cierre no los habria visto (P7.88)',
        ).toEqual([])
    })
})

describe('el detector no es decorativo', () => {
    it('marca al test que cubre el src tocado y NO al que ya esta en el gate', async () => {
        const ctx = {
            leer: () => "import { x } from '../src/juego'",
            existe: (p: string) => p.endsWith('juego.ts') || p.endsWith('juego.test.ts'),
            raiz: ROOT,
        }
        expect(sinCobertura(['src/juego.ts'], ['tests/juego.test.ts'], ctx, () => false)).toEqual([
            'tests/juego.test.ts cubre src/juego.ts',
        ])
        expect(sinCobertura(['src/juego.ts'], ['tests/juego.test.ts'], ctx, () => true)).toEqual([])
    })
    it('NO marca un test que importa otro fichero', async () => {
        const ctx = {
            leer: () => "import { x } from '../src/otro'",
            existe: (p: string) => p.endsWith('otro.ts') || p.endsWith('juego.test.ts'),
            raiz: ROOT,
        }
        expect(sinCobertura(['src/juego.ts'], ['tests/juego.test.ts'], ctx, () => false)).toEqual([])
    })
    it('resuelve el .js de un import ESM sobre fuente .ts', async () => {
        const raiz = resolve('/raiz')
        const objetivo = resolve(raiz, 'src/uno.ts')
        const ctx = { existe: (p: string) => p === objetivo, raiz }
        expect(resuelveImport('../src/uno.js', resolve(raiz, 'tests/t.test.ts'), ctx)).toBe('src/uno.ts')
    })
    it('lee el gate del mecanismo (dod, guard y lint:guards), no de una constante', async () => {
        expect(enElGate(['npx vitest run tests/a.test.ts'], 'tests/a.test.ts')).toBe(true)
        expect(enElGate(['npx vitest run tests/a.test.ts'], 'tests/b.test.ts')).toBe(false)
        expect(testsDeComando('npx vitest run tests/x/a.test.tsx --reporter=dot')).toEqual(['tests/x/a.test.tsx'])
    })
})
