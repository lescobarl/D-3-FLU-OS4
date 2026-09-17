// @vitest-environment jsdom
// ============================================================
// conversationTurnRowSingleWriter — UN solo escritor de la fila del usuario
// ------------------------------------------------------------
// Invariante §9: una frase hablada ⇒ UNA fila visible.
// El guard EJECUTA la secuencia real (commit temprano → emisión cruda → commit
// final) sobre el ÚNICO escritor `commitUserTurnRow` y exige 1 fila; y que una
// emisión que crece reemplace en lugar de duplicar.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow';
import { useIntegrationStore } from '../src/store/integrationStore';

const FRASE = 'okay flow crea una cita';

function history() {
    return useIntegrationStore.getState().conversationHistory;
}

beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [], activePersonId: undefined });
});

describe('commitUserTurnRow — un solo escritor de la fila del usuario', () => {
    it('temprano → cruda → final deja UNA sola fila', () => {
        commitUserTurnRow({ text: FRASE });                       // commit temprano
        commitUserTurnRow({ text: FRASE, speakerName: 'Hablante 1' }); // emisión cruda
        commitUserTurnRow({ text: FRASE, speakerName: 'Hablante 1' }); // commit final
        const rows = history().filter((e) => e.role === 'user');
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toBe(FRASE);
    });

    it('emisión que crece REEMPLAZA la fila (1 fila con el texto final)', () => {
        commitUserTurnRow({ text: 'okay flow', speakerName: 'Hablante 1', replaceLast: true });
        commitUserTurnRow({ text: FRASE, speakerName: 'Hablante 1', replaceLast: true });
        const rows = history().filter((e) => e.role === 'user');
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toBe(FRASE);
    });

    it('el commit final completa el hablante sin agregar fila', () => {
        commitUserTurnRow({ text: FRASE });                              // sin hablante
        commitUserTurnRow({ text: FRASE, speakerName: 'Luis' });         // completa
        const rows = history().filter((e) => e.role === 'user');
        expect(rows).toHaveLength(1);
        expect(rows[0].speakerName).toBe('Luis');
    });

    it('tras la respuesta de FLU, la misma frase es fila NUEVA (turno distinto)', () => {
        commitUserTurnRow({ text: FRASE, speakerName: 'Luis' });
        useIntegrationStore.getState().addConversationEntry({
            id: 'flu-1', role: 'flu', text: 'Listo', timestamp: Date.now(), sentiment: 'neutral',
        });
        commitUserTurnRow({ text: FRASE, speakerName: 'Luis' });
        expect(history().filter((e) => e.role === 'user')).toHaveLength(2);
    });

    it('frases distintas en el mismo turno son filas distintas', () => {
        commitUserTurnRow({ text: FRASE, speakerName: 'Luis' });
        commitUserTurnRow({ text: 'okay flow pon una alarma', speakerName: 'Luis' });
        expect(history().filter((e) => e.role === 'user')).toHaveLength(2);
    });

    it('texto vacío no escribe nada', () => {
        commitUserTurnRow({ text: '   ' });
        expect(history()).toHaveLength(0);
    });
});

describe('unificación — un solo escritor de la fila del usuario', () => {
    const appSource = () => readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

    it('App YA NO tiene su propio plan/dedup de fila cruda (rawCommitPlan eliminado)', () => {
        expect(appSource().includes('planRawCommit')).toBe(false);
        expect(existsSync(join(process.cwd(), 'src', 'voice', 'lib', 'rawCommitPlan.js'))).toBe(false);
    });

    it('App delega la fila del usuario en commitUserTurnRow (temprano + cruda + final)', () => {
        const calls = appSource().match(/commitUserTurnRow\(/g) || [];
        expect(calls.length).toBeGreaterThanOrEqual(3);
    });
});
