// @vitest-environment jsdom
// ============================================================
// audioAlertRepeat — la alarma INSISTE: 3 veces cada 10 s
// ------------------------------------------------------------
// Bug real: la alarma sonaba una sola vez. Invariante: el patrón se repite
// `repeat` veces con `repeatIntervalMs` entre repeticiones, y `stop()` cancela
// las repeticiones pendientes.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebAudioDriver } from '../src/core/temporal/audioAlert';

interface FakeOsc {
    started: number;
    stoppedAt: number;
}

function makeContext(oscs: FakeOsc[]) {
    return {
        state: 'running',
        currentTime: 0,
        destination: {},
        createOscillator() {
            const osc: FakeOsc = { started: 0, stoppedAt: 0 };
            oscs.push(osc);
            return {
                type: '',
                frequency: { value: 0 },
                connect: () => undefined,
                start: (t: number) => {
                    osc.started = t;
                },
                stop: (t: number) => {
                    osc.stoppedAt = t;
                },
                disconnect: () => undefined,
            };
        },
        createGain: () => ({ gain: { value: 0 }, connect: () => undefined, disconnect: () => undefined }),
    };
}

describe('audioAlert — la alarma suena 3 veces (1 + 2 repeticiones)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('programa 1 burst inicial + 2 repeticiones a 10 s', async () => {
        const oscs: FakeOsc[] = [];
        const driver = createWebAudioDriver(() => makeContext(oscs) as never);
        await driver.play({ beeps: 1, repeat: 2, repeatIntervalMs: 10_000 });
        expect(oscs).toHaveLength(1); // burst inicial
        vi.advanceTimersByTime(10_000);
        expect(oscs).toHaveLength(2);
        vi.advanceTimersByTime(10_000);
        expect(oscs).toHaveLength(3);
        vi.advanceTimersByTime(60_000);
        expect(oscs).toHaveLength(3); // no más
    });

    it('por defecto repite 2 veces (suena 3) sin config', async () => {
        const oscs: FakeOsc[] = [];
        const driver = createWebAudioDriver(() => makeContext(oscs) as never);
        await driver.play({ beeps: 1 });
        vi.advanceTimersByTime(20_000);
        expect(oscs).toHaveLength(3);
    });

    it('stop() cancela las repeticiones pendientes', async () => {
        const oscs: FakeOsc[] = [];
        const driver = createWebAudioDriver(() => makeContext(oscs) as never);
        await driver.play({ beeps: 1, repeat: 2, repeatIntervalMs: 10_000 });
        expect(oscs).toHaveLength(1);
        driver.stop();
        vi.advanceTimersByTime(60_000);
        expect(oscs).toHaveLength(1);
    });
});
