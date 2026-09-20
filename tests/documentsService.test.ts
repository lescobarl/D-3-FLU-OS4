// ============================================================
// documentsService.test.ts — Guard del historial de documentos
// ------------------------------------------------------------
// Invariante: cada documento se sella con el usuario y `list` filtra por
// alcance (un usuario no ve los de otro). Sin título/formato no se agrega.
// ============================================================
import { describe, expect, it } from 'vitest';
import { createDocumentsService } from '../src/core/documents/documentsService';
import type { DocumentRecord } from '../src/core/db/fluDatabase';

function makeDb() {
    const map = new Map<string, DocumentRecord>();
    return {
        add: async (record: DocumentRecord) => {
            map.set(record.id, record);
        },
        toArray: async () => Array.from(map.values()),
        get: async (id: string) => map.get(id),
        put: async (record: DocumentRecord) => {
            map.set(record.id, record);
        },
        delete: async (id: string) => {
            map.delete(id);
        },
    };
}

describe('documentsService — historial por usuario', () => {
    it('agrega y lista solo el alcance del usuario', async () => {
        const service = createDocumentsService({ db: makeDb(), now: () => 1000 });
        await service.add({ kind: 'generated', formato: 'video', titulo: 'Perro', personId: 'user-a' });
        await service.add({ kind: 'uploaded', formato: 'pdf', titulo: 'Tarea', personId: 'user-b' });
        const a = await service.list('user-a');
        expect(a.map((d) => d.titulo)).toEqual(['Perro']);
        expect((await service.list('user-b')).map((d) => d.titulo)).toEqual(['Tarea']);
    });

    it('sin título o sin formato no agrega', async () => {
        const service = createDocumentsService({ db: makeDb() });
        expect(await service.add({ kind: 'generated', formato: '', titulo: 'x' })).toBeNull();
        expect(await service.add({ kind: 'generated', formato: 'pdf', titulo: '   ' })).toBeNull();
    });

    it('remove elimina el documento', async () => {
        const service = createDocumentsService({ db: makeDb() });
        const record = await service.add({
            kind: 'uploaded',
            formato: 'txt',
            titulo: 'A',
            personId: 'user-a',
        });
        expect(await service.remove(record!.id)).toBe(true);
        expect(await service.list('user-a')).toHaveLength(0);
    });
});
