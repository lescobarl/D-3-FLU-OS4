// ============================================================
// speakerDiarizationSeparation - Guard de SEPARACION multihablante
// ------------------------------------------------------------
// Ejercita el DUENO UNICO de la decision de identidad
// (`resolveConversationSpeaker`, speakerDiarization.js) con los VALORES REALES DE
// CONFIG: voces distintas (hombre/mujer, adulto/nino) -> etiquetas distintas; la
// MISMA voz -> la misma etiqueta.
//
// Antes llamaba a `speakerCore.assignSpeaker`, que era la SEGUNDA implementacion de
// la misma decision (ruta doble de RESPONSABILIDAD, P9.57): el worker decidi­a por
// ahi y el hilo principal por el resolver canonico, y podian divergir.
// ============================================================
import { describe, expect, it } from 'vitest'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'

const DIM = 64
const VOICED_SAMPLES = 86400 // 1.8 s @48k (la ventana real del log del dueno)
const TEXTO = 'esto es una prueba de separacion de voces en la sala hablando normal'

function makeVector(pairs: Array<[number, number]>): number[] {
    const v: number[] = new Array(DIM).fill(0)
    for (const [index, value] of pairs) v[index] = value
    return v
}

// e0 = voz A (hombre adulto). e2 = voz B ortogonal (coseno 0 con A).
const E_A = makeVector([[0, 1]])
const E_B = makeVector([[2, 1]])

// query(sim) = sim*e0 + sqrt(1-sim^2)*e1  ->  coseno(query(sim), e0) = sim
function query(sim: number): number[] {
    return makeVector([
        [0, sim],
        [1, Math.sqrt(1 - sim * sim)],
    ])
}

/** Resuelve con el DUENO UNICO (mismo estado de sesion para todos los casos). */
function resolver(vector: number[]): string {
    return resolveConversationSpeaker({
        signatureVector: vector,
        speakerClusters: [{ label: 'Hablante 1', signature: E_A }],
        lastSpeaker: 'Hablante 1',
        lastSignature: E_A,
        voicedSampleCount: VOICED_SAMPLES,
        sampleRate: 48000,
        utteranceText: TEXTO,
        atTurnBoundary: false,
        allowNewCluster: true,
    } as any)
}

describe('diarizacion - separacion multihablante (dueno unico, config real)', () => {
    it('voz distinta (coseno 0.50, p. ej. hombre vs mujer) -> hablante distinto', () => {
        expect(resolver(query(0.5))).toBe('Hablante 2')
    })

    it('voz ortogonal (coseno 0) -> hablante distinto', () => {
        expect(resolver(E_B)).toBe('Hablante 2')
    })

    it('misma voz (coseno 0.90) -> mismo hablante (no se parte)', () => {
        expect(resolver(query(0.9))).toBe('Hablante 1')
    })
})

// ---- Prueba de DETECTOR del propio guard (no es decorativo) ----------------
// Predicado EXPORTADO para poder falsificarlo: reporta como OTRO hablante una voz
// con ese coseno contra la firma de 'Hablante 1'?
export function separatesVoices(sim: number): boolean {
    return resolver(query(sim)) === 'Hablante 2'
}

describe('el detector no es decorativo (prueba de mutacion del propio guard)', () => {
    it('marca la ENTRADA INFRACTORA (voz distinta) y NO la legitima (misma voz)', () => {
        expect(separatesVoices(0.0), 'voz ortogonal debe separarse').toBe(true)
        expect(separatesVoices(0.5), 'voz a coseno 0.5 debe separarse').toBe(true)
        expect(separatesVoices(0.9), 'la misma voz no debe separarse').toBe(false)
        expect(separatesVoices(1.0), 'la misma voz (coseno 1) no debe separarse').toBe(false)
    })
})
