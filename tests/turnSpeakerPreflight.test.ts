/**
 * voice/lib/turnSpeakerPreflight — identidad por turno (173 sentencias, 0% -> cubierto).
 *
 * POR QUE ESTE TEST: `src/voice/lib/turnSpeakerPreflight.js` es la costura entre
 * la cola de identidad (`voiceIdentityQueue`) y el commit: guarda un SLOT por
 * turno, acumula snapshots de audio durante los interinos y los entrega al
 * consumirlos (`finalizeTurnIdentityPipeline`). Su unico consumidor vivo lo usaba
 * con audio real; aqui se ejecuta la politica completa.
 *
 * NO CUBIERTO (declarado): la rama CON audio, que delega en el cliente del worker
 * (`voiceIdWorkerClient.resolveSpeakerFromAudio`); necesita el worker sustituido
 * y va con su propio arnes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearTurnSpeakerPreflight,
    consumeTurnSpeakerPreflight,
    createTurnSpeakerAudioResolver,
    peekTurnSpeakerPreflight,
    resetTurnSpeakerPreflights,
    scheduleTurnSpeakerPreflight,
} from '../src/voice/lib/turnSpeakerPreflight.js';
import { ContinuousAudioBuffer } from '../src/voice/lib/continuousAudioBuffer.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import { labelToSpeakerId } from '../src/voice/lib/conversationRow.js';

const fallbackLabel = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker;

/** Corre los timers agendados (la cola usa setTimeout 0) dejando avanzar microtareas. */
const flush = async () => {
    await vi.runAllTimersAsync();
    for (let round = 0; round < 4; round += 1) await Promise.resolve();
};

const fuerte = (speakerName: string, extra = {}) => () =>
    Promise.resolve({
        speakerName,
        speakerId: `id-${speakerName}`,
        signatureVector: [1, 0.5, 0.25],
        workingClusters: [{ label: speakerName }],
        reason: 'ok',
        audioStartSample: 4,
        audioStartedAtMs: 5,
        ...extra,
    });

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resetTurnSpeakerPreflights();
});

