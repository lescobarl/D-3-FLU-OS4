// ============================================================
// conversationHistoryCap.test.ts — Guard del tope de historial
// ------------------------------------------------------------
// Invariante: el historial de conversación no crece sin límite; se recorta
// a UI_DEFAULTS.CONVERSATION_HISTORY_LIMIT (antes crecía indefinidamente y
// cada backup lo duplicaba, llenando localStorage).
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';
import { UI_DEFAULTS } from '../src/core/config/appConfig';
import type { ConversationEntry } from '../src/types/bridge';

function entry(index: number): ConversationEntry {
    return {
        role: index % 2 === 0 ? 'user' : 'flu',
        text: `mensaje ${index}`,
        timestamp: index,
        id: `e${index}`,
    };
}

describe('integrationStore — tope de historial de conversación', () => {
    beforeEach(() => {
        useIntegrationStore.getState().clearHistory();
    });

    it('recorta al límite configurado y conserva los últimos', () => {
        const limit = UI_DEFAULTS.CONVERSATION_HISTORY_LIMIT;
        const store = useIntegrationStore.getState();
        for (let i = 0; i < limit + 25; i++) store.addConversationEntry(entry(i));

        const history = useIntegrationStore.getState().conversationHistory;
        expect(history).toHaveLength(limit);
        expect(history[0].id).toBe(`e25`);
        expect(history[history.length - 1].id).toBe(`e${limit + 24}`);
    });

    it('batchLoadHistory también respeta el tope', () => {
        const limit = UI_DEFAULTS.CONVERSATION_HISTORY_LIMIT;
        const many = Array.from({ length: limit + 10 }, (_, i) => entry(i));
        useIntegrationStore.getState().batchLoadHistory(many);
        expect(useIntegrationStore.getState().conversationHistory).toHaveLength(limit);
    });
});
