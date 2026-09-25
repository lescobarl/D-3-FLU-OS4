// @vitest-environment jsdom
// ============================================================
// notesClearEndToEnd — INYECCIÓN end-to-end del turno de voz a notas:
// frase real → árbitro determinista real → despacho (mismo mapeo que
// App.tsx:3676) → hook real useNotes → notesService real → DB.
// ------------------------------------------------------------
// Cierra el tramo que antes solo estaba validado por lectura:
// «Okay flu bor Borra las notas» debe VACIAR las notas y refrescar la
// lista, sin tocar las de otro usuario.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { NoteRecord } from '../src/core/db/fluDatabase';

const { notesMock } = vi.hoisted(() => {
  type Rec = NoteRecord;
  let map = new Map<string, Rec>();
  const clone = (r: Rec): Rec => ({ ...r, sync: { ...r.sync } });
  return {
    notesMock: {
      async add(record: Rec) {
        map.set(record.id, clone(record));
        return record.id;
      },
      async put(record: Rec) {
        map.set(record.id, clone(record));
        return record.id;
      },
      async bulkPut(records: Rec[]) {
        for (const record of records) map.set(record.id, clone(record));
        return undefined;
      },
      async delete(id: string) {
        map.delete(id);
      },
      async get(id: string) {
        const row = map.get(id);
        return row ? clone(row) : undefined;
      },
      async toArray() {
        return Array.from(map.values()).map(clone);
      },
      __reset() {
        map = new Map<string, Rec>();
      },
      __seed(records: Rec[]) {
        for (const record of records) map.set(record.id, clone(record));
      },
      __all() {
        return Array.from(map.values()).map(clone);
      },
    },
  };
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
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';

const NOW = new Date(2026, 8, 18, 10, 0, 0, 0).getTime();

function note(id: string, personId: string): NoteRecord {
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

/** Mismo despacho que App.tsx (3676/3687): acción del árbitro → método del hook. */
async function dispatch(
  text: string,
  notes: ReturnType<typeof useNotes>,
): Promise<{ action: string | null; count: number }> {
  const resolved = resolveDeterministicCommand(text, { language: 'es' }) as {
    matched?: boolean;
    action?: { action?: string; data?: { target?: string } };
  } | null;
  if (!resolved?.matched || !resolved.action?.action) return { action: null, count: 0 };
  const action = resolved.action.action;
  if (action === 'notes.clear') return { action, count: await notes.clearAll() };
  if (action === 'notes.remove') {
    return { action, count: await notes.removeByTarget(String(resolved.action.data?.target || '')) };
  }
  return { action, count: 0 };
}

beforeEach(() => {
  notesMock.__reset();
});

describe('notes — inyección end-to-end del turno de voz', () => {
  it('«Okay flu bor Borra las notas» vacía las notas del usuario y refresca la lista', async () => {
    notesMock.__seed([note('a1', 'user-a'), note('a2', 'user-a'), note('b1', 'user-b')]);
    const { result } = renderHook(() => useNotes({ participantId: 'user-a' }));
    await waitFor(() => expect(result.current.notes).toHaveLength(2));

    let outcome: { action: string | null; count: number } | undefined;
    await act(async () => {
      outcome = await dispatch('Okay flu bor Borra las notas', result.current);
    });

    expect(outcome?.action).toBe('notes.clear');
    expect(outcome?.count).toBe(2);
    await waitFor(() => expect(result.current.notes).toHaveLength(0));

    const rows = notesMock.__all();
    expect(rows.filter((r) => r.personId === 'user-a').every((r) => r.sync.deleted)).toBe(true);
    expect(rows.filter((r) => r.personId === 'user-b').every((r) => !r.sync.deleted)).toBe(true);
  });

  it('«Borra las notas» (plural, sin «todas») también vacía', async () => {
    notesMock.__seed([note('a1', 'user-a')]);
    const { result } = renderHook(() => useNotes({ participantId: 'user-a' }));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    await act(async () => {
      await dispatch('Borra las notas', result.current);
    });
    await waitFor(() => expect(result.current.notes).toHaveLength(0));
  });

  it('«borra la nota» (singular, sin destino) NO vacía por error', async () => {
    notesMock.__seed([note('a1', 'user-a'), note('a2', 'user-a')]);
    const { result } = renderHook(() => useNotes({ participantId: 'user-a' }));
    await waitFor(() => expect(result.current.notes).toHaveLength(2));

    let outcome: { action: string | null; count: number } | undefined;
    await act(async () => {
      outcome = await dispatch('borra la nota', result.current);
    });
    expect(outcome?.action).toBeNull();
    expect(result.current.notes).toHaveLength(2);
  });
});