afterEach(async () => {
    await flush();
    resetTurnSpeakerPreflights();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('turnSpeakerPreflight — slot por turno', () => {
    it('un turno invalido o sin funcion no ocupa slot', () => {
        scheduleTurnSpeakerPreflight(0, fuerte('Hablante 2'));
        scheduleTurnSpeakerPreflight(Number.NaN, fuerte('Hablante 2'));
        scheduleTurnSpeakerPreflight(-3, fuerte('Hablante 2'));
        scheduleTurnSpeakerPreflight(7, null as unknown as () => unknown);

        expect(peekTurnSpeakerPreflight(0)).toBe(null);
        expect(peekTurnSpeakerPreflight(7)).toBe(null);
    });

    it('al agendar queda PENDIENTE y sin evidencia todavia', () => {
        scheduleTurnSpeakerPreflight(1, fuerte('Hablante 2'));

        expect(peekTurnSpeakerPreflight(1)).toMatchObject({
            turnId: 1,
            ready: false,
            pending: true,
            continuous: false,
            snapshots: [],
        });
        expect(peekTurnSpeakerPreflight(2)).toBe(null);
    });

    it('el resultado fuerte deja el slot listo con su snapshot', async () => {
        scheduleTurnSpeakerPreflight(1, fuerte('Hablante 2'));
        await flush();

        const slot = peekTurnSpeakerPreflight(1);
        expect(slot).toMatchObject({
            ready: true,
            pending: false,
            speakerId: 'id-Hablante 2',
            speakerName: 'Hablante 2',
            reason: 'ok',
            audioStartSample: 4,
            audioStartedAtMs: 5,
        });
        expect(slot!.signatureVector).toEqual([1, 0.5, 0.25]);
        expect(slot!.snapshots).toHaveLength(1);
    });

    it('reagendar el mismo turno ACUMULA snapshots (la evidencia no se pierde)', async () => {
        scheduleTurnSpeakerPreflight(1, fuerte('Hablante 2'));
        await flush();
        scheduleTurnSpeakerPreflight(1, fuerte('Hablante 3'));
        await flush();

        expect(peekTurnSpeakerPreflight(1)!.snapshots.map((s: { speakerName: string }) => s.speakerName)).toEqual([
            'Hablante 2',
            'Hablante 3',
        ]);
    });

    it('un resultado DEBIL no pisa una evidencia ya buena', async () => {
        scheduleTurnSpeakerPreflight(1, fuerte('Hablante 2'));
        await flush();

        scheduleTurnSpeakerPreflight(1, () =>
            Promise.resolve({ speakerName: 'Hablante 9', signatureVector: [], reason: 'no-vector' }),
        );
        await flush();

        const slot = peekTurnSpeakerPreflight(1);
        expect(slot!.speakerName).toBe('Hablante 2');
        expect(slot!.pending).toBe(false);
        expect(slot!.snapshots).toHaveLength(1);
    });

    it('consume entrega el slot y lo borra; peek y clear son la puerta del mapa', async () => {
        scheduleTurnSpeakerPreflight(1, fuerte('Hablante 2'));
        await flush();

        const slot = consumeTurnSpeakerPreflight(1);
        expect(slot!.speakerName).toBe('Hablante 2');
        expect(consumeTurnSpeakerPreflight(1)).toBe(null);
        expect(peekTurnSpeakerPreflight(1)).toBe(null);
        expect(consumeTurnSpeakerPreflight(99)).toBe(null);

        scheduleTurnSpeakerPreflight(2, fuerte('Hablante 3'));
        clearTurnSpeakerPreflight(2);
        expect(peekTurnSpeakerPreflight(2)).toBe(null);
    });

    // REGLA VIGENTE (2026-10-07, medida en el log del dueno; ENMIENDA 2026-10-20 por
    // b218404f): el aviso que COMPLETA la fila lo da SOLO el snapshot FINAL. El tick
    // CONTINUO calienta la cache del embedding pero NO escribe clusters NI avisa del
    // hablante: si avisara, la fila se reescribiria varias veces por turno (la misma
    // persona salia Hablante 1, luego 2, luego 4).
    // EXCEPCION (b218404f): un tick continuo que ABRE una voz NUEVA —mas clusters al
    // salir que al entrar, con el conjunto de entrada conocido— si persiste y avisa:
    // el snapshot FINAL puede llegar sin audio (turno ya sellado por el commit) y sin
    // esto la sesion se queda con UN cluster y la voz nueva hereda la etiqueta sticky
    // (medido: 18 escrituras con labels:["Luis"] y la mujer pegada a "Hablante 1").
    it('el continuo ni escribe clusters ni avisa; el aviso lo da el snapshot FINAL', async () => {
        const onClusters = vi.fn();
        const onResolvedFinal = vi.fn();
        scheduleTurnSpeakerPreflight(1, fuerte('Hablante 2'), { onClusters, onResolved: onResolvedFinal });
        await flush();
        expect(onClusters).toHaveBeenCalledWith([{ label: 'Hablante 2' }]);
        expect(onResolvedFinal).toHaveBeenCalledWith(
            expect.objectContaining({ speakerName: 'Hablante 2', turnId: 1 }),
        );

        const diferido = vi.fn();
        const resuelto = vi.fn();
        scheduleTurnSpeakerPreflight(2, fuerte('Hablante 3'), {
            onClusters: diferido,
            onResolved: resuelto,
            continuous: true,
        });
        await flush();
        expect(diferido).not.toHaveBeenCalled();
        expect(resuelto).not.toHaveBeenCalled();
        expect(peekTurnSpeakerPreflight(2)!.continuous).toBe(true);
    });

    it('un continuo que ABRE una voz nueva persiste el cluster y avisa (b218404f)', async () => {
        const onClusters = vi.fn();
        const onResolved = vi.fn();
        scheduleTurnSpeakerPreflight(3, fuerte('Hablante 4', { inputClusters: [] }), {
            onClusters,
            onResolved,
            continuous: true,
        });
        await flush();
        expect(onClusters).toHaveBeenCalledWith([{ label: 'Hablante 4' }]);
        expect(onResolved).toHaveBeenCalledWith(
            expect.objectContaining({ speakerName: 'Hablante 4', turnId: 3 }),
        );
        expect(peekTurnSpeakerPreflight(3)!.continuous).toBe(true);
    });

    it('un continuo que NO abre voz (mismos clusters de entrada) sigue diferido', async () => {
        const onClusters = vi.fn();
        const onResolved = vi.fn();
        scheduleTurnSpeakerPreflight(
            4,
            fuerte('Hablante 5', { inputClusters: [{ label: 'Hablante 5' }] }),
            { onClusters, onResolved, continuous: true },
        );
        await flush();
        expect(onClusters).not.toHaveBeenCalled();
        expect(onResolved).not.toHaveBeenCalled();
    });
});

    // MEDIDO EN d4c1c8f3: el aviso SOLO viaja con MEDIDA. El snapshot FINAL de un
    // turno ya sellado podia resolver sin audio (reason 'no-audio', vector vacio)
    // y aun asi avisaba del hablante de RESPALDO: ese aviso pisaba la ultima
    // resolucion medida y la fila siguiente heredaba la etiqueta equivocada (la
    // mujer quedaba batida entre "Hablante 1" y "Hablante 2").
    it('un final sin medida (no-audio) NO avisa aunque el slot ya se consumio', async () => {
        const onResolved = vi.fn();
        scheduleTurnSpeakerPreflight(
            5,
            () =>
                Promise.resolve({
                    speakerName: fallbackLabel,
                    speakerId: '',
                    signatureVector: [],
                    workingClusters: [{ label: fallbackLabel }],
                    reason: 'no-audio',
                }),
            { onResolved },
        );
        consumeTurnSpeakerPreflight(5); // el commit sello el turno: el final resuelve tarde
        await flush();
        expect(onResolved, 'sin vector no hay aviso de identidad').not.toHaveBeenCalled();
    });

    it('el MISMO final tardio CON medida sigue avisando (la fila se completa)', async () => {
        const onResolved = vi.fn();
        scheduleTurnSpeakerPreflight(6, fuerte('Hablante 2'), { onResolved });
        consumeTurnSpeakerPreflight(6);
        await flush();
        expect(onResolved).toHaveBeenCalledWith(
            expect.objectContaining({ speakerName: 'Hablante 2', turnId: 6 }),
        );
    });

describe('turnSpeakerPreflight — resolutor de audio del turno', () => {
    it('sin buffer responde no-audio con el hablante de respaldo', async () => {
        const resolver = createTurnSpeakerAudioResolver({
            getAudioBuffer: () => null,
            getSampleRate: () => 1_000,
            getTurnStartSample: () => 120,
            getSpeakerClusters: () => [{ label: 'Hablante 1' }],
            getAudioStartedAtMs: () => 7,
        });

        expect(typeof resolver).toBe('function');
        const out = await resolver();

        expect(out).toMatchObject({
            speakerName: fallbackLabel,
            speakerId: labelToSpeakerId(fallbackLabel),
            reason: 'no-audio',
            workingClusters: [{ label: 'Hablante 1' }],
            audioStartSample: 120,
            audioStartedAtMs: 7,
        });
        expect(out.signatureVector).toEqual([]);
    });

    it('un buffer VACIO tambien es no-audio (no intenta hablar con el worker)', async () => {
        const vacio = new ContinuousAudioBuffer({ sampleRate: 1_000 });
        const resolver = createTurnSpeakerAudioResolver({
            getAudioBuffer: () => vacio,
            getSampleRate: () => 1_000,
            getTurnStartSample: () => 0,
            getSpeakerClusters: () => [],
            getFallbackSpeaker: () => 'Hablante 7',
        });

        const out = await resolver();

        expect(out).toMatchObject({ speakerName: 'Hablante 7', reason: 'no-audio' });
        expect(out.workingClusters).toEqual([]);
    });

    it('sin sampleRate explicito cae al sample rate por defecto del motor', async () => {
        const resolver = createTurnSpeakerAudioResolver({
            getAudioBuffer: () => null,
        });

        const out = await resolver();

        expect(out.reason).toBe('no-audio');
        expect(Number.isFinite(out.audioStartSample)).toBe(true);
        expect(out.speakerName).toBe(fallbackLabel);
    });
});
