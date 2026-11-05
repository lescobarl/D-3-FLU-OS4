/**
 * participantDeleteSingleOwnerGuard — un solo barrido para borrar las filas de
 * un participante. Antes habia 3 (indice speakerId, resolveRowSpeakerLabel y un
 * barrido completo en fluStorage con otro criterio). El tercero era no-op por
 * orden, pero era un segundo dueno y borraba conversaciones bajo un nombre que
 * prometia audit logs.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const sweepCount = (source: string) => source.split('softDeleteConversationRows(').length - 1;

describe('borrado de participante — un solo barrido', () => {
  it('App.tsx hace UN barrido y ya no llama al borrado de fluStorage', () => {
    const app = read('src/App.tsx');
    expect(sweepCount(app)).toBe(1);
    expect(app).not.toContain('deleteAuditLogsBySpeaker');
  });

  it('fluStorage ya no borra conversaciones ni exporta el barrido duplicado', () => {
    const storage = read('src/voice/lib/fluStorage.js');
    const facade = read('src/voice/api/storage.ts');
    expect(storage).not.toContain('deleteAuditLogsBySpeaker');
    expect(storage).not.toContain('putConversationRecord');
    expect(facade).not.toContain('deleteAuditLogsBySpeaker');
  });

  it('el contador no es decorativo', () => {
    expect(sweepCount('softDeleteConversationRows(a); softDeleteConversationRows(b);')).toBe(2);
    expect(sweepCount('softDeleteConversationRows(a);')).toBe(1);
  });
});
