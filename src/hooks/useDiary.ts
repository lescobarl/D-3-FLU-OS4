// ============================================================
// useDiary — Diario personal (Fase 6, Módulo J)
// ------------------------------------------------------------
// Hook que gestiona las entradas del diario sobre Dexie
// (fluDb.diaryEntries) vía diaryService.
//
// Cumple:
//   - Regla #1: NO HARDCODE — tope diario desde FLU_CONFIG.diary
//   - Obligación #5: auditoría (la hace diaryService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace diaryService)
//   - Módulo J: diario de notas/voz con fechas
//   - DI: now inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb, type DiaryEntryRecord } from '../core/db/fluDatabase';
import {
  createDiaryService,
  type AddDiaryResult,
  type DiaryEntryInput,
  type DiaryEntryPatch,
  type DiaryService,
  type RemoveDiaryResult,
  type UpdateDiaryResult,
} from '../core/diary/diaryService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseDiaryOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface DiaryState {
  entries: DiaryEntryRecord[];
  loading: boolean;
}

export interface DiaryActions {
  refresh: () => Promise<void>;
  addEntry: (input: DiaryEntryInput) => Promise<AddDiaryResult>;
  updateEntry: (id: string, patch: DiaryEntryPatch) => Promise<UpdateDiaryResult>;
  getEntry: (id: string) => Promise<DiaryEntryRecord | undefined>;
  listEntries: (date?: string) => Promise<DiaryEntryRecord[]>;
  getHistory: (limit?: number) => Promise<DiaryEntryRecord[]>;
  removeEntry: (id: string) => Promise<RemoveDiaryResult>;
}

export interface UseDiaryResult extends DiaryState, DiaryActions {
  service: DiaryService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useDiary({ now }: UseDiaryOptions = {}): UseDiaryResult {
  const config = FLU_CONFIG.diary || {};
  const maxEntriesPerDay =
    typeof config.maxEntriesPerDay === 'number' ? config.maxEntriesPerDay : undefined;

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<DiaryService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createDiaryService({
      db: { diaryEntries: fluDb.diaryEntries },
      config: { maxEntriesPerDay },
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  const [entries, setEntries] = useState<DiaryEntryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  /** Recarga las entradas del diario desde IndexedDB. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const rows = await service.listEntries();
      setEntries(rows);
    } catch (err) {
      console.error('[useDiary] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  /** Añade una entrada; refresca si fue exitoso. */
  const addEntry = useCallback(
    async (input: DiaryEntryInput): Promise<AddDiaryResult> => {
      const result = await service.addEntry(input);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Actualiza una entrada; refresca si fue exitoso. */
  const updateEntry = useCallback(
    async (id: string, patch: DiaryEntryPatch): Promise<UpdateDiaryResult> => {
      const result = await service.updateEntry(id, patch);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Consulta una entrada por id. */
  const getEntry = useCallback(
    async (id: string): Promise<DiaryEntryRecord | undefined> => service.getEntry(id),
    [service],
  );

  /** Lista entradas, opcionalmente filtradas por día. */
  const listEntries = useCallback(
    async (date?: string): Promise<DiaryEntryRecord[]> => service.listEntries(date),
    [service],
  );

  /** Historial (con límite opcional). */
  const getHistory = useCallback(
    async (limit?: number): Promise<DiaryEntryRecord[]> => service.getHistory(limit),
    [service],
  );

  /** Elimina una entrada; refresca si fue exitoso. */
  const removeEntry = useCallback(
    async (id: string): Promise<RemoveDiaryResult> => {
      const result = await service.removeEntry(id);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  return {
    service,
    entries,
    loading,
    refresh,
    addEntry,
    updateEntry,
    getEntry,
    listEntries,
    getHistory,
    removeEntry,
  };
}
