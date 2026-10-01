/**
 * Anexo B8 — los textos de UI salen de una fuente unica, no de un ternario
 * de idioma repetido por modulo.
 *
 * Medido antes de tocar: el ternario de idioma con DOS literales de texto estaba
 * en 74 sitios de 19 ficheros, y 16 de ellos elegian el CODIGO de idioma con su
 * propio ternario. El texto vivia disperso y la eleccion se re-implementaba en
 * cada modulo.
 *
 * Ahora:
 *  - el texto vive en `src/lib/uiStrings.ts`, resuelto por el resolutor canonico
 *    `pickLabel` (src/lib/textUtils.ts);
 *  - el codigo base de idioma lo decide `normalizeLang`
 *    (src/core/config/localeConfig.ts), dueno unico de esa regla.
 *
 * ALCANCE DEL DETECTOR (por linea, a proposito): mide la forma que se migro.
 * La forma MULTILINEA (ternario partido en varias lineas: 34 sitios en 10
 * ficheros medidos) NO la cubre, porque un detector multilinea cruza lineas y da
 * falsos positivos entre un `=== 'en'` y un `? 'a' : 'b'` sin relacion. Queda
 * declarada como pendiente en el ledger, con el numero.
 *
 * TRINQUETE: el tope solo puede BAJAR.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = 'src'
const UI_STRINGS_OWNER = 'src/lib/uiStrings.ts'
const NORMALIZE_OWNER = 'src/core/config/localeConfig.ts'
/** Ternarios de idioma que quedan (formas no migradas). Solo puede bajar. */
const TOPE_TERNAMIOS_IDIOMA = 14

function walk(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e)
        if (statSync(p).isDirectory()) walk(p, acc)
        else if (/\.(ts|tsx|js)$/.test(e)) acc.push(p)
    }
    return acc
}

function rel(p: string): string {
    return relative(process.cwd(), p).replace(/\\/g, '/')
}

/** Linea sin comentario: una mencion en un comentario no es codigo. */
function sinComentario(linea: string): string {
    const t = linea.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return ''
    return linea.replace(/(^|[^:])\/\/.*$/, '$1')
}

/** El ternario `idioma === 'en' ? 'A' : 'B'` con DOS literales de texto. */
export function ternariosDeTextoLiteral(src: string): string[] {
    return src
        .split(/\r?\n/)
        .flatMap(
            (l) =>
                sinComentario(l).match(
                    /[\w.]+\s*===\s*'en'\s*\?\s*'(?:[^'\\]|\\.)*'\s*:\s*'(?:[^'\\]|\\.)*'/g,
                ) ?? [],
        )
}

/** Todo ternario de una linea que decide por el idioma literal 'en'. */
export function ternariosIdioma(src: string): string[] {
    return src
        .split(/\r?\n/)
        .flatMap((l) => sinComentario(l).match(/[\w.()]+\s*===\s*'en'\s*\?/g) ?? [])
}

describe('B8 textos de UI - una sola fuente', () => {
    it('no queda ningun ternario de idioma con dos literales de texto', () => {
        const offenders = walk(SRC).flatMap((f) =>
            ternariosDeTextoLiteral(readFileSync(f, 'utf8')).map((m) => rel(f) + ': ' + m),
        )
        expect(
            offenders,
            'Texto de UI elegido con ternario inline. Usa uiStrings + pickText:\n  ' + offenders.join('\n  '),
        ).toEqual([])
    })

    it('el codigo base de idioma lo decide normalizeLang, y solo su dueno lo implementa', () => {
        const definen = walk(SRC).filter((f) =>
            /function normalizeLang|normalizeLang\s*=/.test(readFileSync(f, 'utf8')),
        )
        expect(definen.map(rel)).toEqual([NORMALIZE_OWNER])
    })

    it('los ternarios de idioma restantes no crecen (trinquete)', () => {
        const total = walk(SRC).reduce((n, f) => n + ternariosIdioma(readFileSync(f, 'utf8')).length, 0)
        expect(
            total,
            'Aumentaron los ternarios de idioma. Migra a pickLabel (texto) o normalizeLang (codigo); ' +
                'si bajas el numero, baja tambien TOPE_TERNAMIOS_IDIOMA.',
        ).toBeLessThanOrEqual(TOPE_TERNAMIOS_IDIOMA)
    })

    it('el catalogo de UI delega la eleccion de idioma en el resolutor canonico', () => {
        const owner = readFileSync(UI_STRINGS_OWNER, 'utf8')
        expect(owner).toContain("import { pickLabel } from './textUtils'")
        expect(ternariosIdioma(owner)).toEqual([])
    })
})

describe('B8 - el detector no es decorativo', () => {
    it('marca el ternario de texto y no marca al dueño ni un comentario', () => {
        expect(ternariosDeTextoLiteral(`const x = lang === 'en' ? 'Done' : 'Listo'`)).toHaveLength(1)
        expect(
            ternariosDeTextoLiteral(`const x = this.language === 'en' ? 'Done' : 'Listo'`),
        ).toHaveLength(1)
        expect(ternariosDeTextoLiteral(`// antes: lang === 'en' ? 'Done' : 'Listo'`)).toEqual([])
        expect(ternariosDeTextoLiteral(`/* lang === 'en' ? 'A' : 'B' */`)).toEqual([])
        expect(ternariosDeTextoLiteral(`pickText(lang, 'recordatorio')`)).toEqual([])
    })

    it('cuenta tambien los ternarios que eligen codigo de idioma', () => {
        expect(ternariosIdioma(`const l = language === 'en' ? 'en' : 'es'`)).toHaveLength(1)
        expect(ternariosIdioma('normalizeLang(language)')).toEqual([])
    })
})
