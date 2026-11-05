// ============================================================
// vozIdentidadDecisionUnicaGuard - la DECISION de identidad de voz tiene
// UN SOLO DUENO.
// ------------------------------------------------------------
// DECISION B, POR ESCRITO (corte 2026-10-26): SIN identidad acustica. El dueno
// de la etiqueta `Hablante N` es el que la ASIGNA: `decidirIdentidad`
// (src/voice/conversation/identidad.ts) es el UNICO modulo que la implementa
// (asigna `hablante: entrada.etiquetaNueva` a una voz nueva). La continuidad
// por coseno es una MEDIDA inyectada (`comparar`, llegada por el puerto del
// embebedor), no una decision del modulo: nadie decide hablante comparando
// cosenos por su cuenta.
//
// Las decisoras de la diarizacion retirada (assignSpeaker /
// resolveProductionSpeakerAtBoundary / resolveRoomNearestNeighbor, de la
// tuberia vieja) NO deben existir: si vuelven, este guard se pone ROJO.
//
// QUE MIDE (AGENTS 7.7.d: implementaciones, no literales): modulos que
// IMPLEMENTAN la decision B (definen `decidirIdentidad` Y asignan la etiqueta)
// frente a los que solo la consumen; y que ninguna decisora retirada vuelva
// a medir coseno.
//
// ESTADO PREVIO: el guard exigia 1 decisora por coseno y el corte de la
// diarizacion dejo 0 (la regla habia cambiado, no el dueno): la regla se
// declara POR ESCRITO, no se afloja.
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
/** Funciones que DECIDIAN hablante en la diarizacion retirada (no deben volver). */
const DECISORAS_RETIRADAS = /(export\s+)?function\s+(assignSpeaker|resolveProductionSpeakerAtBoundary|resolveRoomNearestNeighbor)\b/
const COSENO = /compareCosineSignatures\s*\(/
/** La decision B: define la regla de identidad del modulo. */
const DECISORA_B = /\bfunction\s+decidirIdentidad\b/
/** La decision B asigna la etiqueta anonima a una voz nueva (forma real de la regla). */
const ETIQUETA_B = /hablante:\s*entrada\.etiquetaNueva/

/** Modulos que IMPLEMENTAN la decision B (definen la regla Y asignan la etiqueta). */
export function modulosQueDeciden(fuentes: Record<string, string>): string[] {
    const out: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes)) {
        if (DECISORA_B.test(String(texto)) && ETIQUETA_B.test(String(texto))) out.push(ruta)
    }
    return out.sort()
}

/** Modulos con una decisora de la diarizacion RETIRADA que ademas mediria coseno. */
export function modulosConDecisoraRetirada(fuentes: Record<string, string>): string[] {
    const out: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes)) {
        const define = String(texto).split(/\r?\n/).some((l) => {
            const t = String(l || '').trim()
            if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false
            return DECISORAS_RETIRADAS.test(t)
        })
        if (define && COSENO.test(String(texto))) out.push(ruta)
    }
    return out.sort()
}

function ficherosVoz(): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name)
            if (entry.isDirectory()) walk(p)
            else if (/\.(js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(p)
        }
    }
    walk(join(ROOT, 'src', 'voice'))
    return out
}

function fuentesVoz(): Record<string, string> {
    const fuentes: Record<string, string> = {}
    for (const f of ficherosVoz()) {
        fuentes[f.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '')] = readFileSync(f, 'utf8')
    }
    return fuentes
}

describe('vozIdentidadDecisionUnicaGuard - la decision B tiene un solo dueno', () => {
    it('un solo modulo IMPLEMENTA la decision B (decidirIdentidad asigna la etiqueta)', () => {
        const sitios = modulosQueDeciden(fuentesVoz())
        expect(
            sitios,
            'modulos que IMPLEMENTAN la decision B (debe ser 1, identidad.ts): ' + sitios.join(', '),
        ).toEqual(['src/voice/conversation/identidad.ts'])
    })

    it('ninguna decisora de la diarizacion retirada vuelve', () => {
        const sitios = modulosConDecisoraRetirada(fuentesVoz())
        expect(
            sitios,
            'decisoras retiradas que volvieron (deben ser 0): ' + sitios.join(', '),
        ).toEqual([])
    })
})

describe('vozIdentidadDecisionUnicaGuard - el detector no es decorativo', () => {
    it('cuenta solo a quien DEFINE la decision B y asigna la etiqueta; el consumidor no', () => {
        const fuentes = {
            'src/dueno.ts':
                'export function decidirIdentidad(entrada) {\n  return { vozId: entrada.id(), continuidad: false, hablante: entrada.etiquetaNueva }\n}',
            'src/consumidor.ts':
                'import { decidirIdentidad } from "./dueno.js"\nconst d = decidirIdentidad(e)',
        }
        expect(modulosQueDeciden(fuentes)).toEqual(['src/dueno.ts'])
    })

    it('una segunda decision SI se marca (control positivo)', () => {
        const fuentes = {
            'src/dueno.ts': 'function decidirIdentidad(entrada) {\n return { hablante: entrada.etiquetaNueva }\n}',
            'src/clon.ts': 'function decidirIdentidad(entrada) {\n return { hablante: entrada.etiquetaNueva }\n}',
        }
        expect(modulosQueDeciden(fuentes)).toEqual(['src/clon.ts', 'src/dueno.ts'])
    })

    it('no marca a quien define la regla SIN asignar la etiqueta', () => {
        const fuentes = { 'src/incompleto.ts': 'export function decidirIdentidad(e) { return { vozId: e.id() } }' }
        expect(modulosQueDeciden(fuentes)).toEqual([])
    })

    it('marca la decisora retirada si vuelve con coseno, y perdona al medidor puro', () => {
        expect(
            modulosConDecisoraRetirada({
                'src/viejo.js': 'function assignSpeaker(v) {\n  return compareCosineSignatures(a, b)\n}',
            }),
        ).toEqual(['src/viejo.js'])
        expect(
            modulosConDecisoraRetirada({
                'src/medidor.js': 'export function compareCosineSignatures(a, b) { return a }',
            }),
        ).toEqual([])
    })
})
