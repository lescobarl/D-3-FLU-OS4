// @vitest-environment jsdom
// ============================================================
// minuteOnboardingGate — la minuta NO se lee antes del onboarding
// ------------------------------------------------------------
// Invariante pedida: la lectura de minuta (y el arranque de conversación) ocurre
// DESPUÉS del onboarding, cuando ya se sabe qué usuario entra.
// - `useMinuteKnowledge` sin usuario real NO lee (no cae a 'global').
// - App le pasa `realParticipantId`, que exige `sessionReady` (se enciende recién
//   al completar el onboarding, en `activateParticipant`).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { minutesMock } = vi.hoisted(() => {
    let calls = 0;
    const table = {
        orderBy: () => ({
            reverse: () => ({
                toArray: async () => {
                    calls += 1;
                    return [] as unknown[];
                },
            }),
        }),
        __calls: () => calls,
        __reset: () => {
            calls = 0;
        },
    };
    return { minutesMock: table };
});

vi.mock('../src/core/db/fluDatabase', async () => {
    const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>(
        '../src/core/db/fluDatabase',
    );
    return { ...actual, fluDb: { minutes: minutesMock } };
});

import { useMinuteKnowledge } from '../src/hooks/useMinuteKnowledge';

beforeEach(() => minutesMock.__reset());

describe('minuta — no se lee sin usuario (antes/después del onboarding)', () => {
    it('sin usuario real NO lee la tabla de minutas', async () => {
        const { result } = renderHook(() => useMinuteKnowledge(undefined));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.minutes).toEqual([]);
        expect(minutesMock.__calls(), 'no debe tocar la DB sin usuario').toBe(0);
    });

    it('con usuario real sí lee', async () => {
        const { result } = renderHook(() => useMinuteKnowledge('user-a'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(minutesMock.__calls()).toBeGreaterThan(0);
    });
});

describe('minuta — App usa el usuario REAL (post-onboarding)', () => {
    const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

    it('pasa realParticipantId, no el centinela', () => {
        expect(app).toContain('useMinuteKnowledge(realParticipantId)');
    });

    it('realParticipantId exige sessionReady (se enciende al completar onboarding)', () => {
        expect(app).toMatch(/sessionReady\s*&&\s*activeParticipantId/);
        expect(app).toContain('setSessionReady(true)');
    });
});
