/**
 * 0.22 + 0.24 - Integridad del INSTRUMENTO de medida.
 *
 * 0.22 (por COMMIT): un commit que toca `src/**` no puede tocar a la vez un guard
 * que lea ese mismo `src` COMO TEXTO. Si el guard cae por el cambio, el arreglo
 * va en commit aparte: asi no queda indistinguible "guard mal escrito" de "codigo
 * mal escrito". Se evalua el rango `base..HEAD` (lo ya commiteado) MAS lo que esta
 * en el indice, que es el commit EN CURSO: justo cuando el pre-commit puede pararlo.
 *
 * 0.24 (por FICHERO): si el cambio toca un fichero, todo guard que lo lea debe
 * estar en `lint:guards`, o el cambio declara por que no. `lint:guards` es
 * HIGIENE, no comportamiento: el agujero medido fue que dos guards del flujo
 * quedaron FUERA del gate y el pre-commit paso en verde igual.
 *
 * Un solo dueno del escaneo: `readersOf` (que guards leen que fichero). Los guards
 * arman rutas con `join(DIR, f)`, asi que "leer" = contener `readFileSync` Y
 * mencionar el fichero o su carpeta. Es una sobre-aproximacion a proposito: antes
 * de mas, nunca de menos.
 */
import { runAsync } from './_asyncExec'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUARD_FILES } from '../scripts/guard-files.mjs'

const ROOT = process.cwd()
const base: string = JSON.parse(readFileSync(join(ROOT, '.task/contract.json'), 'utf8')).base

/**
 * Guards que NO pueden entrar en `lint:guards` todavia, con el motivo MEDIDO.
 * No es una lista de perdon: cada entrada tiene que seguir fuera del gate y sin
 * prueba de detector (lo comprueba el ultimo caso), asi que se vacia sola cuando
 * el motivo desaparece. El motivo es del dueno de P2.4, no de este guard.
 */
const EXEMPT: Record<string, string> = {}

/** Entradas de EXEMPT que ya NO valen por estar en el gate (la lista se vacia sola). */
export function exemptInvalidos(exempt: Record<string, string>, gate: Set<string>): string[] {
    return Object.keys(exempt).filter((f) => gate.has(f))
}

/** Un guard de TEXTO mide leyendo fuente como texto. */
export function isTextGuard(src: string): boolean {
    return src.includes('readFileSync')
}

/** Guards que LEEN `target`: contienen readFileSync y lo mencionan a el o a su carpeta. */
export function readersOf(target: string, sources: Map<string, string>): string[] {
    const dir = target.split('/').slice(0, -1).join('/')
    const out: string[] = []
    for (const [file, src] of sources) {
        if (!isTextGuard(src)) continue
        if (src.includes(target) || (dir !== '' && src.includes(dir))) out.push(file)
    }
    return out.sort()
}

/** 0.22: en un mismo conjunto de cambios, src y los guards que lo miden no se mezclan. */
export function separationViolations(changed: string[], sources: Map<string, string>): string[] {
    const src = changed.filter((f) => f.startsWith('src/'))
    if (src.length === 0) return []
    const guards = changed.filter((f) => sources.has(f) && isTextGuard(sources.get(f) ?? ''))
    const bad: string[] = []
    for (const g of guards) {
        for (const a of src) {
            if (readersOf(a, new Map([[g, sources.get(g) ?? '']])).length > 0) bad.push(`${g} mide ${a}`)
        }
    }
    return bad.sort()
}

/** 0.24: guards que leen `tocados` y no estan ni en el gate ni declarados. */
export function uncoveredReaders(tocados: string[], inGate: Set<string>, sources: Map<string, string>): string[] {
    const out = new Set<string>()
    for (const t of tocados.filter((f) => f.startsWith('src/'))) {
        for (const g of readersOf(t, sources)) {
            if (!inGate.has(g) && !(g in EXEMPT)) out.add(`${g} lee ${t}`)
        }
    }
    return [...out].sort()
}

const GATE = new Set<string>(GUARD_FILES)

function testSources(): Map<string, string> {
    const m = new Map<string, string>()
    for (const f of readdirSync(join(ROOT, 'tests'))) {
        if (/\.test\.tsx?$/.test(f)) m.set(`tests/${f}`, readFileSync(join(ROOT, 'tests', f), 'utf8'))
    }
    return m
}

async function git(args: string[]): Promise<string> {
    return (await runAsync('git', args)).stdout
}

/** El commit EN CURSO (lo que el pre-commit va a crear), si lo hay. */
async function staged(): Promise<string[]> {
    return (await git(['diff', '--cached', '--name-only'])).trim().split('\n').map((s) => s.trim()).filter(Boolean)
}

