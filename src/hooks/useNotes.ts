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
import { useCallback } from 'react';
import { refreshOnOk } from './refreshOnOk';
import { useServiceRef } from './useServiceRef';
import { usePendingList, useCountedMutation, addSequentially, cleanLabels, useRefreshAction } from './pendingListKit';
import { removeAndRefresh } from '../lib/removeAndRefresh';
import { type NoteRecord } from '../core/db/fluDatabase';
import {
  createNotesService,
  type AddNoteResult,
  type NewNoteInput,
  type NotesService,
} from '../core/notes/notesService';
import { filterNotesByScope, notesRemaining } from '../core/notes/notesList';
import { INVALID_INPUT } from '../lib/resultReasons';

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

/** Predicados estables: el núcleo de lista no debe recrear su refresco por render. */
const NOTE_DONE = (note: NoteRecord): boolean => note.done === true;
const NOTE_CREATED = (note: NoteRecord): number => note.createdAt ?? 0;

export function useNotes({ now, participantId }: UseNotesOptions = {}): UseNotesResult {
  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const service = useServiceRef<NotesService>(() => createNotesService({ now: now || (() => Date.now()), }));

  /**
   * Carga las notas del usuario activo. Sin usuario real NO hay alcance: eso
   * mostraba notas en el onboarding, antes de elegir usuario.
   */
  const load = useCallback(async (): Promise<NoteRecord[]> => {
    if (!participantId) return [];
    const all = await service.list();
    return filterNotesByScope(all, participantId);
  }, [service, participantId]);

  const { rows: notes, loading, remainingCount, refresh } = usePendingList<NoteRecord>({
    load,
    isDone: NOTE_DONE,
    createdAt: NOTE_CREATED,
    remaining: notesRemaining,
    errorContext: '[useNotes] refresh error',
  });
  const runCounted = useCountedMutation(refresh);

  /** Agrega una nota y refresca la lista. */
  const add = useCallback(
    async (input: NewNoteInput): Promise<AddNoteResult> => {
      // Toda nota pertenece a un usuario: sin usuario real no se crea (una nota
      // sin personId quedaría en 'global' y se filtraría a otros contextos).
      if (!participantId) return { ok: false, reason: INVALID_INPUT };
      return refreshOnOk(() => service.add({
        ...input,
        personId: input.personId || participantId,
      }), refresh);
    },
    [service, refresh, participantId],
  );

  /** Agrega varias etiquetas de una vez (multi-add del parser de intención). */
  const addMany = useCallback(
    async (labels: string[]): Promise<AddNoteResult[]> => {
      if (!participantId) return [];
      const clean = cleanLabels(labels);
      if (clean.length === 0) return [];
      const results = await addSequentially(clean, (label) =>
        service.add({ label, personId: participantId }),
      );
      if (results.some((r) => r.ok)) await refresh();
      return results;
    },
    [service, refresh, participantId],
  );

  /** Alterna el estado hecho/pendiente y refresca. */
  const toggle = useRefreshAction(service.toggle, refresh);

  /** Renombra una nota y refresca. */
  const rename = useRefreshAction(service.rename, refresh);

  /** Actualiza el contenido (body) de una nota y refresca. */
  const setBody = useRefreshAction(service.setBody, refresh);

  /** Elimina una nota y refresca. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => removeAndRefresh((rowId) => service.remove(rowId), refresh, id),
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
    async (target: string): Promise<number> => runCounted(() => service.removeByTarget(target)),
    [service, runCounted],
  );

  /** Desmarca todas las notas pendientes y refresca. */
  const uncheckAll = useCallback(
    async (): Promise<number> => runCounted(() => service.uncheckAll()),
    [service, runCounted],
  );

  /** Limpia las notas marcadas como hechas y refresca. */
  const clearDone = useCallback(
    async (): Promise<number> => runCounted(() => service.clearDone()),
    [service, runCounted],
  );

  /** Borra (lógico) TODAS las notas del usuario y refresca. */
  const clearAll = useCallback(async (): Promise<number> => {
    if (!participantId) return 0;
    return runCounted(() => service.clearAll({ personId: participantId }));
  }, [service, runCounted, participantId]);

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
