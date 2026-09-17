// ============================================================
// workspacePersonIsolation.test.ts — Guard de comportamiento
// ------------------------------------------------------------
// Aislamiento multiusuario del Pizarrón (historial): cada entrada de
// conversationHistory queda sellada con el personId del participante
// activo, para poder filtrar/fijar la bitácora por usuario.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';

describe('aislamiento multiusuario del historial del Pizarrón', () => {
    beforeEach(() => {
        useIntegrationStore.getState().reset();
    });

    it('sella las entradas del historial con el personId del participante activo', () => {
        useIntegrationStore.getState().setActivePersonId('alice');
        useIntegrationStore.getState().addUserMessage('hola', 'Alice');
        useIntegrationStore.getState().addFluMessage('¡Hola!');

        const history = useIntegrationStore.getState().conversationHistory;
        expect(history).toHaveLength(2);
        expect(history[0].personId).toBe('alice');
        expect(history[1].personId).toBe('alice');
    });

    it('una entrada sin participante activo no queda sellada (ruta legacy)', () => {
        useIntegrationStore.getState().addUserMessage('hola legacy');

        const history = useIntegrationStore.getState().conversationHistory;
        expect(history).toHaveLength(1);
        expect(history[0].personId).toBeUndefined();
    });

    it('cada participante sella SUS propias entradas (no se mezclan)', () => {
        useIntegrationStore.getState().setActivePersonId('alice');
        useIntegrationStore.getState().addUserMessage('de alice', 'Alice');

        useIntegrationStore.getState().setActivePersonId('bob');
        useIntegrationStore.getState().addUserMessage('de bob', 'Bob');

        const history = useIntegrationStore.getState().conversationHistory;
        const aliceRows = history.filter((e) => e.personId === 'alice');
        const bobRows = history.filter((e) => e.personId === 'bob');
        expect(aliceRows).toHaveLength(1);
        expect(bobRows).toHaveLength(1);
        expect(aliceRows[0].text).toBe('de alice');
        expect(bobRows[0].text).toBe('de bob');
    });
});
