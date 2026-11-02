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
import { addAuditLog, fluDb, type NoteRecord } from '../db/fluDatabase';
import { buildSyncTuple, makeTupleTimestamp } from '../db/syncTuple';
import { copyRecord, createFilteredAliveList, getAliveRecord, listAliveRecords } from '../db/recordCopy';
import { createClearFlagged, createRename, createToggle } from '../db/entityMutations';
import { filterNotes, matchNotesByTarget, notesRemaining, type NotesFilter, type NewNoteInput } from './notesList';
import { INVALID_INPUT } from '../../lib/resultReasons';
import type { InvalidInput } from '../../lib/resultReasons';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// El registro persistente proviene de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exporta aquí.
export type { NoteRecord } from '../db/fluDatabase';

/**
 * C11 — Único módulo que resuelve las tablas de notas/listas. Notas y lista de
 * compras se obtienen por aquí; ningún otro consumidor nombra las tablas de
 * Dexie directamente (una sola fuente para notas/listas).
 */
export function notesTable() {
  return fluDb.notes;
}

export function shoppingItemsTable() {
  return fluDb.shoppingItems;
}

export type { NewNoteInput };

export interface NotesDb {
  add(record: NoteRecord): Promise<unknown>;
  put(record: NoteRecord): Promise<unknown>;
  bulkPut(records: NoteRecord[]): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<NoteRecord | undefined>;
  toArray(): Promise<NoteRecord[]>;
}

export interface NotesServiceOptions {
  /** Tabla de notas. Por defecto: la resuelve fluDatabase (C11). */
  db?: NotesDb;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface AddNoteResult {
  ok: boolean;
  record?: NoteRecord;
  reason?: InvalidInput;
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createNotesService({
  db = notesTable(),
  now = () => Date.now(),
  newId = uuidv4,
}: NotesServiceOptions = {}) {
  const timestamp = makeTupleTimestamp(now);

  const add = async (input: NewNoteInput): Promise<AddNoteResult> => {
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    if (!label) return { ok: false, reason: INVALID_INPUT };
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

  const get = async (id: string): Promise<NoteRecord | undefined> =>
    getAliveRecord(db, id);

  const list = async (): Promise<NoteRecord[]> => {
    return (await listAliveRecords(db)).map(copyRecord);
  };

  const listFiltered = createFilteredAliveList<NoteRecord, NotesFilter>(
    db,
    copyRecord,
    filterNotes,
    'all',
  );

  const toggle = createToggle({
    table: db,
    now: timestamp,
    copy: copyRecord,
    audit: { action: 'notes.toggle', entity: 'note', source: 'notesService' },
    setFlag: (row, at) => ({ ...row, done: !row.done, updatedAt: at, sync: buildSyncTuple(row.sync, at) }),
    flagOf: (row) => row.done,
  });

  const rename = createRename({
    table: db,
    now: timestamp,
    copy: copyRecord,
    audit: { action: 'notes.rename', entity: 'note', source: 'notesService' },
  });

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
    const all = await listAliveRecords(db);
    const matches = matchNotesByTarget(all, clean);
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
    // Escritura en LOTE (bulkPut): una transacción en vez de N put secuenciales.
    const cleared = done.map((note) => ({
      ...note,
      done: false,
      updatedAt: t,
      sync: buildSyncTuple(note.sync, timestamp()),
    }));
    if (cleared.length > 0) await db.bulkPut(cleared);
    if (done.length > 0) {
      await addAuditLog('notes.uncheckAll', 'note', '', done.length, 0, 'notesService');
    }
    return done.length;
  };

  /** Elimina todas las notas marcadas como hechas; devuelve cuántas se quitaron. */
  const clearDone = createClearFlagged({
    table: db,
    now: timestamp,
    copy: copyRecord,
    audit: { action: 'notes.clearDone', entity: 'note', source: 'notesService' },
    isFlagged: (row) => row.done,
  });

  /** Borrado LÓGICO de TODAS las notas (§2.9): devuelve cuántas se marcaron. */
  const clearAll = async (opts?: { personId?: string }): Promise<number> => {
    const all = await listAliveRecords(db);
    // Aislamiento: si viene personId, solo se vacían las notas de ESE usuario.
    const live = all.filter(
      (note) => !opts?.personId || note.personId === opts.personId,
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
    return notesRemaining(await listAliveRecords(db));
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
