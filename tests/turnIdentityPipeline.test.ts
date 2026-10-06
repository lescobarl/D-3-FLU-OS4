/**
 * voice/lib/turnIdentityPipeline — snapshots de identidad por turno (55 sentencias, 0%).
 *
 * POR QUE ESTE TEST: `src/voice/lib/turnIdentityPipeline.js` es lo que se ejecuta en
 * CADA commit de turno (`finalizeTurnIdentityPipeline`) y lo que agenda los snapshots
 * continuos durante los interinos. Es puro salvo timers, y su unico consumidor lo
 * usaba con audio real. Aqui se fija con la cola de identidad y los SLOTS REALES
 * (voiceIdentityQueue + turnSpeakerPreflight), asi que el oraculo es lo que el commit
 * mira de verdad: cuantos snapshots hay y si el slot esta listo.
 *
 * OJO CON LA FORMA DE LA API (me costo un arnes entero): este modulo toma una
 * FABRICA en `startContinuousIdentityPipeline` (una funcion que DEVUELVE el
 * resolutor) y un RESOLUTOR en `finalizeTurnIdentityPipeline`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    finalizeTurnIdentityPipeline,
    getIdentitySnapshotIntervalMs,
    resetTurnIdentityPipeline,
    startContinuousIdentityPipeline,
    stopAllContinuousIdentityPipelines,
    stopContinuousIdentityPipeline,
} from '../src/voice/lib/turnIdentityPipeline.js';
import { peekTurnSpeakerPreflight, resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js';
import { getSpeakerIdentityQueueStats, resetSpeakerIdentityQueue } from '../src/voice/lib/voiceIdentityQueue.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

/** Deja correr los timers YA vencidos (la cola usa setTimeout 0) sin disparar el intervalo. */
const flush = async () => {
    for (let round = 0; round < 6; round += 1) {
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
    }
};

/** Resolutor con evidencia fuerte: la identidad que el commit puede usar. */
const resolverFuerte = (speakerName = 'Hablante 2') => () =>
    Promise.resolve({ speakerName, speakerId: `id-${speakerName}`, signatureVector: [1, 0.5], reason: 'ok' });

/** Fabrica de resolutores, que es lo que pide el pipeline continuo. */
const fabrica = (speakerName?: string) => vi.fn(() => resolverFuerte(speakerName));

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resetSpeakerIdentityQueue();
    resetTurnSpeakerPreflights();
});

afterEach(async () => {
    await flush();
    resetTurnIdentityPipeline();
    resetSpeakerIdentityQueue();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('turnIdentityPipeline — intervalo de snapshots', () => {
    it('usa el intervalo del dueno de ese numero y no baja del minimo', () => {
        const interval = getIdentitySnapshotIntervalMs();
        expect(interval).toBe(Number(FLU_CONFIG.voiceIdentity.capture.identityPipeline.snapshotIntervalMs));
        expect(interval).toBeGreaterThanOrEqual(200);

        const config = (snapshotIntervalMs: number | undefined) => ({
            voiceIdentity: { capture: { identityPipeline: { snapshotIntervalMs } } },
        });
        expect(getIdentitySnapshotIntervalMs(config(100))).toBe(800);
        expect(getIdentitySnapshotIntervalMs(config(0))).toBe(800);
        expect(getIdentitySnapshotIntervalMs(config(undefined))).toBe(800);
        expect(getIdentitySnapshotIntervalMs({ voiceIdentity: { capture: {} } })).toBe(800);
        expect(getIdentitySnapshotIntervalMs({})).toBe(800);
    });
});

describe('turnIdentityPipeline — pipeline continuo', () => {
    it('un turno invalido no arranca nada', () => {
        const factory = fabrica();

        startContinuousIdentityPipeline(0, factory);
        startContinuousIdentityPipeline(Number.NaN, factory);
        startContinuousIdentityPipeline('x' as unknown as number, factory);

        expect(factory).not.toHaveBeenCalled();
    });

    it('arranca con un snapshot inmediato y sigue cada intervalo', async () => {
        const factory = fabrica();

        startContinuousIdentityPipeline(1, factory);
        expect(factory).toHaveBeenCalledTimes(1);
        await flush();
        expect(peekTurnSpeakerPreflight(1)!.snapshots.length).toBe(1);

        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs());
        expect(factory).toHaveBeenCalledTimes(2);
        await flush();
        expect(peekTurnSpeakerPreflight(1)!.snapshots.length).toBe(2);

        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs());
        expect(factory).toHaveBeenCalledTimes(3);
        await flush();
        expect(peekTurnSpeakerPreflight(1)!.snapshots.length).toBe(3);
    });

    it('si un snapshot se atasca, los siguientes se DESCARTAN en la cola (drop stale)', async () => {
        // Un resolutor que nunca resuelve deja el primero EN VUELO: los siguientes
        // ticks no pueden arrancar y la cola los va descartando.
        const atascado = vi.fn(() => () => new Promise(() => {}));
        const antes = getSpeakerIdentityQueueStats().droppedCount;

        startContinuousIdentityPipeline(1, atascado);
        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs() * 2);
        await flush();

        expect(atascado).toHaveBeenCalledTimes(3);
        expect(getSpeakerIdentityQueueStats().droppedCount).toBeGreaterThan(antes);
        expect(peekTurnSpeakerPreflight(1)!.snapshots).toEqual([]);
    });

    it('rearrancar el mismo turno no duplica el intervalo', async () => {
        const primero = fabrica('Hablante 2');
        startContinuousIdentityPipeline(1, primero);

        const segundo = fabrica('Hablante 3');
        startContinuousIdentityPipeline(1, segundo);

        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs());
        // El viejo se paro (solo su tick inmediato); el nuevo vive su tick inmediato + uno de intervalo.
        expect(primero).toHaveBeenCalledTimes(1);
        expect(segundo).toHaveBeenCalledTimes(2);
    });

    it('parar el turno o parar todo deja de pedir snapshots', async () => {
        const uno = fabrica('Hablante 2');
        const dos = fabrica('Hablante 3');
        startContinuousIdentityPipeline(1, uno);
        startContinuousIdentityPipeline(2, dos);

        stopContinuousIdentityPipeline(1);
        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs() * 3);
        expect(uno).toHaveBeenCalledTimes(1);
        expect(dos.mock.calls.length).toBeGreaterThan(1);

        const antes = dos.mock.calls.length;
        stopAllContinuousIdentityPipelines();
        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs() * 3);
        expect(dos.mock.calls.length).toBe(antes);
    });
});

