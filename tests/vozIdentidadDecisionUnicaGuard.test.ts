// ============================================================
// vozIdentidadDecisionUnicaGuard - la DECISION "voz conocida vs voz nueva"
// (quien habla) tiene UN SOLO DUENO.
// ------------------------------------------------------------
// RUTA DOBLE DE RESPONSABILIDAD MEDIDA (2026-10-09). El encabezado de
// speakerDiarization.js:6 AFIRMA "El Worker y el hilo principal consumen el mismo
// nucleo (speakerCore.js)"... y es verdad solo a medias: comparten las PRIMITIVAS
// (coseno, normalizacion) pero CADA UNO implementa su DECISION:
//   - WORKER:            speakerCore.assignSpeaker   (voiceId.worker.js:104)
//   - HILO PRINCIPAL:    speakerDiarization.resolveProductionSpeakerAtBoundary /
//                        resolveRoomNearestNeighbor (dentro de resolveConversationSpeaker)
// El log del dueno (17:18-17:21) muestra LAS DOS decidiendo en la misma sesion
// (`Match reason=...` del worker + `identity {resolved-idle}` del principal) y la
// MISMA voz en Hablante 2/3/4 (new-voice-below-threshold=3, forced-...=1).
//
// QUE MIDE (AGENTS 7.7.d: implementaciones, no literales): modulos que IMPLEMENTAN
// la decision (una funcion que decide hablante comparando cosenos) frente a los que
// solo COMPARAN cosenos o consumen el resultado.
//
// NACE ROJO: hoy 2 modulos la implementan (speakerCore + speakerDiarization).
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
/** Funciones que DECIDEN hablante (no las que solo miden similitud). */
const DECISORAS = /(export\s+)?function\s+(assignSpeaker|resolveProductionSpeakerAtBoundary|resolveRoomNearestNeighbor)\b/
const COSENO = /compareCosineSignatures\s*\(/

/** Predicado puro: la linea define una funcion decisora. */
export function defineDecisora(linea: string): boolean {
    const t = String(linea || '').trim()
    if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false
    return DECISORAS.test(t)
}

/** Modulos que IMPLEMENTAN la decision (definen una decisora y miden coseno). */
export function modulosQueDeciden(fuentes: Record<string, string>): string[] {
    const out: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes)) {
        const define = String(texto).split(/\r?\n/).some((l) => defineDecisora(l))
        if (define && COSENO.test(String(texto))) out.push(ruta)
    }
    return out.sort()
}

function ficherosJsVoz(): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name)
            if (entry.isDirectory()) walk(p)
            else if (entry.name.endsWith('.js')) out.push(p)
        }
    }
    walk(join(ROOT, 'src', 'voice'))
    return out
}

describe('vozIdentidadDecisionUnicaGuard - decidir quien habla tiene un solo dueno', () => {
    it('un solo modulo IMPLEMENTA la decision por coseno (no dos)', () => {
        const fuentes: Record<string, string> = {}
        for (const f of ficherosJsVoz()) {
            fuentes[f.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '')] = readFileSync(f, 'utf8')
        }
        const sitios = modulosQueDeciden(fuentes)
        expect(
            sitios,
            'modulos que IMPLEMENTAN la decision de identidad (debe ser 1): ' + sitios.join(', '),
        ).toHaveLength(1)
    })
})

describe('vozIdentidadDecisionUnicaGuard - el detector no es decorativo', () => {
    it('cuenta solo a quien DEFINE la decisora y mide coseno', () => {
        const fuentes = {
            'src/dueno.js':
                'function assignSpeaker(v) {\n  return compareCosineSignatures(a, b)\n}',
            'src/consumidor.js':
                'import { assignSpeaker } from "./dueno.js"\nconst x = compareCosineSignatures(a, b)\nconst y = assignSpeaker(v)',
        }
        expect(modulosQueDeciden(fuentes)).toEqual(['src/dueno.js'])
    })

    it('una segunda decision SI se marca (control positivo)', () => {
        const fuentes = {
            'src/dueno.js': 'function assignSpeaker(v) {\n return compareCosineSignatures(a, b)\n}',
            'src/clon.js': 'function resolveRoomNearestNeighbor(v) {\n return compareCosineSignatures(a, b)\n}',
        }
        expect(modulosQueDeciden(fuentes)).toEqual(['src/clon.js', 'src/dueno.js'])
    })

    it('no marca a quien solo mide coseno sin decidir', () => {
        const fuentes = { 'src/medidor.js': 'export function compareCosineSignatures(a, b) { return a }' }
        expect(modulosQueDeciden(fuentes)).toEqual([])
    })
})
