// ============================================================
// Notes Service — Listado de notas (Pizarrón consolidado)
// ------------------------------------------------------------
// Persistencia del listado de notas sobre Dexie con:
//   - Obligación #6: UUIDv4 (id) — real, no placeholder
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; inyección de dependencias { db, now, newId }
// El listado de notas reemplaza la lista de compras como "listado de
// notas" (recorte de alcance del pizarrón consolidado). El motor puro
// (notesList.ts) define las reglas de filtrado y conteo; esta capa aporta
// persistencia, ids y marcas de tiempo reales.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type NoteRecord } from '../db/fluDatabase';
import { buildSyncTuple, makeTupleTimestamp } from '../db/syncTuple';
import { copyRecord } from '../db/recordCopy';
import { filterNotes, matchNotesByTarget, notesRemaining, type NotesFilter } from './notesList';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// El registro persistente proviene de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exporta aquí.
export type { NoteRecord } from '../db/fluDatabase';

export interface NewNoteInput {
  label: string;
  body?: string;
  personId?: string;
  personName?: string;
}

export interface NotesDb {
  add(record: NoteRecord): Promise<unknown>;
  put(record: NoteRecord): Promise<unknown>;
  bulkPut(records: NoteRecord[]): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<NoteRecord | undefined>;
  toArray(): Promise<NoteRecord[]>;
}

export interface NotesServiceOptions {
  db: NotesDb;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface AddNoteResult {
  ok: boolean;
  record?: NoteRecord;
  reason?: 'invalid-input';
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createNotesService({
  db,
  now = () => Date.now(),
  newId = uuidv4,
}: NotesServiceOptions) {
  const timestamp = makeTupleTimestamp(now);

  /** Fila viva: no marcada como borrada lógica (§2.9). */
  const isLive = (row: NoteRecord): boolean => !row.sync?.deleted;

  const add = async (input: NewNoteInput): Promise<AddNoteResult> => {
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    if (!label) return { ok: false, reason: 'invalid-input' };
    const t = timestamp();
    const record: NoteRecord = {
      id: newId(),
      label,
      body: typeof input.body === 'string' ? input.body : undefined,
      done: false,
      personId: input.personId,
      personName: input.personName,
      createdAt: t,
      updatedAt: t,
      sync: buildSyncTuple(undefined, timestamp()),
    };
    await db.add(record);
    await addAuditLog('notes.add', 'note', record.id, null, { label: record.label }, 'notesService');
    return { ok: true, record };
  };

  const get = async (id: string): Promise<NoteRecord | undefined> => {
    if (!id) return undefined;
    const row = await db.get(id);
    return row ? copyRecord(row) : undefined;
  };

  const list = async (): Promise<NoteRecord[]> => {
    const all = await db.toArray();
    return all.filter(isLive).map(copyRecord);
  };

  const listFiltered = async (filter: NotesFilter = 'all'): Promise<NoteRecord[]> => {
    const all = await db.toArray();
    return filterNotes(all.filter(isLive), filter).map(copyRecord);
  };

  const toggle = async (id: string): Promise<NoteRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;
    const updated: NoteRecord = {
      ...row,
      done: !row.done,
      updatedAt: timestamp(),
      sync: buildSyncTuple(row.sync, timestamp()),
    };
    await db.put(updated);
    await addAuditLog('notes.toggle', 'note', id, row.done, updated.done, 'notesService');
    return copyRecord(updated);
  };

  const rename = async (id: string, label: string): Promise<NoteRecord | null> => {
    const clean = typeof label === 'string' ? label.trim() : '';
    if (!clean) return null;
    const row = await db.get(id);
    if (!row) return null;
    const updated: NoteRecord = {
      ...row,
      label: clean,
      updatedAt: timestamp(),
      sync: buildSyncTuple(row.sync, timestamp()),
    };
    await db.put(updated);
    await addAuditLog('notes.rename', 'note', id, row.label, clean, 'notesService');
    return copyRecord(updated);
  };

  /** Actualiza el contenido (body) de una nota. */
  const setBody = async (id: string, body: string): Promise<NoteRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;
    const clean = typeof body === 'string' ? body : '';
    const updated: NoteRecord = {
      ...row,
      body: clean,
      updatedAt: timestamp(),
      sync: buildSyncTuple(row.sync, timestamp()),
    };
    await db.put(updated);
    return copyRecord(updated);
  };