/** Commits del rango + su lista de ficheros. */
async function commits(): Promise<Array<{ sha: string; files: string[] }>> {
    const shas = (await git(['rev-list', `${base}..HEAD`])).trim().split('\n').filter(Boolean)
    return Promise.all(
        shas.map(async (sha) => ({
            sha,
            files: (await git(['show', '--name-only', '--format=', sha])).trim().split('\n').filter(Boolean),
        })),
    )
}

/** Lo tocado por el cambio en curso, con el mismo criterio que la puerta. */
async function touched(): Promise<string[]> {
    const tracked = (await git(['diff', '--name-only', base])).trim().split('\n')
    const untracked = (await git(['ls-files', '--others', '--exclude-standard'])).trim().split('\n')
    return [...new Set([...tracked, ...untracked, ...(await staged())].map((s) => s.trim()).filter(Boolean))]
}

describe('0.22 instrumento - src y los guards que lo miden no viajan en el mismo commit', () => {
    it('ningun commit del rango mezcla src con sus guards de texto', async () => {
        const sources = testSources()
        const bad = (await commits()).flatMap((c) => separationViolations(c.files, sources).map((v) => `${c.sha.slice(0, 7)}: ${v}`))
        expect(bad, 'El arreglo del guard va en commit APARTE del src que mide (0.22)').toEqual([])
    })
    it('el commit en curso (indice) tampoco los mezcla', async () => {
        expect(
            separationViolations(await staged(), testSources()),
            'Estas dejando en el indice src y el guard que lo mide juntos: separalos (0.22)',
        ).toEqual([])
    })
})

describe('0.24 instrumento - todo guard que lee un fichero tocado corre en el gate', () => {
    it('no hay lectores fuera de lint:guards sin declarar', async () => {
        const bad = uncoveredReaders(await touched(), GATE, testSources())
        expect(
            bad,
            'Estos guards leen ficheros tocados y NO estan en lint:guards ni declarados en EXEMPT (0.24)',
        ).toEqual([])
    })
    it('lo declarado en EXEMPT sigue fuera del gate (la lista se vacia sola)', async () => {
        expect(exemptInvalidos(EXEMPT, GATE), 'Ya estan en lint:guards: sacalos de EXEMPT').toEqual([])
    })
})

describe('el detector no es decorativo', () => {
    it('0.22 marca el commit que mezcla, y no marca el separado', async () => {
        const sources = new Map([['tests/g.test.ts', "const s = readFileSync('src/core/games/x.ts', 'utf8')"]])
        expect(separationViolations(['src/core/games/x.ts', 'tests/g.test.ts'], sources)).toEqual([
            'tests/g.test.ts mide src/core/games/x.ts',
        ])
        expect(separationViolations(['src/core/games/x.ts'], sources)).toEqual([])
        expect(separationViolations(['tests/g.test.ts'], sources)).toEqual([])
    })
    it('0.22 no marca un guard que no mide ese src', async () => {
        const sources = new Map([['tests/g.test.ts', "const s = readFileSync('src/otro/y.ts', 'utf8')"]])
        expect(separationViolations(['src/core/games/x.ts', 'tests/g.test.ts'], sources)).toEqual([])
    })
    it('0.24 marca al lector que no esta en el gate ni declarado', async () => {
        const sources = new Map([['tests/g.test.ts', "const s = readFileSync('src/core/games/x.ts', 'utf8')"]])
        expect(uncoveredReaders(['src/core/games/x.ts'], new Set<string>(), sources)).toEqual([
            'tests/g.test.ts lee src/core/games/x.ts',
        ])
        expect(uncoveredReaders(['src/core/games/x.ts'], new Set(['tests/g.test.ts']), sources)).toEqual([])
    })
    it('el escaneo encuentra al guard por la CARPETA (arma rutas con join(DIR, f))', async () => {
        const sources = new Map([['tests/g.test.ts', "const DIR = 'src/core/games'\nconst s = readFileSync(join(DIR, f), 'utf8')"]])
        expect(readersOf('src/core/games/quienSoy.ts', sources)).toEqual(['tests/g.test.ts'])
    })
    it('el detector de EXEMPT marca al guard que ya entro en el gate', async () => {
        const gate = new Set(['tests/g.test.ts'])
        expect(exemptInvalidos({ 'tests/g.test.ts': 'x' }, gate)).toEqual(['tests/g.test.ts'])
        expect(exemptInvalidos({ 'tests/otro.test.ts': 'x' }, gate)).toEqual([])
    })
})
