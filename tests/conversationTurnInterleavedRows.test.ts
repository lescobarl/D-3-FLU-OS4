// ============================================================
// Guard — una locución ⇒ UNA fila de usuario aunque intercalen filas ambiente
// ------------------------------------------------------------
// Caso reportado: la misma frase aparecía 2-3 veces (con y sin hablante).
// El escritor único (`commitUserTurnRow`) debe reutilizar la fila del turno
// aunque entre medias se registren filas de sistema/stream (no cierran turno).
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow';

const userRows = () =>
    useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user');

describe('conversación — filas intercaladas no duplican al usuario', () => {
    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory();
    });

    it('commit temprano + fila sistema + commit final = 1 fila de usuario con hablante', () => {
        commitUserTurnRow({ text: 'ok flu platícame de los aviones' });
        useIntegrationStore.getState().addConversationEntry({
            id: 'sys-1',
            role: 'system',
            text: '[stream]',
            timestamp: Date.now(),
        });
        commitUserTurnRow({ text: 'ok flu platícame de los aviones', speakerName: 'Hablante 1' });

        const rows = userRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].speakerName).toBe('Hablante 1');
    });
});