  /** Alias de borrado LÓGICO (§2.9): delega en `softRemove`, nunca borra la fila. */
  const remove = async (id: string): Promise<boolean> => (await softRemove(id)) !== null;

  /** Borrado LÓGICO (§2.9): marca `sync.deleted` sin borrar la fila. */
  const softRemove = async (id: string): Promise<NoteRecord | null> => {
    const row = await db.get(id);
    if (!row) return null;
    const updated: NoteRecord = {
      ...row,
      updatedAt: timestamp(),
      sync: { ...buildSyncTuple(row.sync, timestamp()), deleted: true },
    };
    await db.put(updated);
    await addAuditLog('notes.remove', 'note', id, row, updated, 'notesService');
    return copyRecord(updated);
  };

  /**
   * Borrado lógico por destino (voz "borra la nota X"): localiza las notas
   * pendientes vivas cuyo label coincide con `target` (fuente única del match:
   * matchNotesByTarget) y las marca borradas. Devuelve cuántas se marcaron.
   */
  const removeByTarget = async (target: string): Promise<number> => {
    const clean = typeof target === 'string' ? target.trim() : '';
    if (!clean) return 0;
    const all = await db.toArray();
    const matches = matchNotesByTarget(all.filter(isLive), clean);
    let count = 0;
    for (const match of matches) {
      const updated = await softRemove(match.id);
      if (updated) count += 1;
    }
    return count;
  };

  /** Marca todas las notas como pendientes (no hechas). */
  const uncheckAll = async (): Promise<number> => {
    const all = await db.toArray();
    const done = all.filter((note) => note.done);
    const t = timestamp();
    for (const note of done) {
      const updated: NoteRecord = {
        ...note,
        done: false,
        updatedAt: t,
        sync: buildSyncTuple(note.sync, timestamp()),
      };
      await db.put(updated);
    }
    if (done.length > 0) {
      await addAuditLog('notes.uncheckAll', 'note', '', done.length, 0, 'notesService');
    }
    return done.length;
  };

  /** Elimina todas las notas marcadas como hechas; devuelve cuántas se quitaron. */
  const clearDone = async (): Promise<number> => {
    const all = await db.toArray();
    const done = all.filter((note) => note.done && !note.sync?.deleted);
    const t = timestamp();
    for (const note of done) {
      await db.put({
        ...note,
        updatedAt: t,
        sync: { ...buildSyncTuple(note.sync, t), deleted: true },
      });
    }
    if (done.length > 0) {
      await addAuditLog('notes.clearDone', 'note', '', done.length, 0, 'notesService');
    }
    return done.length;
  };

  /** Borrado LÓGICO de TODAS las notas (§2.9): devuelve cuántas se marcaron. */
  const clearAll = async (opts?: { personId?: string }): Promise<number> => {
    const all = await db.toArray();
    // Aislamiento: si viene personId, solo se vacían las notas de ESE usuario.
    const live = all.filter(
      (note) => isLive(note) && (!opts?.personId || note.personId === opts.personId),
    );
    // Escritura en LOTE (bulkPut): una transacción en vez de N put secuenciales.
    const marked = live.map((note) => ({
      ...note,
      updatedAt: timestamp(),
      sync: { ...buildSyncTuple(note.sync, timestamp()), deleted: true },
    }));
    if (marked.length > 0) await db.bulkPut(marked);
    if (live.length > 0) {
      await addAuditLog('notes.clearAll', 'note', '', live.length, 0, 'notesService');
    }
    return live.length;
  };

  const remaining = async (): Promise<number> => {
    const all = await db.toArray();
    return notesRemaining(all.filter(isLive));
  };

  return {
    add,
    get,
    list,
    listFiltered,
    toggle,
    rename,
    setBody,
    remove,
    softRemove,
    removeByTarget,
    uncheckAll,
    clearDone,
    clearAll,
    remaining,
  };
}

export type NotesService = ReturnType<typeof createNotesService>;
