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

    // El dictado de CIFRAS es contenido legitimo (prueba de que transcribe).
    // Medido: el filtro `nonword` (sin vocales) descartaba "25 58" y el turno se
    // cerraba mudo. Un token con digitos NO es jerga del ASR.
    it('el dictado de SOLO numeros NO es basura', () => {
        expect(looksLikeGarbageTranscript('25 58')).toBe(false);
        expect(looksLikeGarbageTranscript('36 93')).toBe(false);
        expect(looksLikeGarbageTranscript('1 2690')).toBe(false);
        expect(classifyGarbageTranscript('25 58')).toMatchObject({ garbage: false, reason: null });
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

// ============================================================
// Defecto MEDIDO en el log del dueno (2026-09-29 19:10-19:11). Tres capturas
// HUMANAS reales, tal cual salen en vite-dev.log, acabaron las tres igual:
//
//   WARN turnCommitPhrase turno SIN texto valido (motivo=stutter)
//        capture="..." fallback="" -> se cierra sin habla
//
// Su frase se tiraba entera porque repetia una palabra de <=3 letras ("no no",
// "ahi ahi"): el guard lo leia como tartamudeo del ASR y, al no haber texto
// validado de respaldo, el turno se cerraba MUDO. El dueno lo vivia como
// "le hablo y FLU no hace nada".
//
// El contrato anterior solo cubria el caso CON fallback (ver arriba). El hueco
// era el caso SIN fallback, que es justo el habla conversacional normal: si no
// hay comando, no hay texto validado, y la frase se perdia.
// ============================================================
describe('el log del dueno: habla real con repeticion no puede quedar muda', () => {
    // Capturas HUMANAS reales del log, sin retocar.
    const CAPTURAS_REALES = [
        'No la que está tirada ahí ahí conectada al desagüe',
        'SA- sA- o se ha filtrado normal',
        'se empieza a agarrar como un poquito más de fuerza y le digo ya está lista no no',
    ];

    it('commitea la frase real en vez de callar el turno (antes: mudo)', () => {
        for (const captura of CAPTURAS_REALES) {
            const resolved = resolveCommittablePhrase(captura, '');

            expect(resolved.phrase).toBe(captura);
            expect(resolved.phrase).not.toBe('');
            expect(resolved.reason).toBe('stutter');
        }
    });

    it('la alucinacion pura sigue descartandose (la repeticion DOMINA la frase)', () => {
        for (const ruido of ['se se', 'bor bor', 'el el el', 'la la la la']) {
            expect(classifyGarbageTranscript(ruido).repiteDominante).toBe(true);
            expect(resolveCommittablePhrase(ruido, '').phrase).toBe('');
        }
    });

    it('el ruido sin vocales sigue descartandose aunque no haya fallback', () => {
        expect(resolveCommittablePhrase('hmm mmm nnn', '').phrase).toBe('');
    });

    it('el texto validado sigue teniendo prioridad sobre la captura cruda', () => {
        const resolved = resolveCommittablePhrase(CAPTURA_CORRUPTA, AVIONES);

        expect(resolved.phrase).toBe(AVIONES);
        expect(resolved.usedFallback).toBe(true);
    });
});

// Prueba de DETECTOR del propio guard (no es decorativo): el MISMO llamador con
// una captura infractora (jerga sin vocales) y con una legítima (cifras) debe
// discriminar. Si el filtro volviera a tratar las cifras como ruido, cae.
describe('el detector no es decorativo (prueba de mutación)', () => {
    it('la marca distingue la jerga sin vocales del dictado de cifras', () => {
        expect(looksLikeGarbageTranscript('hmm mmm nnn'), 'jerga = basura').toBe(true);
        expect(looksLikeGarbageTranscript('25 58'), 'cifras = contenido').toBe(false);
    });
});

