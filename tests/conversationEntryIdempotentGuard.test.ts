/**
 * conversationEntryIdempotentGuard — una locucion = UNA entrada en el store.
 *
 * Hallazgo 2026-11-01: `addConversationEntry` hacia append siempre. Como
 * `row.committed` puede repetirse al promover la MISMA locucion, la fila
 * aparecia duplicada en la conversacion. El id es el `locutionId`: misma fila
 * => reemplazo en su sitio; id nuevo => append.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';
import type { ConversationEntry } from '../src/types/bridge';

const entry = (id: string, speakerName: string, text = 'hola'): ConversationEntry => ({
  id,
  role: 'user',
  text,
  timestamp: 1000,
  speakerName,
});

describe('conversacion — una entrada por locutionId', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] });
  });

  it('el mismo id reemplaza, no duplica', () => {
    const store = useIntegrationStore.getState();
    store.addConversationEntry(entry('loc-1', 'Hablante 1'));
    store.addConversationEntry(entry('loc-1', 'Luis'));
    const history = useIntegrationStore.getState().conversationHistory;
    expect(history).toHaveLength(1);
    expect(history[0]!.speakerName).toBe('Luis');
  });

  it('ids distintos se anaden', () => {
    const store = useIntegrationStore.getState();
    store.addConversationEntry(entry('loc-1', 'Hablante 1'));
    store.addConversationEntry(entry('loc-2', 'Hablante 2'));
    expect(useIntegrationStore.getState().conversationHistory).toHaveLength(2);
  });

  it('el store implementa la idempotencia por id (no es un append ciego)', () => {
    const src = readFileSync(join(process.cwd(), 'src/store/integrationStore.ts'), 'utf8');
    expect(src).toContain('findIndex((e) => e.id === conEpoch.id)');
  });
});
