/**
 * voice/lib/voiceIdentityQueue — cola de identidad (82 sentencias, 0% -> cubierto).
 *
 * POR QUE ESTE TEST: `src/voice/lib/voiceIdentityQueue.js` es la cola que hace
 * viable la identidad en tiempo real: UN job en vuelo y un `pending` REEMPLAZABLE.
 * De su politica depende que el troceo por hablante (asrTurnSegmentation) reciba
 * snapshots frescos y no trabajo viejo. Estaba al 0%: nadie ejecutaba los descartes
 * ni los caminos de fallo.
 *
 * SEMANTICA REAL (medida, no supuesta): al encolar, el job pasa directo a EN VUELO
 * (drainQueue lo saca de `pending` y agenda en `setTimeout(0)`); `hasPending` solo
 * es true para un job ESPERANDO detras de otro. Y `droppedCount` es acumulativo por
 * diseño, asi que se afirma por DELTA.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    enqueueSpeakerIdentityJob,
    getSpeakerIdentityQueueStats,
    peekPendingIdentityRowId,
    resetSpeakerIdentityQueue,
} from '../src/voice/lib/voiceIdentityQueue.js';

const stats = () => getSpeakerIdentityQueueStats();
const dropped = () => stats().droppedCount;

/** Corre TODOS los timers agendados (setTimeout 0) dejando avanzar las microtareas. */
const flush = async () => {
    await vi.runAllTimersAsync();
    for (let round = 0; round < 4; round += 1) await Promise.resolve();
};

/** Solo microtareas: deja cerrar un job en vuelo SIN arrancar el siguiente. */
const microtasks = async () => {
    for (let round = 0; round < 6; round += 1) await Promise.resolve();
};

const deferred = () => {
    let resolve: (value: unknown) => void = () => {};
    let reject: (error: unknown) => void = () => {};
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resetSpeakerIdentityQueue();
});

