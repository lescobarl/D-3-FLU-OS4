// @vitest-environment jsdom
// ============================================================
// notesUserScope — las notas son POR USUARIO: sin usuario real no hay
// alcance (nada de 'global/legacy') y no se crean notas sueltas.
// ------------------------------------------------------------
// Bug real: durante el onboarding (id centinela 'default') aparecían las
// notas del DEMO. Además `addMany` no aplicaba scope (creaba notas 'global').
// Guard de COMPORTAMIENTO sobre el hook real `useNotes`.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { NoteRecord } from '../src/core/db/fluDatabase';

const { notesMock } = vi.hoisted(() => {
  type Rec = NoteRecord;
  let map = new Map<string, Rec>();
  const clone = (r: Rec): Rec => ({ ...r, sync: { ...r.sync } });
  const table = {
    async add(record: Rec): Promise<unknown> {
      map.set(record.id, clone(record));
      return record.id;
    },
    async put(record: Rec): Promise<unknown> {
      map.set(record.id, clone(record));
      return record.id;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<Rec | undefined> {
      const row = map.get(id);
      return row ? clone(row) : undefined;
    },
    async toArray(): Promise<Rec[]> {
      return Array.from(map.values()).map(clone);
    },
    __reset(): void {
      map = new Map<string, Rec>();
    },
    __seed(records: Rec[]): void {
      for (const record of records) map.set(record.id, clone(record));
    },
    __all(): Rec[] {
      return Array.from(map.values()).map(clone);
    },
  };
  return { notesMock: table };
});

vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>(
    '../src/core/db/fluDatabase',
  );
  return {
    ...actual,
    addAuditLog: vi.fn(async () => undefined as never),
    fluDb: { notes: notesMock },
  };
});

import { useNotes } from '../src/hooks/useNotes';

const NOW = new Date(2026, 8, 17, 10, 0, 0, 0).getTime();

function note(id: string, personId?: string): NoteRecord {
  return {
    id,
    label: id,
    done: false,
    personId,
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: '', deleted: false },
  };
}

beforeEach(() => {
  notesMock.__reset();
});

describe('useNotes — alcance por usuario', () => {
    it('sin usuario real NO muestra notas (ni globales ni del centinela)', async () => {
        notesMock.__seed([note('legacy'), note('default-note', 'default'), note('a', 'user-a')]);
        const { result } = renderHook(() => useNotes({ participantId: undefined }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.notes).toHaveLength(0);
    });

    it('con usuario real muestra SOLO las suyas', async () => {
        notesMock.__seed([note('legacy'), note('default-note', 'default'), note('a', 'user-a'), note('a2', 'user-a')]);
        const { result } = renderHook(() => useNotes({ participantId: 'user-a' }));
        await waitFor(() => expect(result.current.notes).toHaveLength(2));
        expect(result.current.notes.every((n) => n.personId === 'user-a')).toBe(true);
    });

    it('sin usuario real add NO crea nota (no deja filas globales)', async () => {
        const { result } = renderHook(() => useNotes({ participantId: undefined }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        let res: { ok: boolean } | undefined;
        await act(async () => {
            res = await result.current.add({ label: 'suelta' });
        });
        expect(res?.ok).toBe(false);
        expect(notesMock.__all()).toHaveLength(0);
    });

    it('addMany con usuario real escopa cada nota al usuario', async () => {
        const { result } = renderHook(() => useNotes({ participantId: 'user-a' }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => {
            await result.current.addMany(['uno', 'dos']);
        });
        const all = notesMock.__all();
        expect(all).toHaveLength(2);
        expect(all.every((n) => n.personId === 'user-a')).toBe(true);
    });
});
