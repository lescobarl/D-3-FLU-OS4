// ============================================================
// documentsService — Historial de documentos/imágenes generados o cargados
// ------------------------------------------------------------
// Persiste un registro por documento (generado o subido) para tener historial
// por usuario. Aislamiento: cada fila lleva `personId`; `list` filtra por el
// alcance del usuario activo (`personId || 'global'`).
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import { type DocumentRecord } from '../db/fluDatabase';
import { buildSyncTuple } from '../db/syncTuple';

export interface NewDocumentInput {
  kind: DocumentRecord['kind'];
  formato: string;
  titulo: string;
  nombre?: string;
  mime?: string;
  tamaño?: number;
  ref?: string;
  contenido?: string;
  personId?: string;
}

interface DocumentsTable {
  add(record: DocumentRecord): Promise<unknown>;
  toArray(): Promise<DocumentRecord[]>;
  get(id: string): Promise<DocumentRecord | undefined>;
  put(record: DocumentRecord): Promise<unknown>;
  delete(id: string): Promise<unknown>;
}

export interface DocumentsService {
  add(input: NewDocumentInput): Promise<DocumentRecord | null>;
  list(participantId?: string): Promise<DocumentRecord[]>;
  remove(id: string): Promise<boolean>;
}

function newId(): string {
  return uuidv4();
}

export function createDocumentsService({
  db,
  now,
}: {
  db: DocumentsTable;
  now?: () => number;
}): DocumentsService {
  const ts = now || (() => Date.now());
  return {
    async add(input: NewDocumentInput): Promise<DocumentRecord | null> {
      const titulo = String(input.titulo || '').trim();
      if (!titulo || !input.formato) return null;
      const t = ts();
      const record: DocumentRecord = {
        id: newId(),
        kind: input.kind,
        formato: String(input.formato).trim(),
        titulo,
        nombre: String(input.nombre || titulo).trim(),
        mime: input.mime,
        tamaño: input.tamaño,
        ref: input.ref,
        contenido: input.contenido,
        personId: input.personId,
        createdAt: t,
        updatedAt: t,
        sync: buildSyncTuple(undefined, t),
      };
      await db.add(record);
      return record;
    },
    async list(participantId?: string): Promise<DocumentRecord[]> {
      const scope = participantId || 'global';
      const all = await db.toArray();
      return all
        .filter((row) => (row.personId || 'global') === scope && !row.sync?.deleted)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    /** Borrado LÓGICO (§2.9): marca `sync.deleted`; `list` ya filtra borrados. */
    async remove(id: string): Promise<boolean> {
      if (!id) return false;
      const row = await db.get(id);
      if (!row) return false;
      const t = ts();
      await db.put({ ...row, updatedAt: t, sync: { ...buildSyncTuple(row.sync, t), deleted: true } });
      return true;
    },
  };
}
