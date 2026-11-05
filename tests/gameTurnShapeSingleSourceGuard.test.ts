/**
 * P7.89 / P7.90 — un solo dueno del turno de juego.
 *
 * P7.89: el nucleo de "pedir ayuda" ('pista','ayuda','ayudame') estaba copiado
 * literalmente en 18 motores. Ahora vive en `gameUtils.HELP_CORE_FRAMES` y cada
 * motor compone su COLA al lado. El guard impide que vuelva a copiarse a mano.
 *
 * P7.90: el resultado que NO cierra la partida (`gameOver: false`) se escribia
 * a mano en 112 sitios de 22 motores; solo el FINAL tenia dueno
 * (`gameOverResult`). Ahora lo construye `gameUtils.turnResult` y ningun motor
 * vuelve a escribir el objeto.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const GAMES = join(ROOT, 'src/core/games')
/** Dueno unico del nucleo de ayuda y del constructor del turno. */
const DUENO = 'src/core/games/gameUtils.ts'

/** Copia literal del nucleo de ayuda, contigua y entrecomillada. */
const CORE_A_MANO = /'pista'\s*,\s*'ayuda'\s*,\s*'ayudame'/
/** Resultado intermedio escrito a mano. */
const INTERMEDIO_A_MANO = /gameOver:\s*false/

export interface Fuente {
    ruta: string
    texto: string
}

/** Ficheros que vuelven a copiar el nucleo de ayuda a mano. */
export function fuentesConNucleoAMano(fuentes: Fuente[]): string[] {
    return fuentes.filter((f) => f.ruta !== DUENO && CORE_A_MANO.test(f.texto)).map((f) => f.ruta).sort()
}

/** Ficheros que vuelven a escribir el resultado intermedio a mano. */
export function fuentesConIntermedioAMano(fuentes: Fuente[]): string[] {
    return fuentes.filter((f) => f.ruta !== DUENO && INTERMEDIO_A_MANO.test(f.texto)).map((f) => f.ruta).sort()
}

function walk(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e)
        if (statSync(p).isDirectory()) walk(p, acc)
        else if (e.endsWith('.ts')) acc.push(p)
    }
    return acc
}

const reales: Fuente[] = walk(GAMES).map((f) => ({
    ruta: relative(ROOT, f).split(sep).join('/'),
    texto: readFileSync(f, 'utf8'),
}))

describe('P7.89/P7.90 — un solo dueno del turno de juego', () => {
    it('ningun motor re-declara el nucleo de ayuda a mano', () => {
        expect(fuentesConNucleoAMano(reales)).toEqual([])
    })

    it('ningun motor escribe a mano el resultado intermedio', () => {
        expect(fuentesConIntermedioAMano(reales)).toEqual([])
    })

    it('el nucleo y el constructor viven en el dueno declarado', () => {
        const dueno = reales.find((f) => f.ruta === DUENO)
        expect(dueno).toBeDefined()
        expect(dueno?.texto).toContain('HELP_CORE_FRAMES')
        expect(dueno?.texto).toContain('function turnResult')
    })
})

describe('Prueba de detector — el detector no es decorativo', () => {
    it('marca la copia del nucleo y el intermedio escritos a mano', () => {
        const infractores: Fuente[] = [
            { ruta: 'falso/nucleo.ts', texto: "const H = Object.freeze(['pista', 'ayuda', 'ayudame'])" },
            { ruta: 'falso/intermedio.ts', texto: 'return {\n    gameOver: false,\n    score: s,\n}' },
        ]
        expect(fuentesConNucleoAMano(infractores)).toEqual(['falso/nucleo.ts'])
        expect(fuentesConIntermedioAMano(infractores)).toEqual(['falso/intermedio.ts'])
    })

    it('no marca al motor que compone desde la fuente unica', () => {
        const sanos: Fuente[] = [
            { ruta: 'sano.ts', texto: "const H = Object.freeze([...HELP_CORE_FRAMES, 'no se'])\nreturn turnResult(p, s)" },
        ]
        expect(fuentesConNucleoAMano(sanos)).toEqual([])
        expect(fuentesConIntermedioAMano(sanos)).toEqual([])
    })

    it('no marca al dueno por contener su propia definicion', () => {
        const dueno: Fuente[] = [{ ruta: DUENO, texto: "gameOver: false,\n['pista', 'ayuda', 'ayudame']" }]
        expect(fuentesConIntermedioAMano(dueno)).toEqual([])
        expect(fuentesConNucleoAMano(dueno)).toEqual([])
    })
})