afterEach(async () => {
    await flush();
    resetSpeakerIdentityQueue();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('voiceIdentityQueue — encolado y ejecucion', () => {
    it('sin funcion que ejecutar no se encola nada', () => {
        enqueueSpeakerIdentityJob({ rowId: 'sin-run' });

        expect(stats()).toEqual({ inFlight: false, hasPending: false, droppedCount: 0 });
        expect(peekPendingIdentityRowId()).toBe('');
    });

    it('al encolar el job queda EN VUELO y se ejecuta una sola vez', async () => {
        const run = vi.fn(async () => 'listo');
        const onSuccess = vi.fn();

        enqueueSpeakerIdentityJob({ rowId: 'r-1', run, onSuccess });
        expect(stats().inFlight).toBe(true);
        expect(stats().hasPending).toBe(false);
        expect(run).not.toHaveBeenCalled();

        await flush();

        expect(run).toHaveBeenCalledTimes(1);
        expect(onSuccess).toHaveBeenCalledWith('listo');
        expect(stats().inFlight).toBe(false);
        expect(stats().hasPending).toBe(false);
        expect(peekPendingIdentityRowId()).toBe('');
    });

    it('mientras uno corre, el siguiente ESPERA y arranca despues', async () => {
        const orden: string[] = [];
        const primero = deferred();
        enqueueSpeakerIdentityJob({
            rowId: 'A',
            run: () => {
                orden.push('A');
                return primero.promise;
            },
        });
        await flush();

        enqueueSpeakerIdentityJob({
            rowId: 'B',
            run: () => {
                orden.push('B');
                return 'B';
            },
        });

        expect(stats().inFlight).toBe(true);
        expect(stats().hasPending).toBe(true);
        expect(peekPendingIdentityRowId()).toBe('B');
        await microtasks();
        expect(orden).toEqual(['A']);

        primero.resolve('A');
        await flush();

        expect(orden).toEqual(['A', 'B']);
        expect(stats().hasPending).toBe(false);
    });
});

describe('voiceIdentityQueue — descartes (drop stale)', () => {
    it('un pending se descarta si llega otro en la ventana entre jobs', async () => {
        const antes = dropped();
        const primero = deferred();
        enqueueSpeakerIdentityJob({ rowId: 'A', run: () => primero.promise });
        await flush();

        const runB = vi.fn();
        const onDropB = vi.fn();
        const onErrorB = vi.fn();
        enqueueSpeakerIdentityJob({ rowId: 'B', run: runB, onDrop: onDropB, onError: onErrorB });

        // A termina: la cola queda sin vuelo y con B esperando su turno agendado.
        primero.resolve('A');
        await microtasks();
        expect(stats().inFlight).toBe(false);
        expect(stats().hasPending).toBe(true);

        enqueueSpeakerIdentityJob({ rowId: 'C', run: vi.fn(async () => 'C') });

        expect(onDropB).toHaveBeenCalledWith('superseded-before-start');
        expect((onErrorB.mock.calls[0][0] as Error).message).toBe('superseded-before-start');
        expect(runB).not.toHaveBeenCalled();
        expect(dropped() - antes).toBe(1);
        // C no espera a nadie: al no haber vuelo, arranca en el acto.
        expect(stats().inFlight).toBe(true);
        expect(peekPendingIdentityRowId()).toBe('');

        await flush();
        expect(stats().hasPending).toBe(false);
    });

    it('un pending se descarta si llega otro mientras uno CORRE', async () => {
        const antes = dropped();
        const primero = deferred();
        enqueueSpeakerIdentityJob({ rowId: 'A', run: () => primero.promise });
        await flush();

        const runB = vi.fn(async () => 'B');
        const onDropB = vi.fn();
        enqueueSpeakerIdentityJob({ rowId: 'B', run: runB, onDrop: onDropB });
        const runC = vi.fn(async () => 'C');
        enqueueSpeakerIdentityJob({ rowId: 'C', run: runC });

        expect(onDropB).toHaveBeenCalledWith('superseded-while-queued');
        expect(peekPendingIdentityRowId()).toBe('C');
        expect(dropped() - antes).toBe(1);

        primero.resolve('A');
        await flush();

        expect(runB).not.toHaveBeenCalled();
        expect(runC).toHaveBeenCalledTimes(1);
    });

    it('reset descarta lo pendiente con su motivo y deja la cola usable', async () => {
        const primero = deferred();
        enqueueSpeakerIdentityJob({ rowId: 'A', run: () => primero.promise });
        await flush();

        const onDrop = vi.fn();
        const onError = vi.fn();
        enqueueSpeakerIdentityJob({ rowId: 'pendiente', run: vi.fn(), onDrop, onError });

        resetSpeakerIdentityQueue();

        expect(onDrop).toHaveBeenCalledWith('queue-reset');
        expect((onError.mock.calls[0][0] as Error).message).toBe('queue-reset');
        expect(stats().inFlight).toBe(false);
        expect(stats().hasPending).toBe(false);

        primero.resolve('A');
        await flush();

        const run = vi.fn(async () => 'despues');
        enqueueSpeakerIdentityJob({ rowId: 'despues', run });
        await flush();
        expect(run).toHaveBeenCalledTimes(1);
    });
});

describe('voiceIdentityQueue — caminos de fallo', () => {
    it('con onError el fallo va al manejador (y no al fallback)', async () => {
        const onError = vi.fn();
        const onSuccess = vi.fn();

        enqueueSpeakerIdentityJob({
            rowId: 'falla',
            run: () => Promise.reject(new Error('sin datos')),
            onError,
            onSuccess,
            fallback: { speakerName: 'Hablante 1' },
        });
        await flush();

        expect(onError).toHaveBeenCalledTimes(1);
        expect((onError.mock.calls[0][0] as Error).message).toBe('sin datos');
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('sin onError pero con fallback, el fallback se entrega como EXITO', async () => {
        const onSuccess = vi.fn();

        enqueueSpeakerIdentityJob({
            rowId: 'fallback',
            run: () => Promise.reject(new Error('sin datos')),
            onSuccess,
            fallback: { speakerName: 'Hablante 1' },
        });
        await flush();

        expect(onSuccess).toHaveBeenCalledWith({ speakerName: 'Hablante 1' });
        expect(stats().inFlight).toBe(false);
    });

    it('un fallo sin manejador ni fallback no rompe la cola', async () => {
        const antes = dropped();
        enqueueSpeakerIdentityJob({ rowId: 'mudo', run: () => Promise.reject(new Error('x')) });
        await flush();

        expect(stats().inFlight).toBe(false);
        expect(stats().hasPending).toBe(false);
        expect(dropped()).toBe(antes);

        const run = vi.fn(async () => 'siguiente');
        enqueueSpeakerIdentityJob({ rowId: 'siguiente', run });
        await flush();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('un job que lanza SINCRONICAMENTE tambien se trata como fallo', async () => {
        const onError = vi.fn();

        enqueueSpeakerIdentityJob({
            rowId: 'lanza',
            run: () => {
                throw new Error('explotó al arrancar');
            },
            onError,
        });
        await flush();

        expect(onError).toHaveBeenCalledTimes(1);
        expect((onError.mock.calls[0][0] as Error).message).toBe('explotó al arrancar');
    });
});
