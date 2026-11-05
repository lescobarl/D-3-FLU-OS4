// @vitest-environment jsdom
// ============================================================
// conversationLiveNotWiped — la persistencia NO borra la conversación en vivo
// ------------------------------------------------------------
// Bug real: al decir "hola hola soy luis" la fila se BORRABA y se reiniciaba la
// conversación. Causa: `useConversationPersistence` hacía `batchLoadHistory([])`
// cuando no había usuario real (transitorio en onboarding) y al cambiar de scope.
// Invariante: hacia/desde "sin usuario" NO se toca lo que está en pantalla; solo
// se vacía al cambiar entre DOS usuarios reales distintos (aislamiento).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const { convMock } = vi.hoisted(() => {
    const rows: unknown[] = [];
    return {
        convMock: {
            toArray: async () => rows.slice(),
            bulkPut: async (r: unknown[]) => {
                rows.push(...r);
            },
            bulkDelete: async () => undefined,
            __reset: () => {
                rows.length = 0;
            },
        },
    };
});

vi.mock('../src/core/db/fluDatabase', async () => {
    const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>(
        '../src/core/db/fluDatabase',
    );
    return { ...actual, fluDb: { conversations: convMock } };
});

import { useConversationPersistence } from '../src/hooks/useConversationPersistence';
import { useIntegrationStore } from '../src/store/integrationStore';

const liveRow = {
    id: 'live-1',
    role: 'user',
    text: 'hola hola soy luis',
    timestamp: 1,
    sentiment: 'neutral',
} as never;

beforeEach(() => {
    convMock.__reset();
    useIntegrationStore.setState({ conversationHistory: [] });
});

describe('persistencia de conversación — no borra lo vivo', () => {
    it('sin usuario real NO vacía el historial en pantalla', async () => {
        useIntegrationStore.setState({ conversationHistory: [liveRow] });
        renderHook(() => useConversationPersistence(undefined));
        await waitFor(() => expect(useIntegrationStore.getState().conversationHistory.length).toBe(1));
    });

    it('con usuario real y store con contenido, TAMPOCO lo pisa', async () => {
        useIntegrationStore.setState({ conversationHistory: [liveRow] });
        renderHook(() => useConversationPersistence('user-a'));
        await waitFor(() => expect(useIntegrationStore.getState().conversationHistory.length).toBe(1));
    });

    it('cambiar entre DOS usuarios reales SÍ vacía (aislamiento)', async () => {
        const { rerender } = renderHook(({ id }: { id: string }) => useConversationPersistence(id), {
            initialProps: { id: 'user-a' },
        });
        await act(async () => {
            useIntegrationStore.setState({ conversationHistory: [liveRow] });
        });
        await act(async () => {
            rerender({ id: 'user-b' });
        });
        await waitFor(() => expect(useIntegrationStore.getState().conversationHistory.length).toBe(0));
    });
});
