/**
 * P7.92 - Los lectores de configuracion de identidad de voz tienen UN dueno.
 *
 * DEFECTO MEDIDO (auditoria de rutas dobles / hard code): el core (Node) y el
 * Web Worker definian cada uno su copia de getEmbeddingConfig, getModelId,
 * getTargetSampleRate y getMinSamples, con los MISMOS fallbacks escritos dos
 * veces (`16000` y `0.35`); el cliente del worker tenia una TERCERA copia del
 * lector de configuracion. Corregir un fallback no corregia los otros dos.
 *
 * REGLA: el valor y los fallbacks viven SOLO en
 * src/voice/lib/embeddingConfig.js; los consumidores los IMPORTAN de ahi.
 * No sustituye a duplicationGuard, que cubre otros cinco algoritmos.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const VOICE = join(ROOT, 'src/voice')

/** Dueno unico de la configuracion de captura para identidad de voz. */
export const DUENO = 'src/voice/lib/embeddingConfig.js'

/** Lectores que solo pueden declararse en el dueno. */
export const LECTORES = [
    'getEmbeddingConfig',
    'getModelId',
    'getTargetSampleRate',
    'getMinSamples',
]

/** Fallbacks del pipeline de embeddings que declara el dueno. */
export const FALLBACKS = ['DEFAULT_MIN_SAMPLE_RATIO']

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) walk(p, acc)
        else if (/\.(ts|tsx|js|jsx)$/.test(entry)) acc.push(p)
    }
    return acc
}

export const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/')

/** true si el fuente USA alguno de los lectores (es consumidor). */
export function usaLectores(src: string): boolean {
    return LECTORES.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(src))
}

/** true si el fuente importa del dueno (ruta relativa desde lib/ o workers/). */
export function importaDelDueno(src: string): boolean {
    return (
        src.includes("from './embeddingConfig.js'") ||
        src.includes("from '../lib/embeddingConfig.js'")
    )
}

/** Definiciones locales de los lectores fuera del dueno. */
export function lectoresFueraDelDueno(src: string, fileName: string): string[] {
    if (fileName === DUENO) return []
    return LECTORES.filter((n) => new RegExp(`function\\s+${n}\\s*\\(`).test(src)).map(
        (n) => `${fileName}: function ${n}`,
    )
}

/** Fallbacks del pipeline reescritos en un consumidor (fuera del dueno). */
export function fallbacksFueraDelDueno(src: string, fileName: string): string[] {
    if (fileName === DUENO || !usaLectores(src)) return []
    const out: string[] = []
    if (/\?\s*[\w.]+\s*:\s*16000\b/.test(src)) out.push(`${fileName}: fallback 16000`)
    if (/:\s*0\.35\b/.test(src)) out.push(`${fileName}: fallback 0.35`)
    return out
}

/** Consumidor que usa los lectores sin importarlos del dueno. */
export function consumidoresSinImport(src: string, fileName: string): string[] {
    if (fileName === DUENO || !usaLectores(src)) return []
    return importaDelDueno(src) ? [] : [`${fileName}: usa los lectores sin importarlos del dueno`]
}

/** Todos los hallazgos en el arbol de voz. */
export function hallazgos(
    files: Array<{ name: string; src: string }>,
): string[] {
    return files.flatMap(({ name, src }) => [
        ...lectoresFueraDelDueno(src, name),
        ...fallbacksFueraDelDueno(src, name),
        ...consumidoresSinImport(src, name),
    ])
}

const VOZ = walk(VOICE).map((f) => ({ name: rel(f), src: readFileSync(f, 'utf8') }))

describe('P7.92 - un solo dueno de la configuracion de identidad de voz', () => {
    it('no hay lectores, fallbacks ni consumidores sin importar fuera del dueno', () => {
        expect(
            hallazgos(VOZ),
            'Estos sitios vuelven a declarar los lectores/fallbacks de embedding o los usan sin importarlos del dueno (P7.92)',
        ).toEqual([])
    })

    it('el dueno declara los lectores y sus fallbacks una sola vez', () => {
        const src = readFileSync(join(ROOT, DUENO), 'utf8')
        for (const n of LECTORES) {
            expect(src, `${DUENO} debe declarar ${n}`).toMatch(new RegExp(`function\\s+${n}\\s*\\(`))
        }
        for (const c of FALLBACKS) {
            expect(src, `${DUENO} debe declarar ${c}`).toMatch(new RegExp(`export const ${c}\\b`))
        }
    })
})

describe('el detector no es decorativo', () => {
    it('marca al fichero que re-declara un lector y no al dueno', () => {
        const infractor = 'function getTargetSampleRate(cfg) { return cfg.rate || 16000 }'
        expect(lectoresFueraDelDueno(infractor, 'src/voice/lib/otro.js')).toEqual([
            'src/voice/lib/otro.js: function getTargetSampleRate',
        ])
        expect(lectoresFueraDelDueno(infractor, DUENO)).toEqual([])
    })

    it('marca el fallback reescrito en un consumidor y no en quien no usa los lectores', () => {
        const consumidor = 'const r = getTargetSampleRate(cfg); return r ? r : 16000'
        expect(fallbacksFueraDelDueno(consumidor, 'src/voice/lib/otro.js')).toEqual([
            'src/voice/lib/otro.js: fallback 16000',
        ])
        // quien no usa los lectores no entra en la regla (p. ej. el VAD de STT)
        const ajeno = 'export function rate(x = 0) { return x > 0 ? x : 16000 }'
        expect(fallbacksFueraDelDueno(ajeno, 'src/voice/lib/asr/otro.js')).toEqual([])
    })

    it('marca al consumidor que no importa del dueno', () => {
        const sinImport = 'const cfg = getEmbeddingConfig()'
        expect(consumidoresSinImport(sinImport, 'src/voice/lib/otro.js')).toEqual([
            'src/voice/lib/otro.js: usa los lectores sin importarlos del dueno',
        ])
        const conImport = "import { getEmbeddingConfig } from './embeddingConfig.js'\nconst c = getEmbeddingConfig()"
        expect(consumidoresSinImport(conImport, 'src/voice/lib/otro.js')).toEqual([])
    })
})
