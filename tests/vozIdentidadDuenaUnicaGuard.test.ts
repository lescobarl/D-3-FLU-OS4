// ============================================================
// vozIdentidadDuenaUnicaGuard - la decision "abrir etiqueta NUEVA (Hablante N)"
// tiene UN SOLO DUENO.
// ------------------------------------------------------------
// RUTA DOBLE MEDIDA (2026-10-09): la implementan
//   - `speakerCore.assignSpeaker`  (WORKER: src/voice/workers/voiceId.worker.js:104)
//   - `speakerDiarization.resolveConversationSpeaker` (HILO PRINCIPAL: preflight)
// con algoritmos distintos para la MISMA decision. El log del dueno muestra LAS DOS
// (las lineas `Match reason=...` del worker y los eventos `identity` del hilo
// principal) y la MISMA voz abrio Hablante 2/3/4
// (Match: new-voice-below-threshold=3, forced-new-voice-below-threshold=1).
//
// Mientras haya DOS sitios que acunan etiqueta nueva, pueden DIVERGIR (misma voz ->
// etiqueta distinta segun quien resuelva). Regla: un dueno, varios consumidores.
//
// NACE ROJO: hoy 3 modulos acunan etiquetas nuevas.
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const ACUNADOR = /(nextAutoSpeakerLabel|nextAvailableSpeakerLabel)\s*\(/

/** Predicado puro: una linea que LLAMA al acunador (no su definicion ni un comentario). */
export function abreEtiquetaNueva(linea: string): boolean {
    const t = String(linea || '').trim()
    if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false
    if (/(export\s+)?function\s+(nextAutoSpeakerLabel|nextAvailableSpeakerLabel)\b/.test(t)) return false
    return ACUNADOR.test(t)
}

/** Modulos (rutas relativas) con al menos un sitio que abre etiqueta nueva. */
export function modulosQueAcunan(fuentes: Record<string, string>): string[] {
    const out: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes)) {
        if (String(texto).split(/\r?\n/).some((l) => abreEtiquetaNueva(l))) out.push(ruta)
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

describe('vozIdentidadDuenaUnicaGuard - abrir etiqueta nueva tiene un solo dueno', () => {
    it('un solo modulo acuna etiquetas nuevas (no dos resolvedores)', () => {
        const fuentes: Record<string, string> = {}
        for (const f of ficherosJsVoz()) {
            fuentes[f.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '')] = readFileSync(f, 'utf8')
        }
        const sitios = modulosQueAcunan(fuentes)
        expect(
            sitios,
            'modulos que acunan etiqueta nueva (deben ser 1): ' + sitios.join(', '),
        ).toHaveLength(1)
    })
})

describe('vozIdentidadDuenaUnicaGuard - el detector no es decorativo', () => {
    it('marca la llamada y perdona la definicion y el comentario', () => {
        expect(abreEtiquetaNueva('const newLabel = nextAutoSpeakerLabel(clusters, reserved, config)')).toBe(true)
        expect(abreEtiquetaNueva('return nextAvailableSpeakerLabel(speakerClusters, extra, { maxSpeakers })')).toBe(true)
        expect(abreEtiquetaNueva('export function nextAutoSpeakerLabel(clusters = [], reserved = [], config = FLU_CONFIG) {')).toBe(false)
        expect(abreEtiquetaNueva('// nextAutoSpeakerLabel(clusters) explicado en prosa')).toBe(false)
    })

    it('cuenta MODULOS, no lineas', () => {
        const fuentes = {
            'src/a.js': 'const x = nextAutoSpeakerLabel(a)\nconst y = nextAutoSpeakerLabel(b)',
            'src/b.js': 'function nextAvailableSpeakerLabel() {}',
        }
        expect(modulosQueAcunan(fuentes)).toEqual(['src/a.js'])
    })
})