describe('turnIdentityPipeline — cierre de turno', () => {
    it('finalize para el continuo, pide el snapshot final y devuelve el slot con lo acumulado', async () => {
        const continua = fabrica('Hablante 2');
        startContinuousIdentityPipeline(1, continua);
        await flush();
        expect(peekTurnSpeakerPreflight(1)!.snapshots.length).toBe(1);

        const final = vi.fn(resolverFuerte('Hablante 3'));
        const slot = finalizeTurnIdentityPipeline(1, final);

        // El consumidor recibe el slot del turno, con la evidencia que ya habia.
        expect(slot).not.toBe(null);
        expect(slot!.snapshots.length).toBeGreaterThanOrEqual(1);
        await flush();
        expect(final).toHaveBeenCalledTimes(1);

        const ticksTrasFinalizar = continua.mock.calls.length;
        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs() * 4);
        expect(continua.mock.calls.length).toBe(ticksTrasFinalizar);
    });

    it('sin slot previo listo, finalize consume ANTES de que llegue el snapshot final', async () => {
        // HALLAZGO (queda como test): encola el snapshot final y consume el slot en el
        // acto, asi que el resultado asincrono no tiene donde aterrizar y se pierde.
        // Con slot previo (caso anterior) SI se conserva: el slot se copia al reagendar.
        const final = vi.fn(resolverFuerte('Hablante 5'));

        const slot = finalizeTurnIdentityPipeline(3, final);

        expect(slot).not.toBe(null);
        expect(slot!.pending).toBe(true);
        expect(slot!.snapshots).toEqual([]);
        expect(final).not.toHaveBeenCalled();
        expect(peekTurnSpeakerPreflight(3)).toBe(null); // ya consumido

        await flush();
        expect(final).toHaveBeenCalledTimes(1);
        expect(peekTurnSpeakerPreflight(3)).toBe(null); // y el resultado no tiene slot
    });

    it('reset para todo y vacia los slots', async () => {
        const factory = fabrica();
        startContinuousIdentityPipeline(1, factory);
        await flush();
        expect(peekTurnSpeakerPreflight(1)).not.toBe(null);

        resetTurnIdentityPipeline();
        expect(peekTurnSpeakerPreflight(1)).toBe(null);

        const antes = factory.mock.calls.length;
        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs() * 3);
        expect(factory.mock.calls.length).toBe(antes);
    });

    // DEFECTO MEDIDO (2026-10-06): el hook arranca el pipeline cuando el id del turno
    // AUN NO existe; si se captura el id al arrancar, los snapshots caen en un slot
    // que el commit no mira (`Preflight turn=5` vs `Commit turn=9`) y el cluster se
    // pierde. Con un GETTER, el pipeline sigue al turno ACTUAL.
    it('con un GETTER, el pipeline sigue al turno ACTUAL (no al id capturado al arrancar)', async () => {
        let idActual = 1;
        const factory = fabrica();

        startContinuousIdentityPipeline(() => idActual, factory);
        await flush();
        expect(peekTurnSpeakerPreflight(1)?.snapshots?.length).toBe(1);

        idActual = 9;
        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs());
        await flush();
        expect(
            peekTurnSpeakerPreflight(9)?.snapshots?.length,
            'el snapshot debe caer en el turno actual (9), no en el viejo (1)',
        ).toBeGreaterThan(0);
    });

    it('el pipeline con GETTER se detiene con el id del commit (aunque sea otro)', async () => {
        let idActual = 1;
        const factory = fabrica();
        startContinuousIdentityPipeline(() => idActual, factory);
        await flush();

        idActual = 9;
        stopContinuousIdentityPipeline(9);
        const antes = factory.mock.calls.length;
        await vi.advanceTimersByTimeAsync(getIdentitySnapshotIntervalMs() * 3);
        expect(factory.mock.calls.length).toBe(antes);
    });
});
