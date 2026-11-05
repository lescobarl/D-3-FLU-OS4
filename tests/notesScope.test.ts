// ============================================================
// notesScope.test.ts — Guard de aislamiento de notas por usuario
// ------------------------------------------------------------
// Invariante: un usuario NO ve las notas de otro. Notas sin personId
// pertenecen al alcance 'global' (legacy).
// ============================================================
import { describe, expect, it } from 'vitest';
import { filterNotesByScope } from '../src/core/notes/notesList';

const note = (id: string, personId?: string) => ({
    id,
    label: id,
    done: false,
    personId,
    createdAt: 0,
    updatedAt: 0,
    sync: { revision: 1, updated_at: '', deleted: false },
});

describe('filterNotesByScope — aislamiento por usuario', () => {
    it('solo devuelve las notas del usuario', () => {
        const items = [note('a', 'user-a'), note('b', 'user-b'), note('c', 'user-a')];
        expect(filterNotesByScope(items, 'user-a').map((n) => n.id)).toEqual(['a', 'c']);
        expect(filterNotesByScope(items, 'user-b').map((n) => n.id)).toEqual(['b']);
    });

    it('las notas sin personId quedan en "global"', () => {
        const items = [note('legacy'), note('a', 'user-a')];
        expect(filterNotesByScope(items, undefined).map((n) => n.id)).toEqual(['legacy']);
        expect(filterNotesByScope(items, 'user-a').map((n) => n.id)).toEqual(['a']);
    });

    it('un usuario no ve las de otro (intersección vacía)', () => {
        const items = [note('a', 'user-a'), note('b', 'user-b')];
        const a = filterNotesByScope(items, 'user-a');
        const b = filterNotesByScope(items, 'user-b');
        expect(a.some((n) => b.includes(n))).toBe(false);
    });
});
