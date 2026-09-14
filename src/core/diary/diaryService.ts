// ============================================================
// Diary Service — Diario personal (Fase 6, Módulo J)
// ------------------------------------------------------------
// Diario de notas/voz con fechas:
//   - alta, consulta, listado (por día), historial, edición y borrado
//   - varias entradas por día ('YYYY-MM-DD')
//   - título y contenido libre, con ánimo opcional asociado
//   - vínculo opcional con participantes (participantId/participantName)
// Cumple:
//   - Obligación #6: UUIDv4 (id)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; tope diario desde config
// Inyección de dependencias: { db, config, now, newId }.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type DiaryEntryRecord } from '../db/fluDatabase';
import { buildSyncTuple } from '../db/syncTuple';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// Los tipos de registro provienen de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exportan aquí.
export type { DiaryEntryRecord } from '../db/fluDatabase';

export interface DiaryConfig {
  /** Tope de entradas por día (opcional). */
  maxEntriesPerDay?: number;
}

export interface DiaryTableDb {
  add(record: DiaryEntryRecord): Promise<unknown>;
  put(record: DiaryEntryRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<DiaryEntryRecord | undefined>;
  toArray(): Promise<DiaryEntryRecord[]>;
}

export interface DiaryDb {
  diaryEntries: DiaryTableDb;
}

export interface DiaryServiceOptions {
  db: DiaryDb;
  config: DiaryConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface DiaryEntryInput {
  /** Clave de día local 'YYYY-MM-DD'. */
  date: string;
  title?: string;
  content: string;
  /** Ánimo opcional asociado a la entrada (escala 1..scaleMax). */
  mood?: number;
  participantId?: string;
  participantName?: string;
}

export interface DiaryEntryPatch {
  date?: string;
  title?: string;
  content?: string;
  mood?: number;
  participantId?: string;
  participantName?: string;
}

export interface AddDiaryResult {
  ok: boolean;
  record?: DiaryEntryRecord;
  reason?: 'invalid-input' | 'limit-reached';
}

export interface UpdateDiaryResult {
  ok: boolean;
  record?: DiaryEntryRecord;
  reason?: 'invalid-input' | 'diary-not-found';
}

export interface RemoveDiaryResult {
  ok: boolean;
  reason?: 'invalid-input' | 'diary-not-found';
}

// ------------------------------------------------------------
// Helpers de fecha (día local 'YYYY-MM-DD')
// ------------------------------------------------------------

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createDiaryService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: DiaryServiceOptions) {
  const timestamp = (): number => now();

  const toRecord = (row: DiaryEntryRecord): DiaryEntryRecord => ({ ...row });

  const addEntry = async (input: DiaryEntryInput): Promise<AddDiaryResult> => {
    if (
      !input ||
      !input.date ||
      !DATE_KEY_RE.test(input.date) ||
      !input.content ||
      !input.content.trim()
    ) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (config.maxEntriesPerDay !== undefined) {
      const all = await db.diaryEntries.toArray();
      const count = all.filter((e) => e.date === input.date).length;
      if (count >= config.maxEntriesPerDay) {
        return { ok: false, reason: 'limit-reached' };
      }
    }

    const id = newId();
    const t = timestamp();
    const record: DiaryEntryRecord = {
      id,
      date: input.date,
      title: input.title,
      content: input.content.trim(),
      mood: input.mood,
      participantId: input.participantId,
      participantName: input.participantName,
      createdAt: t,
      updatedAt: t,
      sync: buildSyncTuple(undefined, timestamp()),
    };
    await db.diaryEntries.add(record);
    await addAuditLog(
      'diary.add',
      'diaryEntries',
      id,
      null,
      { date: record.date, title: record.title },
      'diaryService',
    );
    return { ok: true, record: toRecord(record) };
  };

  const updateEntry = async (id: string, patch: DiaryEntryPatch): Promise<UpdateDiaryResult> => {
    if (!id) return { ok: false, reason: 'invalid-input' };
    if (patch.date !== undefined && !DATE_KEY_RE.test(patch.date)) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (patch.content !== undefined && !patch.content.trim()) {
      return { ok: false, reason: 'invalid-input' };
    }
    const existing = await db.diaryEntries.get(id);
    if (!existing) return { ok: false, reason: 'diary-not-found' };

    const previous = { date: existing.date, content: existing.content };
    const updated: DiaryEntryRecord = {
      ...existing,
      date: patch.date !== undefined ? patch.date : existing.date,
      title: patch.title !== undefined ? patch.title : existing.title,
      content: patch.content !== undefined ? patch.content.trim() : existing.content,
      mood: patch.mood !== undefined ? patch.mood : existing.mood,
      participantId: patch.participantId !== undefined ? patch.participantId : existing.participantId,
      participantName: patch.participantName !== undefined ? patch.participantName : existing.participantName,
      updatedAt: timestamp(),
      sync: buildSyncTuple(existing.sync, timestamp()),
    };
    await db.diaryEntries.put(updated);
    await addAuditLog(
      'diary.update',
      'diaryEntries',
      id,
      previous,
      { date: updated.date, title: updated.title },
      'diaryService',
    );
    return { ok: true, record: toRecord(updated) };
  };

  const getEntry = async (id: string): Promise<DiaryEntryRecord | undefined> => {
    if (!id) return undefined;
    const row = await db.diaryEntries.get(id);
    return row ? toRecord(row) : undefined;
  };

  const listEntries = async (date?: string): Promise<DiaryEntryRecord[]> => {
    const all = await db.diaryEntries.toArray();
    const filtered = date ? all.filter((e) => e.date === date) : all;
    return filtered
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))
      .map(toRecord);
  };

  const getHistory = async (limit?: number): Promise<DiaryEntryRecord[]> => {
    const sorted = await listEntries();
    return typeof limit === 'number' && limit >= 0 ? sorted.slice(0, limit) : sorted;
  };

  const removeEntry = async (id: string): Promise<RemoveDiaryResult> => {
    if (!id) return { ok: false, reason: 'invalid-input' };
    const entry = await db.diaryEntries.get(id);
    if (!entry) return { ok: false, reason: 'diary-not-found' };
    await db.diaryEntries.delete(id);
    await addAuditLog(
      'diary.remove',
      'diaryEntries',
      id,
      { date: entry.date, content: entry.content },
      null,
      'diaryService',
    );
    return { ok: true };
  };

  return {
    addEntry,
    updateEntry,
    getEntry,
    listEntries,
    getHistory,
    removeEntry,
  };
}

export type DiaryService = ReturnType<typeof createDiaryService>;
