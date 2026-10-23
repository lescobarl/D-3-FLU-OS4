/**
 * voice/lib/conversationSession — frontera, log y hablante (154 sentencias, 0%).
 *
 * POR QUE ESTE TEST: `src/voice/lib/conversationSession.js` son las TRES reglas
 * del turno: (1) frontera = captura acumulativa del ASR, (2) log = delta respecto
 * a la frontera sin duplicar la linea anterior, (3) hablante = continuidad salvo
 * pronunciacion del nombre. Estaba al 0% y son funciones puras sobre el estado del
 * turno, asi que se fijan con los COLABORADORES REALES (turnTranscript, speakerLabels,
 * conversationRow) y no con dobles: lo que se afirma es el texto que sale.
 *
 * NO CUBIERTO (declarado): la rama de nombre PRONUNCIADO por wake word
 * (`resolveSpeakerNameFromUtterance` -> `detectWakeIntroducedName`); esa deteccion
 * tiene su propio dueno y sus guards, aqui solo se fija la continuidad.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    computeSpillAfterLog,
    createCommitQueue,
    endsWithPartialWord,
    filterSessionHistoryByStart,
    isDuplicateLogPhrase,
    listSessionSpeakers,
    readCommandSnapshot,
    readTurnCapture,
    readTurnCaptureForCommit,
    resolvePassiveSpeaker,
    trimRecognitionBoundary,
} from '../src/voice/lib/conversationSession.js';
import { applyRecognitionResult, createTurnState } from '../src/voice/lib/turnTranscript.js';
import { SPEAKER_ID_CALCULATING } from '../src/voice/lib/conversationRow.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

/** Estado de turno con lo ultimo confirmado y/o un interino en curso. */
const turn = ({ final = '', interim = '' } = {}) => {
    const state = createTurnState();
    if (final) applyRecognitionResult(state, { finalText: final });
    if (interim) applyRecognitionResult(state, { interimText: interim });
    return state;
};

describe('conversationSession — frontera del reconocimiento', () => {
    it('la frontera se limpia y se recorta por la COLA cuando se pasa del tope', () => {
        expect(trimRecognitionBoundary('  hola   como estas ')).toBe('hola como estas');
        expect(trimRecognitionBoundary('')).toBe('');

        // El recorte se lleva la COLA: con un texto de cabeza/cola distinguibles se nota.
        const largo = `${'a'.repeat(4_100)}TAIL`;
        const recortado = trimRecognitionBoundary(largo, 4_000);
        expect(recortado.length).toBe(4_000);
        expect(recortado.endsWith('TAIL')).toBe(true);
        expect(recortado.startsWith('TAIL')).toBe(false);
    });

    it('una letra suelta al final bloquea el commit (no "me escuchas", no "estas")', () => {
        expect(endsWithPartialWord('hola como l')).toBe(true);
        expect(endsWithPartialWord('hola como la')).toBe(false);
        expect(endsWithPartialWord('hola como y')).toBe(false);
        expect(endsWithPartialWord('hola como')).toBe(false);
        expect(endsWithPartialWord('hola')).toBe(false);
        expect(endsWithPartialWord('')).toBe(false);
        expect(endsWithPartialWord('¿como estas?')).toBe(false);
    });
});

describe('conversationSession — log de conversacion', () => {
    it('una frase duplicada se reconoce tambien por prefijo o sufijo', () => {
        expect(isDuplicateLogPhrase('', '')).toBe(true);
        expect(isDuplicateLogPhrase('hola', '')).toBe(false);
        expect(isDuplicateLogPhrase('hola', 'hola')).toBe(true);
        expect(isDuplicateLogPhrase('hola', 'hola como estas')).toBe(true);
        expect(isDuplicateLogPhrase('estas', 'hola como estas')).toBe(true);
        expect(isDuplicateLogPhrase('otra cosa', 'hola como estas')).toBe(false);
        // La comparacion es literal (sin normalizar mayusculas).
        expect(isDuplicateLogPhrase('Hola', 'hola')).toBe(false);
    });

    it('pasada la pausa, la misma frase es habla NUEVA (una sola ventana de eco)', () => {
        // Falsificacion del colapso que perdia locuciones: una pregunta MAS CORTA segundos
        // despues de otra larga es un turno nuevo, no un duplicado de la anterior.
        const corta = 'ok flu como voy';
        const larga = 'ok flu como voy en ingles';
        expect(isDuplicateLogPhrase(corta, larga), 'dentro de la ventana: mismo evento').toBe(true);
        expect(isDuplicateLogPhrase(corta, larga, { msSinceLastEmit: 5000 }), 'pasada la pausa: habla nueva').toBe(false);
    });

    it('el sobrante tras registrar es el delta entre lo registrado y la captura', () => {
        expect(computeSpillAfterLog(turn({ final: 'hola como estas en clase' }), '', '')).toBe('hola como estas en clase');
        expect(computeSpillAfterLog(turn({ final: 'hola como estas en clase' }), '', 'hola como estas')).toBe('en clase');
        expect(computeSpillAfterLog(turn({ final: 'hola' }), '', 'hola')).toBe('');
    });
});

