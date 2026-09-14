// @vitest-environment jsdom
// ============================================================
// Guard de comportamiento — Caso 7
// ------------------------------------------------------------
// 1) El driver WebAudio no debe programar beeps si "Detener" llega
//    mientras el AudioContext se reanuda.
// 2) Un vencido suena UNA sola vez: si "Detener" ocurre durante el
//    tick, los vencidos siguientes NO vuelven a sonar.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { AudioContextLike } from '../src/core/temporal/audioAlert';
import type { TemporalItemRecord } from '../src/core/temporal/temporalService';

const { serviceState, fakeService } = vi.hoisted(() => {
    const state = {
        items: [] as unknown[],
        releaseSecond: null as null | (() => void),
    };
    const service = {
        async list(): Promise<unknown[]> {
            return [];
        },
        async listActive(): Promise<unknown[]> {
            return state.items;
        },
        async rearm(id: string): Promise<null> {
            if (id === 'a2') {
                await new Promise<void>((resolve) => {
                    state.releaseSecond = resolve;
                });
            }
            return null;
        },
        async complete(): Promise<null> {
            return null;
        },
        async add(): Promise<{ ok: boolean }> {
            return { ok: true };
        },
        async cancel(): Promise<null> {
            return null;
        },
        async update(): Promise<null> {
            return null;
        },
        async remove(): Promise<boolean> {
            return false;
        },
    };
    return { serviceState: state, fakeService: service };
});

vi.mock('../src/core/db/fluDatabase', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/db/fluDatabase')>();
    return { ...actual, fluDb: { temporalItems: {} } };
});
vi.mock('../src/core/temporal/temporalService', () => ({
    createTemporalService: () => fakeService,
}));

import { createWebAudioDriver } from '../src/core/temporal/audioAlert';
import { useTemporalItems } from '../src/hooks/useTemporalItems';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();

function alarm(id: string): TemporalItemRecord {
    return {
        id,
        kind: 'alarm',
        label: id,
        trigger: { kind: 'daily', timeOfDay: '07:00' },
        recurrence: { kind: 'daily' },
        nextAt: NOW - 1000,
        status: 'pending',
        createdAt: NOW,
        updatedAt: NOW,
        sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    };
}

describe('audioAlert — stop durante resume no programa beeps', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('un stop mientras el contexto se reanuda aborta el play', async () => {
        vi.stubGlobal('window', {});
        let releaseResume: () => void = () => {};
        const oscillators: Array<{ start: ReturnType<typeof vi.fn> }> = [];
        const ctx = {
            state: 'suspended',
            currentTime: 0,
            destination: {},
            resume: () =>
                new Promise<void>((resolve) => {
                    releaseResume = resolve;
                }),
            createOscillator: () => {
                const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
                oscillators.push(osc);
                return osc;
            },
            createGain: () => ({ gain: { value: 0 }, connect: vi.fn() }),
        } as unknown as AudioContextLike;

        const driver = createWebAudioDriver(() => ctx);
        const playing = driver.play({ beeps: 3 });
        driver.stop();
        releaseResume();
        await playing;

        expect(oscillators.length).toBe(0);
    });
});

describe('useTemporalItems — detener cancela los vencidos del tick', () => {
    beforeEach(() => {
        serviceState.items = [alarm('a1'), alarm('a2')];
        serviceState.releaseSecond = null;
    });

    it('no vuelve a sonar para el vencido siguiente tras Detener', async () => {
        const audio = {
            isSupported: () => true,
            play: vi.fn(async () => {}),
            stop: vi.fn(),
        };

        const { result } = renderHook(() => useTemporalItems({ now: () => NOW, audio }));
        await waitFor(() => expect(result.current.ringing?.id).toBe('a1'));

        act(() => {
            result.current.stopRinging();
        });

        await act(async () => {
            serviceState.releaseSecond?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(audio.play).toHaveBeenCalledTimes(1);
        expect(audio.stop).toHaveBeenCalled();
        expect(result.current.ringing).toBeNull();
    });
});
