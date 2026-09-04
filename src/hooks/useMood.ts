// ============================================================
// useMood — Bienestar/Ánimo (Fase 5, Módulo H)
// ------------------------------------------------------------
// Hook que gestiona el registro diario de ánimo por participante
// sobre Dexie (fluDb.moodCheckIns) vía moodService.
//
// Cumple:
//   - Regla #1: NO HARDCODE — escala y límites desde FLU_CONFIG.mood
//   - Obligación #5: auditoría (la hace moodService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace moodService)
//   - Módulo H: registro diario, historial y resumen
//   - DI: now inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb, type MoodRecord } from '../core/db/fluDatabase';
import {
  createMoodService,
  type LogMoodInput,
  type LogMoodResult,
  type MoodService,
  type MoodSummary,
  type RemoveMoodResult,
} from '../core/mood/moodService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseMoodOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface MoodState {
  moods: MoodRecord[];
  summary: MoodSummary;
  loading: boolean;
}

export interface MoodActions {
  refresh: () => Promise<void>;
  logMood: (input: LogMoodInput) => Promise<LogMoodResult>;
  getMoodOn: (participantId: string, date: string) => Promise<MoodRecord | undefined>;
  getHistory: (participantId?: string, limit?: number) => Promise<MoodRecord[]>;
  getSummary: (participantId?: string) => Promise<MoodSummary>;
  removeMood: (id: string) => Promise<RemoveMoodResult>;
}

export interface UseMoodResult extends MoodState, MoodActions {
  service: MoodService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useMood({ now }: UseMoodOptions = {}): UseMoodResult {
  const config = (FLU_CONFIG as any).mood || {};
  const scaleMin = typeof config.scaleMin === 'number' ? config.scaleMin : 1;
  const scaleMax = typeof config.scaleMax === 'number' ? config.scaleMax : 5;
  const maxLogsPerParticipant =
    typeof config.maxLogsPerParticipant === 'number'
      ? config.maxLogsPerParticipant
      : undefined;

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<MoodService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createMoodService({
      db: { moodCheckIns: fluDb.moodCheckIns },
      config: { scaleMin, scaleMax, maxLogsPerParticipant },
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  const EMPTY_SUMMARY: MoodSummary = { totalLogs: 0, moodCounts: {} };

  const [moods, setMoods] = useState<MoodRecord[]>([]);
  const [summary, setSummary] = useState<MoodSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  /** Recarga el historial y el resumen desde IndexedDB. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [moodRows, summaryRows] = await Promise.all([
        service.listMoods(),
        service.getSummary(),
      ]);
      setMoods(moodRows);
      setSummary(summaryRows);
    } catch (err) {
      console.error('[useMood] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  /** Registra o actualiza el ánimo del día; refresca si fue exitoso. */
  const logMood = useCallback(
    async (input: LogMoodInput): Promise<LogMoodResult> => {
      const result = await service.logMood(input);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Consulta el ánimo de un participante en una fecha concreta. */
  const getMoodOn = useCallback(
    async (participantId: string, date: string): Promise<MoodRecord | undefined> =>
      service.getMoodOn(participantId, date),
    [service],
  );

  /** Historial de ánimo (opcionalmente filtrado y acotado). */
  const getHistory = useCallback(
    async (participantId?: string, limit?: number): Promise<MoodRecord[]> =>
      service.getHistory(participantId, limit),
    [service],
  );

  /** Resumen agregado del ánimo (opcionalmente por participante). */
  const getSummary = useCallback(
    async (participantId?: string): Promise<MoodSummary> =>
      service.getSummary(participantId),
    [service],
  );

  /** Elimina un registro de ánimo; refresca si fue exitoso. */
  const removeMood = useCallback(
    async (id: string): Promise<RemoveMoodResult> => {
      const result = await service.removeMood(id);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  return {
    service,
    moods,
    summary,
    loading,
    refresh,
    logMood,
    getMoodOn,
    getHistory,
    getSummary,
    removeMood,
  };
}
