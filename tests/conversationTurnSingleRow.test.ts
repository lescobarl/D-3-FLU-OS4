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
import { commitUserTurnRow } from '../src/voice/conversation';
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow';

const userRows = () =>
    useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user');

describe('una locución → una fila de usuario por turno', () => {
    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory();
    });

    it('el commit temprano y el final no duplican: completan el hablante', () => {
        commitUserTurnRow({ text: 'Okay flu crea una junta de comité para hoy', turnId: 1 });
        expect(userRows()).toHaveLength(1);
        // A5: la fila del commit temprano SIEMPRE lleva etiqueta (respaldo de config); el
        // nombre visible se resuelve al MOSTRAR, por la VOZ de la fila (no vive en la fila).
        expect(resolveRowSpeakerLabel(userRows()[0])).toBe('Hablante 1');

        // Fila ambiente/sistema intercalada: NO cierra el turno.
        useIntegrationStore.getState().addConversationEntry({
            id: 'amb-1',
            role: 'system',
            text: '[stream]',
            timestamp: Date.now(),
        });

        commitUserTurnRow({ text: 'Okay flu crea una junta de comité para hoy', speakerName: 'Hablante 1', turnId: 1 });
        expect(userRows()).toHaveLength(1);
        expect(resolveRowSpeakerLabel(userRows()[0])).toBe('Hablante 1');
    });

    it('un turno nuevo (tras la respuesta de FLU) sí agrega otra fila', () => {
        commitUserTurnRow({ text: 'Okay flu pon la alarma', speakerName: 'Hablante 1', turnId: 1 });
        useIntegrationStore.getState().addConversationEntry({
            id: 'flu-1',
            role: 'flu',
            text: 'Listo.',
            timestamp: Date.now(),
        });
        commitUserTurnRow({ text: 'Okay flu pon la alarma', speakerName: 'Hablante 1', turnId: 2 });
        expect(userRows()).toHaveLength(2);
    });
});

// ============================================================
// Defecto reportado (partida activa): "Okay Flow siguiente carta" aparecía DOS
// veces en la conversación — una completa (con wake, la correcta) y otra sin la
// wake ("siguiente carta"), ambas al mismo hablante. La ejecución del comando
// era correcta; lo duplicado era la FILA.
//
// Causa raíz: el fast-path de estado (que es un EFECTO del turno, no la
// locución) reenviaba una re-derivación del texto —el texto POST-WAKE— como si
// fuera la frase del usuario. El escritor deduplica por TEXTO, así que esa
// re-derivación entraba como otra frase.
//
// Invariante: la locución del turno tiene UN solo texto (la frase canónica) y
// TODOS los puntos de commit usan ESE. Aquí se fija el contrato del escritor
// que obliga a ello.
// ============================================================
describe('una locución → una fila (el fast-path de estado no reescribe la fila)', () => {
    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory();
    });

    const LOCUCION = 'Okay Flow siguiente carta'; // frase canónica (con wake): lo que se muestra
    const RE_DERIVADA = 'siguiente carta'; // texto post-wake: NO es la locución

    it('temprano + efecto de fast-path + final = 1 fila, con la wake y con hablante', () => {
        // 1) commit temprano del turno (transcripción visible de inmediato).
        commitUserTurnRow({ text: LOCUCION, turnId: 1 });
        // 2) efecto del fast-path de estado: reenvía la MISMA locución canónica.
        commitUserTurnRow({ text: LOCUCION, speakerName: 'Hablante 1', turnId: 1 });
        // 3) commit final del turno.
        commitUserTurnRow({ text: LOCUCION, speakerName: 'Hablante 1', turnId: 1 });

        expect(userRows()).toHaveLength(1);
        expect(userRows()[0].text).toBe(LOCUCION);
        expect(resolveRowSpeakerLabel(userRows()[0])).toBe('Hablante 1');
    });

    it('el MISMO turno no abre fila aunque el fast-path reenvíe un texto derivado', () => {
        commitUserTurnRow({ text: LOCUCION, speakerName: 'Hablante 1', turnId: 1 });
        // Reenviar la re-derivación (sin wake) del MISMO turno sigue siendo la
        // misma locución: la fila se reutiliza y conserva el texto más completo.
        commitUserTurnRow({ text: RE_DERIVADA, speakerName: 'Hablante 1', turnId: 1 });

        expect(userRows()).toHaveLength(1);
        expect(userRows()[0].text).toBe(LOCUCION);
    });
});

// ============================================================
// RETIRADO (2026-10-26, feature/conversacion-modulo-nuevo): el describe del ECO
// DE LA WAKE media `resolveTurnCommitPhrase` de `turnCommitPhrase.js`, el punto
// unico de cierre de la locucion del turno de la TUBERIA VIEJA. Ese modulo quedo
// sin consumidores vivos (commit 365eeef5) y se retira con su test: la dedup del
// doble commit que el caso "commit crudo + commit del turno" tambien ejercitaba
// sigue cubierta arriba (una locucion -> una fila, MISMO turno).
// ============================================================
