// @vitest-environment jsdom
// ============================================================
// Guard de comportamiento — Caso 3
// ------------------------------------------------------------
// Al cerrar el día anterior hay que generar Y GUARDAR la minuta,
// no sólo dejar un draft. `handleGenerateSummary({ save: true })`
// debe persistir y reportar el resultado para que el día se marque
// únicamente si se guardó.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { IntegrationStore } from '../src/store/integrationStore';
import type { MinuteHandlersDeps } from '../src/hooks/useMinuteHandlers';
import type { ConversationEntry } from '../src/types/bridge';
import type { MinuteSummarySnapshot } from '../src/core/db/fluDatabase';

const { summarizeMock } = vi.hoisted(() => ({ summarizeMock: vi.fn() }));

vi.mock('../src/services/aiServiceFactory', () => ({
    aiService: { generateConversationSummary: summarizeMock },
}));
vi.mock('../src/voice/lib/fluSpeech', () => ({
    speakResponse: vi.fn(async () => {}),
}));

import { useMinuteHandlers } from '../src/hooks/useMinuteHandlers';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();

function entry(): ConversationEntry {
    return {
        id: 'c1',
        role: 'user',
        text: 'hola, conversación de ayer',
        timestamp: NOW - 24 * 60 * 60 * 1000,
        speakerName: 'Luis',
    } as ConversationEntry;
}

function makeDeps(addMinute: ReturnType<typeof vi.fn>): MinuteHandlersDeps {
    const integrationStore = {
        conversationHistory: [entry()],
        conversationState: 'IDLE',
        setConversationState: vi.fn(),
        addMinute: vi.fn(),
    } as unknown as IntegrationStore;

    return {
        integrationStore,
        minuteKnowledge: { minutes: [], addMinute },
        auditLog: { logEvent: vi.fn(async () => ({})) },
        language: 'es',
        apiKey: '',
        sessionRole: 'trabajo',
        voiceStatus: 'idle',
        minuteDraft: null,
        setMinuteDraft: vi.fn(),
        setSelectedMinuteId: vi.fn(),
        os2StartListening: vi.fn(async () => {}),
        os2StopListening: vi.fn(async () => {}),
        getCommandSpeech: () => '',
    } as unknown as MinuteHandlersDeps;
}

const SUMMARY: MinuteSummarySnapshot = {
    titulo: 'Cierre de ayer',
    participantes: ['Luis'],
    resumen: 'Se revisó el avance.',
    acuerdos: [],
    pendientes: [],
    siguientes_pasos: [],
    tema_sesion: 'trabajo',
};

describe('useMinuteHandlers — cierre de día guarda la minuta', () => {
    beforeEach(() => {
        summarizeMock.mockReset();
        summarizeMock.mockResolvedValue(SUMMARY);
    });

    it('persiste la minuta y reporta true con save: true', async () => {
        const addMinute = vi.fn(async (snapshot: MinuteSummarySnapshot) => ({
            id: 'm1',
            summarySnapshot: snapshot,
            createdAt: NOW,
        }));
        const { result } = renderHook(() => useMinuteHandlers(makeDeps(addMinute)));

        let saved = false;
        await act(async () => {
            saved = await result.current.handleGenerateSummary({ announce: false, save: true });
        });

        expect(saved).toBe(true);
        expect(addMinute).toHaveBeenCalledTimes(1);
    });

    it('sin save sólo deja el draft (sin persistir)', async () => {
        const addMinute = vi.fn(async (snapshot: MinuteSummarySnapshot) => ({
            id: 'm1',
            summarySnapshot: snapshot,
            createdAt: NOW,
        }));
        const { result } = renderHook(() => useMinuteHandlers(makeDeps(addMinute)));

        await act(async () => {
            await result.current.handleGenerateSummary({ announce: false });
        });

        expect(addMinute).not.toHaveBeenCalled();
    });
});
