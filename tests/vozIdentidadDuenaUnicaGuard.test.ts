// ============================================================
// vozIdentidadDuenaUnicaGuard - la responsabilidad "acuñar etiqueta de hablante"
// tiene UN SOLO DUENO.
// ------------------------------------------------------------
// RUTA DOBLE MEDIDA (2026-10-09): la decision "abrir etiqueta NUEVA (Hablante N)"
// estaba implementada DOS veces, con algoritmos distintos:
//   - `speakerCore.nextAutoSpeakerLabel`     (lo usa el WORKER, voiceId.worker.js:104)
//   - `speakerLabels.nextAvailableSpeakerLabel` (lo usan activeListen, el hook y
//     speakerDiarization en el HILO PRINCIPAL)
// ademas de los sitios que la INVOCAN (activeListen.js:291, useFluVoiceAssistant.js:312,
// speakerDiarization.js:34). El log del dueno (sesion 17:18-17:21) muestra las dos rutas
// vivas decidiendo y la MISMA voz abriendo Hablante 2/3/4
// (Match: new-voice-below-threshold=3, forced-new-voice-below-threshold=1).
//
// QUE MIDE ESTE GUARD (AGENTS 7.7.d: implementaciones, no literales): cuantos modulos
// IMPLEMENTAN el "siguiente indice libre" (una funcion que recorre indices y acuña con
// `autoSpeakerLabel`). NO cuenta a los que solo la INVOCAN: un dueno, muchos consumidores.
//
// NACE ROJO: hoy 2 modulos la implementan (speakerCore + speakerLabels).
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
/** Nombre del responsable que acuña la etiqueta. */
const NOMBRE = /(nextAutoSpeakerLabel|nextAvailableSpeakerLabel|nextFreeSpeakerLabel)\s*\(/
/** Definicion de una funcion con ese nombre. */
const DEFINICION = new RegExp(
    `(export\\s+)?function\\s+(nextAutoSpeakerLabel|nextAvailableSpeakerLabel|nextFreeSpeakerLabel)\\b`,
)
/** Acuñador de la plantilla: si el cuerpo la usa, ese modulo IMPLEMENTA el indice libre. */
const PLANTILLA = /autoSpeakerLabel\s*\(/

/** Predicado puro: la linea define la funcion acuñadora. */
export function defineAcunadora(linea: string): boolean {
    const t = String(linea || '').trim()
    if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false
    return DEFINICION.test(t)
}

/** Tambien reconoce el posible USO en el mismo modulo (para el control negativo). */
export function invocaAcunadora(linea: string): boolean {
    const t = String(linea || '').trim()
    if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false
    if (defineAcunadora(t)) return false
    return NOMBRE.test(t) && !/autoSpeakerLabel/.test(t)
}

/** Modulos que IMPLEMENTAN el "siguiente indice libre" (no los que solo la invocan). */
export function modulosQueImplementan(fuentes: Record<string, string>): string[] {
    const out: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes)) {
        const lineas = String(texto).split(/\r?\n/)
        const define = lineas.some((l) => defineAcunadora(l))
        if (define && PLANTILLA.test(String(texto))) out.push(ruta)
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

describe('vozIdentidadDuenaUnicaGuard - acuñar etiqueta tiene un solo dueno', () => {
    it('un solo modulo IMPLEMENTA el siguiente indice libre (no dos)', () => {
        const fuentes: Record<string, string> = {}
        for (const f of ficherosJsVoz()) {
            fuentes[f.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '')] = readFileSync(f, 'utf8')
        }
        const sitios = modulosQueImplementan(fuentes)
        expect(
            sitios,
            'modulos que IMPLEMENTAN acuñar etiqueta (deben ser 1): ' + sitios.join(', '),
        ).toHaveLength(1)
    })
})

describe('vozIdentidadDuenaUnicaGuard - el detector no es decorativo', () => {
    it('cuenta IMPLEMENTACIONES y NO a los consumidores', () => {
        const fuentes = {
            'src/dueno.js':
                'export function nextAutoSpeakerLabel(clusters, reserved) {\n  return autoSpeakerLabel(1)\n}',
            'src/consumidor.js': 'import { nextAutoSpeakerLabel } from "./dueno.js"\nconst x = nextAutoSpeakerLabel(a, b)',
        }
        expect(modulosQueImplementan(fuentes)).toEqual(['src/dueno.js'])
    })

    it('una segunda implementacion SI se marca (control positivo)', () => {
        const fuentes = {
            'src/dueno.js': 'function nextAutoSpeakerLabel() {\n return autoSpeakerLabel(1)\n}',
            'src/clon.js': 'function nextAvailableSpeakerLabel(a) {\n return autoSpeakerLabel(2)\n}',
        }
        expect(modulosQueImplementan(fuentes)).toEqual(['src/clon.js', 'src/dueno.js'])
    })

    it('reconoce la definicion y descarta comentarios', () => {
        expect(defineAcunadora('export function nextAvailableSpeakerLabel(')).toBe(true)
        expect(defineAcunadora('function nextAutoSpeakerLabel(a) {')).toBe(true)
        expect(defineAcunadora('// nextAutoSpeakerLabel(a) en prosa')).toBe(false)
        expect(invocaAcunadora('  return nextAvailableSpeakerLabel(clusters)')).toBe(true)
    })
})
