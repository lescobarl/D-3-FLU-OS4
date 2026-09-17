// ============================================================
// noteRemoveIntent.test.ts — Guard de COMPORTAMIENTO (caso 10)
// ------------------------------------------------------------
// "borra la nota X" ⇒ 1 nota `deleted` (borrado lógico) y 0
// llamadas a IA. Ejecuta el flujo completo: parser → árbitro
// determinista → match por destino → softRemove (sync.deleted).
// Nace ROJO mientras no exista `notes.remove` en el árbitro.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { parseNoteRemoveIntentText } from '../src/voice/lib/noteIntentParser';
import { matchNotesByTarget } from '../src/core/notes/notesList';
import { createNotesService, type NotesDb } from '../src/core/notes/notesService';
import { addAuditLog, type NoteRecord } from '../src/core/db/fluDatabase';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría.
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

let idCounter = 0;

function createMapDb(initial: NoteRecord[] = []): NotesDb {
  const map = new Map<string, NoteRecord>();
  for (const r of initial) map.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: NoteRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: NoteRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async bulkPut(records: NoteRecord[]): Promise<unknown> {
      for (const record of records) {
        map.set(record.id, { ...record, sync: { ...record.sync } });
      }
      return undefined;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<NoteRecord | undefined> {
      const row = map.get(id);
      return row ? { ...row, sync: { ...row.sync } } : undefined;
    },
    async toArray(): Promise<NoteRecord[]> {
      return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

function makeNote(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: 'note-1',
    label: 'comprar leche',
    done: false,
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

describe('caso 10 — "borra la nota X" es determinista (notes.remove)', () => {
  it('el árbitro reconoce "borra la nota del súper" como notes.remove (0 IA)', () => {
    const result = resolveDeterministicCommand('borra la nota del súper', { language: 'es' });
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('note');
    expect(result.channel).toBe('flu');
    const action = result.action as { handled?: boolean; action?: string; data?: { target?: string } };
    expect(action.handled).toBe(true);
    expect(action.action).toBe('notes.remove');
    expect(action.data?.target).toBe('Super');
  });

  it('el parser normaliza el destino (súper → Super, acentos y conectores)', () => {
  expect(parseNoteRemoveIntentText('borra la nota del súper')).toEqual({ target: 'Super', all: false });
  expect(parseNoteRemoveIntentText('elimina la nota de compras')).toEqual({ target: 'Super', all: false });
  expect(parseNoteRemoveIntentText('ok flu quita la nota del mercado')).toEqual({ target: 'Super', all: false });
  });

  it('matchNotesByTarget solo devuelve notas pendientes por substring normalizado', () => {
    const items: NoteRecord[] = [
      makeNote({ id: 'n1', label: 'Super: cloro', done: false }),
      makeNote({ id: 'n2', label: 'Super: pan', done: true }),
      makeNote({ id: 'n3', label: 'llamar al dentista', done: false }),
    ];
    const matches = matchNotesByTarget(items, 'Super');
    expect(matches.map((n) => n.id)).toEqual(['n1']);
  });
});

describe('caso 10 — borrado LÓGICO por destino (flujo completo)', () => {
  let db: NotesDb;

  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;
    db = createMapDb();
  });

  it('softRemove marca sync.deleted y conserva la fila (no borrado físico)', async () => {
    const service = createNotesService({ db, now, newId: () => `note-${++idCounter}` });
    const added = (await service.add({ label: 'Super: cloro' })).record!;

    const softRemoved = await service.softRemove(added.id);
    expect(softRemoved?.sync.deleted).toBe(true);
    expect(softRemoved?.sync.revision).toBe(2);

    // La fila sigue existiendo físicamente, pero marcada como borrada.
    const row = await db.get(added.id);
    expect(row?.sync.deleted).toBe(true);
  });

  it('removeByTarget marca 1 nota pendiente borrada y deja intactas las hechas', async () => {
    const service = createNotesService({ db, now, newId: () => `note-${++idCounter}` });
    await service.add({ label: 'Super: cloro' });
    const done = (await service.add({ label: 'Super: pan' })).record!;
    await service.toggle(done.id); // hecha → no debe borrarse

    const count = await service.removeByTarget('Super');
    expect(count).toBe(1);

    // Solo la pendiente se borró lógicamente; la hecha sigue viva.
    const live = await service.list();
    expect(live.map((n) => n.label)).toEqual(['Super: pan']);
    expect(await service.remaining()).toBe(0);
  });

  it('flujo determinista completo: parsear → match → borrado lógico', async () => {
    const service = createNotesService({ db, now, newId: () => `note-${++idCounter}` });
    await service.add({ label: 'Super: cloro' });
    await service.add({ label: 'llamar al dentista' });

    // Mismo punto de entrada que el árbitro (sin re-parsear en App).
    const parsed = parseNoteRemoveIntentText('borra la nota del súper');
    expect(parsed?.target).toBe('Super');

    const count = await service.removeByTarget(parsed!.target!);
    expect(count).toBe(1);

    const live = await service.list();
    expect(live.map((n) => n.label)).toEqual(['llamar al dentista']);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'notes.remove', 'note', expect.any(String), expect.anything(), expect.anything(), 'notesService',
    );
  });
});
