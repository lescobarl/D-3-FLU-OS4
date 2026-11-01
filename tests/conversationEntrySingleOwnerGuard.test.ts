/**
 * conversationEntrySingleOwnerGuard — filas de sistema y FLU con UN constructor.
 *
 * Hallazgo 2026-11-01: habia entradas system inline con speakerName 'system' y
 * el evento de sistema creaba una fila FLU por `addConversationEntry`, sin
 * incrementar totalFluMessages. Ahora `addSystemMessage` y `addFluEntry` son
 * los unicos constructores; `addFluMessage` delega en `addFluEntry`.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';
import { buildSystemConversationEntry, type SystemEvent } from '../src/lib/systemEventLog';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('filas de sistema y FLU — un constructor por tipo', () => {
  it('no quedan entradas system inline', () => {
    const app = read('src/App.tsx');
    const doc = read('src/hooks/useDocumentGeneration.ts');
    expect(app).not.toContain("speakerName: 'system'");
    expect(app).not.toContain("role: 'system' as const");
    expect(doc).not.toContain("speakerName: 'system'");
    expect(doc).toContain('addSystemMessage(insumoGenerado)');
  });

  it('el evento de sistema entra por addFluEntry, no por addConversationEntry', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('const entry = buildSystemConversationEntry');
    expect(app).toContain('integrationStore.addFluEntry(entry)');
  });

  it('addFluEntry es el dueno del contador', () => {
    const store = read('src/store/integrationStore.ts');
    expect(store).toContain('addFluEntry: (entry: ConversationEntry)');
    expect(store).toContain('totalFluMessages: current.sessionStats.totalFluMessages + 1');
  });

  it('addFluEntry normaliza la fila y sube el contador', () => {
    useIntegrationStore.setState({ conversationHistory: [] });
    const before = useIntegrationStore.getState().sessionStats.totalFluMessages;
    const event: SystemEvent = {
      type: 'participant_ignored',
      timestamp: Date.now(),
      participantName: 'Hablante 1',
      waitedMs: 1000,
    };
    useIntegrationStore.getState().addFluEntry(buildSystemConversationEntry(event, 'es'));
    const state = useIntegrationStore.getState();
    const last = state.conversationHistory[state.conversationHistory.length - 1];
    expect(last.role).toBe('flu');
    expect(last.speakerName).toBe('FLU');
    expect(state.sessionStats.totalFluMessages).toBe(before + 1);
  });
});
