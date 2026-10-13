// @vitest-environment jsdom
// ============================================================
// vozEventoSistemaMarcaGuard - P9.83
// ------------------------------------------------------------
// DEFECTO MEDIDO (auditoria 2026-10-12): la respuesta de FLU a un evento de sistema se
// filtraba al recargar con una LISTA DE LITERALES (6 textos: '[FLU recuerda]', 'Me enojé
// porque levanté la mano', ...). Cualquier reescritura de la frase rompia el filtro y el
// texto reaparecia; y el texto del evento estaba hardcodeado en 3 sitios (App forzando el
// tema del turno siguiente, systemEventLog y el filtro).
//
// CONTRATO: el evento se reconoce por su MARCA (`meta.systemEvent`), y su RESPUESTA por
// `meta.systemEventReply`, que pone el escritor unico (`logFluReply`). Cero listas de
// literales. Nace ROJO: hoy la respuesta no lleva marca.
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';
import { logFluReply } from '../src/voice/lib/fluConversationLog';

type EntryLike = { role: string; text: string; meta?: { systemEvent?: unknown; systemEventReply?: boolean } };
const store = useIntegrationStore as unknown as {
  getState: () => { conversationHistory: EntryLike[] };
  setState: (partial: unknown) => void;
};

describe('P9.83 - la respuesta a un evento de sistema se marca ESTRUCTURALMENTE', () => {
  beforeEach(() => store.setState({ conversationHistory: [] }));

  it('si el ultimo turno es un evento de sistema, su respuesta queda marcada', () => {
    store.setState({
      conversationHistory: [
        {
          role: 'system',
          text: '[FLU recuerda] Me enojé porque levanté la mano...',
          meta: { systemEvent: { type: 'participant_ignored' } },
        },
      ],
    });
    logFluReply('Me siento enojado porque el hablante levanto la mano...');
    const flu = store.getState().conversationHistory.find((e) => e.role === 'flu');
    expect(flu?.meta?.systemEventReply).toBe(true);
  });

  it('una respuesta normal NO se marca', () => {
    store.setState({ conversationHistory: [{ role: 'user', text: 'hola' }] });
    logFluReply('hola, aqui estoy');
    const flu = store.getState().conversationHistory.find((e) => e.role === 'flu');
    expect(flu?.meta?.systemEventReply).toBeUndefined();
  });
});
