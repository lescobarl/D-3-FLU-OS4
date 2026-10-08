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
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow';
import { detectSentiment } from '../src/store/integrationStore';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';

let __seedTurn = 0;
/** Siembra una fila de usuario por el DUENO unico de la fila (una sola fila). */
const addUserRow = (text: string, speakerName?: string) => {
    const speaker = speakerName || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker;
    commitUserTurnRow({
        text,
        speakerName: speaker,
        sentiment: detectSentiment(text),
        turnId: `seed-${++__seedTurn}`,
    });
};

/** Llamadas directas a addFluMessage en un fuente (mismo criterio del guard). */
export function addFluMessageCalls(src: string): string[] {
    return src.match(/addFluMessage\(/g) || [];
}

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
        addUserRow('no la tengo', 'Hablante 1');
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
        expect(addFluMessageCalls(readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8'))).toEqual([]);
    });
});

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('fluConversationLog - el detector no es decorativo', () => {
    it('marca la escritura directa de la fila y no el escritor unico', () => {
        expect(addFluMessageCalls('addFluMessage(text)')).toHaveLength(1)
        expect(addFluMessageCalls('logFluReply(text)')).toEqual([])
    })
})