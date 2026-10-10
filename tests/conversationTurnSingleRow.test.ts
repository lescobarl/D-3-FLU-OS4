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
        commitUserTurnRow({ text: 'Okay flu crea una junta de comité para hoy', turnId: 1 });
        expect(userRows()).toHaveLength(1);
        // A5: la fila del commit temprano SIEMPRE lleva etiqueta (respaldo de config).
        expect(userRows()[0].speakerName).toBe('Hablante 1');

        // Fila ambiente/sistema intercalada: NO cierra el turno.
        useIntegrationStore.getState().addConversationEntry({
            id: 'amb-1',
            role: 'system',
            text: '[stream]',
            timestamp: Date.now(),
        });

        commitUserTurnRow({ text: 'Okay flu crea una junta de comité para hoy', speakerName: 'Hablante 1', turnId: 1 });
        expect(userRows()).toHaveLength(1);
        expect(userRows()[0].speakerName).toBe('Hablante 1');
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
        expect(userRows()[0].speakerName).toBe('Hablante 1');
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
// Eco de la wake ("ok flu ok flu siguiente carta"): la locucion canonica
// conserva UNA wake, no es basura para el guard anti-alucinacion (la repeticion
// de la wake es eco, no tartamudeo) y por tanto TODOS los commits del turno
// llevan el MISMO texto -> una sola fila. Antes: el eco hacia que la frase del
// turno cayera al texto post-wake y la conversacion mostraba dos filas, una sin
// el "ok flu".
// ============================================================
import { resolveTurnCommitPhrase } from '../src/voice/lib/turnCommitPhrase.js';

describe('eco de la wake: una sola locucion (con wake) y una sola fila', () => {
    const ECO = 'ok flu ok flu siguiente carta'; // captura cruda del ASR (eco)
    const POST_WAKE = 'siguiente carta'; // texto validado post-wake (query)

    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory();
    });

    it('la captura con eco se canoniza a UNA wake y NO se marca como basura', () => {
        const phrase = resolveTurnCommitPhrase({ capture: ECO, fallback: POST_WAKE });
        expect(phrase).toBe('ok flu siguiente carta');
    });

    it('commit crudo + commit del turno = 1 fila con la wake', () => {
        // 1) commit de la emision cruda (eco incluido).
        commitUserTurnRow({ text: resolveTurnCommitPhrase({ capture: ECO }), turnId: 1 });
        // 2) commit temprano/final del turno: misma frase canonica + respaldo.
        commitUserTurnRow({
            text: resolveTurnCommitPhrase({ capture: ECO, fallback: POST_WAKE }),
            speakerName: 'Hablante 1',
            turnId: 1,
        });

        const rows = userRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toBe('ok flu siguiente carta');
        expect(rows[0].speakerName).toBe('Hablante 1');
    });

    it('una locucion sin eco no cambia (no se rompe lo validado)', () => {
        expect(resolveTurnCommitPhrase({ capture: 'okay flow crea una cita' })).toBe(
            'okay flow crea una cita',
        );
        expect(resolveTurnCommitPhrase({ capture: 'siguiente carta' })).toBe('siguiente carta');
        // Wake INLINE (prefijo pasivo delante): el recorte no aplica, no se toca.
        expect(resolveTurnCommitPhrase({ capture: 'hay una noticia ok flu siguiente carta' })).toBe(
            'hay una noticia ok flu siguiente carta',
        );
    });

    it('el eco se consume aunque la wake se repita mas de dos veces', () => {
        expect(resolveTurnCommitPhrase({ capture: 'ok flu ok flu ok flu pon una alarma' })).toBe(
            'ok flu pon una alarma',
        );
        expect(resolveTurnCommitPhrase({ capture: 'oye flu oye flu' })).toBe('oye flu');
    });
});
