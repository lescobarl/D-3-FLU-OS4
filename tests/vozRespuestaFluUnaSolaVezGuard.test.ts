// @vitest-environment jsdom
// ============================================================
// vozRespuestaFluUnaSolaVezGuard - P9.82
// ------------------------------------------------------------
// DEFECTO MEDIDO (auditoria 2026-10-12, R1): `addFluMessage` (integrationStore.ts:520-554)
// guardaba la MISMA respuesta DOS veces en el MISMO store: la adjuntaba al ultimo turno
// del usuario (`response` / `meta.response`) y ADEMAS agregaba una entrada propia
// `role='flu'`. El duplicado visible lo tapaba un parche de PRESENTACION en
// ConversationLog.jsx:21-40 ("FIX duplicacion ... SIN tocar el store").
//
// CONTRATO: UN escritor por fila. La fila de FLU la escribe `logFluReply` -> la entrada
// `role='flu'`; el campo `response` del turno del usuario NO se vuelve a escribir.
// (Mismo arreglo que ya tiene `addUserMessage`, cuyo duenio es `commitUserTurnRow`.)
// Nace ROJO: hoy la respuesta viaja DOS veces.
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';

type EntryLike = { id: string; role: string; text: string; response?: string; meta?: { response?: string } };

const store = useIntegrationStore as unknown as {
  getState: () => { conversationHistory: EntryLike[]; addFluMessage: (t: string) => void };
  setState: (partial: unknown) => void;
};

const RESPUESTA = 'hola, aqui estoy';

describe('P9.82 - la respuesta de FLU se guarda UNA sola vez', () => {
  beforeEach(() => {
    store.setState({ conversationHistory: [] });
  });

  it('addFluMessage escribe la FILA de FLU y NO ademas el campo response del turno del usuario', () => {
    // Turno del usuario ya escrito por su duenio (`commitUserTurnRow`).
    store.setState({
      conversationHistory: [{ id: 'u1', role: 'user', text: 'que tal' }],
    });
    store.getState().addFluMessage(RESPUESTA);

    const hist = store.getState().conversationHistory;
    const portadores = hist.filter(
      (e) => String(e.text || '') === RESPUESTA || String(e.response || '') === RESPUESTA,
    );
    // UNA sola fila lleva la respuesta (la de FLU).
    expect(portadores).toHaveLength(1);
    expect(portadores[0].role).toBe('flu');

    const user = hist.find((e) => e.id === 'u1');
    expect(String(user?.response || '')).toBe('');
    expect(String(user?.meta?.response || '')).toBe('');
  });
});
