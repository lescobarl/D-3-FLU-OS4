// ============================================================
// turnCommitGarbageGate - el defecto MEDIDO en el log del dueño:
//
//   intento 1 de "Okay Flow Platícame de los aviones" (20:57:21):
//     ENTER -> THINKING -> "latencia IA: 1102ms" -> LISTENING
//     y NUNCA hubo `onContractResolved` ni `SPEAKING`.
//
// Causa: `commitTurnPhrase` devolvía '' en SILENCIO cuando el guard
// anti-alucinación marcaba la captura cruda del ASR como basura, y
// `commitAndResolveTurn` salía con `return ''` sin llamar al callback: el turno
// moría mudo, con la respuesta de Gemini ya pagada y descartada.
//
// Arreglo de raíz: el criterio vive en UNA función (`resolveCommittablePhrase`)
// que, ante una captura cruda corrupta, commitea el texto VALIDADO del turno
// (el `question` derivado por el motor) y SIEMPRE informa el motivo. Se prueba
// la ruta REAL (la función que usa el hook), sin mocks.
// ============================================================
import { describe, expect, it } from 'vitest';

import {
    classifyGarbageTranscript,
    looksLikeGarbageTranscript,
    resolveCommittablePhrase,
} from '../src/voice/lib/garbageTranscript.js';

// Texto validado del turno tal como lo deriva el motor de voz (con wake word).
const AVIONES = 'Okay Flow platícame de los aviones';
// Captura cruda del ASR que el guard marca como basura (tartamudeo adyacente).
const CAPTURA_CORRUPTA = 'Okay Flow platícame de los aviones los los aviones';

describe('el criterio de basura sigue siendo el mismo (comportamiento validado)', () => {
    it('descarta tartamudeo y ruido sin vocales', () => {
        expect(looksLikeGarbageTranscript('¿Y se se? ¿Bon la ofes ahí?')).toBe(true);
        expect(looksLikeGarbageTranscript('hmm mmm nnn')).toBe(true);
        expect(looksLikeGarbageTranscript('')).toBe(true);
        expect(looksLikeGarbageTranscript('   ')).toBe(true);
    });

    it('conserva habla real (no baja la sensibilidad)', () => {
        expect(looksLikeGarbageTranscript(AVIONES)).toBe(false);
        expect(looksLikeGarbageTranscript('hola hola soy luis')).toBe(false);
        expect(looksLikeGarbageTranscript('okay flu borra todas las notas')).toBe(false);
    });

    it('el motivo queda clasificado, no en un booleano opaco', () => {
        expect(classifyGarbageTranscript('')).toMatchObject({ garbage: true, reason: 'empty' });
        expect(classifyGarbageTranscript('¿Y se se? ¿Bon la ofes ahí?')).toMatchObject({
            garbage: true,
            reason: 'stutter',
        });
        expect(classifyGarbageTranscript('hmm mmm nnn')).toMatchObject({
            garbage: true,
            reason: 'nonword',
        });
        expect(classifyGarbageTranscript(AVIONES)).toMatchObject({ garbage: false, reason: null });
    });
});

describe('el escenario del log: la captura cruda corrupta NO mata el turno', () => {
    it('usa el texto validado en vez de descartar (antes: turno mudo)', () => {
        const resolved = resolveCommittablePhrase(CAPTURA_CORRUPTA, AVIONES);

        expect(resolved).toEqual({
            phrase: AVIONES,
            usedFallback: true,
            reason: 'stutter',
        });
        expect(resolved.phrase).not.toBe('');
    });

    it('la captura buena pasa intacta (sin fallback, sin motivo)', () => {
        expect(resolveCommittablePhrase(AVIONES, AVIONES)).toEqual({
            phrase: AVIONES,
            usedFallback: false,
            reason: null,
        });
    });

    it('sin texto validado NO hay frase, pero SIEMPRE hay motivo (nunca silencio)', () => {
        const resolved = resolveCommittablePhrase('', '');

        expect(resolved.phrase).toBe('');
        expect(resolved.reason).toBe('empty');
    });

    it('si la captura cruda es buena, el fallback no la sustituye', () => {
        const resolved = resolveCommittablePhrase('borra de la nota del súper el cloro', '');

        expect(resolved.usedFallback).toBe(false);
        expect(resolved.phrase).toBe('borra de la nota del súper el cloro');
    });
});
