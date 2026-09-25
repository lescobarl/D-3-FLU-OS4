// ============================================================
// Guard — una locución ⇒ UNA fila de usuario por turno
// ------------------------------------------------------------
// Causa raíz (caso 9, duplicado sin hablante): la fila del usuario se
// escribe dos veces (commit temprano sin hablante + commit final con
// hablante) y la deduplicación solo miraba la ÚLTIMA fila. Este guard
// falla mientras no exista un ÚNICO commit de fila de turno que
// reutilice la fila existente y complete su hablante.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow';

const userRows = () =>
    useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user');

describe('una locución → una fila de usuario por turno', () => {
    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory();
    });

    it('el commit temprano y el final no duplican: completan el hablante', () => {
        commitUserTurnRow({ text: 'Okay flu crea una junta de comité para hoy' });
        expect(userRows()).toHaveLength(1);
        expect(userRows()[0].speakerName).toBeUndefined();

        // Fila ambiente/sistema intercalada: NO cierra el turno.
        useIntegrationStore.getState().addConversationEntry({
            id: 'amb-1',
            role: 'system',
            text: '[stream]',
            timestamp: Date.now(),
        });

        commitUserTurnRow({ text: 'Okay flu crea una junta de comité para hoy', speakerName: 'Hablante 1' });
        expect(userRows()).toHaveLength(1);
        expect(userRows()[0].speakerName).toBe('Hablante 1');
    });

    it('un turno nuevo (tras la respuesta de FLU) sí agrega otra fila', () => {
        commitUserTurnRow({ text: 'Okay flu pon la alarma', speakerName: 'Hablante 1' });
        useIntegrationStore.getState().addConversationEntry({
            id: 'flu-1',
            role: 'flu',
            text: 'Listo.',
            timestamp: Date.now(),
        });
        commitUserTurnRow({ text: 'Okay flu pon la alarma', speakerName: 'Hablante 1' });
        expect(userRows()).toHaveLength(2);
    });
});