describe('conversationSession — lo que se muestra y lo que se compromete', () => {
    it('la ultima frase y el snapshot de comando SON la misma cosa', () => {
        const state = turn({ interim: 'hola como estas' });

        expect(readCommandSnapshot(state)).toBe('hola como estas');
    });

    it('con sobrante pendiente, manda el texto mas largo o se unen', () => {
        const state = turn({ interim: 'hola como estas' });

        expect(readCommandSnapshot(state, 'hola como estas')).toBe('hola como estas');
        expect(readCommandSnapshot(state, 'hola')).toBe('hola como estas');
        expect(readCommandSnapshot(state, 'hola como estas en clase')).toBe('hola como estas en clase');
        expect(readCommandSnapshot(state, 'otra cosa aparte')).toBe('otra cosa aparte hola como estas');
        expect(readCommandSnapshot(turn(), 'solo sobrante')).toBe('solo sobrante');
    });

    it('la captura del commit incluye el sobrante y coincide con su dueno en turnTranscript', () => {
        const conFinal = turn({ final: 'hola como estas' });
        expect(readTurnCapture(conFinal)).toBe('hola como estas');
        // El sobrante va DELANTE cuando no encaja con la captura (mismo criterio que el display).
        expect(readTurnCapture(conFinal, 'y en clase')).toBe('y en clase hola como estas');

        const paraCommit = turn({ final: 'hola como estas' });
        expect(readTurnCaptureForCommit(paraCommit, 'y en clase')).toBe(readTurnCapture(conFinal, 'y en clase'));
    });
});

describe('conversationSession — cola de commits', () => {
    it('serializa las tareas en orden (una espera a la anterior)', async () => {
        const queue = createCommitQueue();
        const orden: string[] = [];
        let liberar: () => void = () => {};

        const primera = queue.enqueue(
            () =>
                new Promise<void>((resolve) => {
                    orden.push('primera:inicio');
                    liberar = () => {
                        orden.push('primera:fin');
                        resolve();
                    };
                }),
        );
        const segunda = queue.enqueue(() => {
            orden.push('segunda');
            return 'ok';
        });

        await Promise.resolve();
        expect(orden).toEqual(['primera:inicio']);

        liberar();
        await expect(primera).resolves.toBeUndefined();
        await expect(segunda).resolves.toBe('ok');
        expect(orden).toEqual(['primera:inicio', 'primera:fin', 'segunda']);
    });

    it('una tarea que falla se le reporta a quien la encolo pero NO rompe la cola', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const queue = createCommitQueue();

        const fallo = queue.enqueue(() => Promise.reject(new Error('commit roto')));
        await expect(fallo).rejects.toThrow('commit roto');

        const despues = queue.enqueue(() => 'sigo vivo');
        await expect(despues).resolves.toBe('sigo vivo');
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});

describe('conversationSession — hablantes de la sesion', () => {
    it('lista hablantes: fuera FLU, fuera duplicados, fuera los que se estan calculando', () => {
        const history = [
            { speakerName: 'Luis' },
            { speakerName: 'flu' },
            { speakerName: '  ' },
            { speakerName: 'Ana' },
            { speakerName: 'Ana / Luis' },
            { speakerName: 'Ana' },
            { speakerName: 'Fantasma', speakerId: SPEAKER_ID_CALCULATING },
            { speakerName: 'Hablante 2' },
        ];

        expect(listSessionSpeakers(history)).toEqual(['Hablante 2', 'Ana', 'Luis']);
    });

    it('un historial vacio no inventa hablantes', () => {
        expect(listSessionSpeakers([])).toEqual([]);
    });

    it('el hablante pasivo es la continuidad salvo que se pronuncie un nombre', () => {
        expect(resolvePassiveSpeaker('hola que tal', 'Hablante 2')).toBe('Hablante 2');
        expect(resolvePassiveSpeaker('hola que tal', '  Hablante 3 ')).toBe('Hablante 3');
        expect(resolvePassiveSpeaker('', '')).toBe(FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker);
    });
});

describe('conversationSession — historial por sesion', () => {
    const rows = [
        { text: 'hola', timestamp: 100 },
        { transcript: 'como estas', timestamp: 200 },
        { text: '   ', timestamp: 250 },
        { text: 'de antes', timestamp: 50 },
        null,
        { text: 'sin fecha' },
    ];

    it('sin inicio de sesion conserva lo que tiene texto y descarta el resto', () => {
        expect(filterSessionHistoryByStart(rows, 0)).toEqual([
            { text: 'hola', timestamp: 100 },
            { transcript: 'como estas', timestamp: 200 },
            { text: 'de antes', timestamp: 50 },
            { text: 'sin fecha' },
        ]);
    });

    it('con inicio de sesion exige fecha valida y posterior', () => {
        expect(filterSessionHistoryByStart(rows, 150)).toEqual([
            { transcript: 'como estas', timestamp: 200 },
            { text: '   ', timestamp: 250 },
        ].filter((row) => row.text !== '   '));
    });

    it('una entrada que no es objeto o un historial que no es lista no rompen', () => {
        expect(filterSessionHistoryByStart('no soy lista' as unknown as unknown[], 0)).toEqual([]);
        expect(filterSessionHistoryByStart(rows, 'ayer' as unknown as number)).toEqual(filterSessionHistoryByStart(rows, 0));
    });
});
