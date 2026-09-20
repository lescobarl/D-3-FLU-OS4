// ============================================================
// useNotes — Listado de notas (Pizarrón consolidado)
// ------------------------------------------------------------
// Hook que gestiona el listado de notas sobre Dexie vía notesService. Es un
// hook de estado + acciones: no lleva scheduler ni notificaciones (las notas
// no vencen), sólo persistencia y UI en vivo.
//
// Cumple:
//   - Rule #1: NO HARDCODE — texto/etiquetas vienen de
//     FLU_CONFIG.notes.ui (lo consume el panel, no el hook)
//   - Obligación #5: auditoría (la hace notesService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace notesService)
//   - DI: `now` inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { type NoteRecord } from '../core/db/fluDatabase';
import {
  createNotesService,
  type AddNoteResult,
  type NewNoteInput,
  type NotesService,
} from '../core/notes/notesService';
import { filterNotesByScope, notesRemaining } from '../core/notes/notesList';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseNotesOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Usuario activo: aísla las notas (cada usuario ve solo las suyas). */
  participantId?: string;
}

export interface NotesState {
  notes: NoteRecord[];
  loading: boolean;
  remainingCount: number;
}

export interface NotesActions {
  refresh: () => Promise<void>;
  add: (input: NewNoteInput) => Promise<AddNoteResult>;
  /** Agrega varias etiquetas de una vez (multi-add del parser de intención). */
  addMany: (labels: string[]) => Promise<AddNoteResult[]>;
  toggle: (id: string) => Promise<NoteRecord | null>;
  rename: (id: string, label: string) => Promise<NoteRecord | null>;
  /** Actualiza el contenido (body) de una nota. */
  setBody: (id: string, body: string) => Promise<NoteRecord | null>;
  remove: (id: string) => Promise<boolean>;
  /** Borrado lógico (§2.9): marca `sync.deleted` sin borrar la fila. */
  softRemove: (id: string) => Promise<NoteRecord | null>;
  /** Borrado lógico por destino (voz "borra la nota X"); devuelve cuántas marcó. */
  removeByTarget: (target: string) => Promise<number>;
  uncheckAll: () => Promise<number>;
  clearDone: () => Promise<number>;
  /** Borra (lógico) TODAS las notas. */
  clearAll: () => Promise<number>;
}

export interface UseNotesResult extends NotesState, NotesActions {
  service: NotesService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useNotes({ now, participantId }: UseNotesOptions = {}): UseNotesResult {
  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<NotesService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createNotesService({
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [remainingCount, setRemainingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  /** Recarga la lista desde IndexedDB (cronológica, pendientes primero). */
  const refresh = useCallback(async (): Promise<void> => {
    // Sin usuario real NO hay alcance de notas (son por usuario). No se cae a
    // 'global/legacy': eso mostraba notas en el onboarding, antes de elegir
    // usuario.
    if (!participantId) {
      setNotes([]);
      setRemainingCount(0);
      setLoading(false);
      return;
    }
    try {
      const all = await service.list();
      // Aislamiento por usuario: solo las notas de ESTE usuario.
      const scoped = filterNotesByScope(all, participantId);
      const sorted = scoped.slice().sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      });
      setNotes(sorted);
      setRemainingCount(notesRemaining(sorted));
    } catch (err) {
      console.error('[useNotes] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service, participantId]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  /** Agrega una nota y refresca la lista. */
  const add = useCallback(
    async (input: NewNoteInput): Promise<AddNoteResult> => {
      // Toda nota pertenece a un usuario: sin usuario real no se crea (una nota
      // sin personId quedaría en 'global' y se filtraría a otros contextos).
      if (!participantId) return { ok: false, reason: 'invalid-input' };
      const result = await service.add({
        ...input,
        personId: input.personId || participantId,
      });
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh, participantId],
  );

  /** Agrega varias etiquetas de una vez (multi-add del parser de intención). */
  const addMany = useCallback(
    async (labels: string[]): Promise<AddNoteResult[]> => {
      if (!participantId) return [];
      const clean = (labels || []).map((l) => l.trim()).filter(Boolean);
      if (clean.length === 0) return [];
      const results: AddNoteResult[] = [];
      for (const label of clean) {
        const result = await service.add({ label, personId: participantId });
        results.push(result);
      }
      if (results.some((r) => r.ok)) await refresh();
      return results;
    },
    [service, refresh, participantId],
  );

  /** Alterna el estado hecho/pendiente y refresca. */
  const toggle = useCallback(
    async (id: string): Promise<NoteRecord | null> => {
      const updated = await service.toggle(id);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Renombra una nota y refresca. */
  const rename = useCallback(
    async (id: string, label: string): Promise<NoteRecord | null> => {
      const updated = await service.rename(id, label);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Actualiza el contenido (body) de una nota y refresca. */
  const setBody = useCallback(
    async (id: string, body: string): Promise<NoteRecord | null> => {
      const updated = await service.setBody(id, body);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Elimina una nota y refresca. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const removed = await service.remove(id);
      if (removed) await refresh();
      return removed;
    },
    [service, refresh],
  );

  /** Borrado lógico por id y refresca. */
  const softRemove = useCallback(
    async (id: string): Promise<NoteRecord | null> => {
      const updated = await service.softRemove(id);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Borrado lógico por destino (voz) y refresca. */
  const removeByTarget = useCallback(
    async (target: string): Promise<number> => {
      const count = await service.removeByTarget(target);
      if (count > 0) await refresh();
      return count;
    },
    [service, refresh],
  );

  /** Desmarca todas las notas pendientes y refresca. */
  const uncheckAll = useCallback(async (): Promise<number> => {
    const count = await service.uncheckAll();
    if (count > 0) await refresh();
    return count;
  }, [service, refresh]);

  /** Limpia las notas marcadas como hechas y refresca. */
  const clearDone = useCallback(async (): Promise<number> => {
    const count = await service.clearDone();
    if (count > 0) await refresh();
    return count;
  }, [service, refresh]);

  /** Borra (lógico) TODAS las notas del usuario y refresca. */
  const clearAll = useCallback(async (): Promise<number> => {
    if (!participantId) return 0;
    const count = await service.clearAll({ personId: participantId });
    if (count > 0) await refresh();
    return count;
  }, [service, refresh, participantId]);

  return {
    service,
    notes,
    loading,
    remainingCount,
    refresh,
    add,
    addMany,
    toggle,
    rename,
    setBody,
    remove,
    softRemove,
    removeByTarget,
    uncheckAll,
    clearDone,
    clearAll,
  };
}
