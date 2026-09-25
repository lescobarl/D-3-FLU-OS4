// ============================================================
// Guard — FLU deja rastro en la conversación (es un participante)
// ------------------------------------------------------------
// Causa raíz: la fila de FLU se escribía en una sola ruta y estaba excluida
// para juegos/fast-path → FLU hablaba sin quedar en el historial y la IA
// perdía el contexto. Ahora TODO lo hablado pasa por `logFluReply`.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useIntegrationStore } from '../src/store/integrationStore';
import { logFluReply } from '../src/voice/lib/fluConversationLog';

const fluRows = () =>
    useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'flu');

describe('fluConversationLog — hablar deja fila en el historial', () => {
    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory();
    });

    it('registra la intervención de FLU una sola vez', () => {
        logFluReply('El gallo cantó en el corral.');
        expect(fluRows()).toHaveLength(1);
        expect(fluRows()[0].text).toBe('El gallo cantó en el corral.');
        expect(fluRows()[0].speakerName).toBe('FLU');
    });

    it('no duplica si la última fila ya es el mismo texto', () => {
        logFluReply('¿La tienes?');
        logFluReply('¿La tienes?');
        expect(fluRows()).toHaveLength(1);
    });

    it('un texto repetido tras una fila del usuario SÍ se registra', () => {
        logFluReply('¿La tienes?');
        useIntegrationStore.getState().addUserMessage('no la tengo', 'Hablante 1');
        logFluReply('¿La tienes?');
        expect(fluRows()).toHaveLength(2);
    });

    it('texto vacío no crea fila', () => {
        logFluReply('   ');
        logFluReply('');
        expect(fluRows()).toHaveLength(0);
    });
});

describe('fluConversationLog — un solo escritor de la fila de FLU', () => {
    it('App.tsx no llama addFluMessage directo', () => {
        const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
        const calls = source.match(/addFluMessage\(/g) || [];
        expect(calls).toEqual([]);
    });
});
