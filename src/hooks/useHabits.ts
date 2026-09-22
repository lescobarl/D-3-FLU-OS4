// ============================================================
// useHabits — Hábitos y Metas (Fase 4, Módulo G)
// ------------------------------------------------------------
// Hook que gestiona metas/hábitos por participante sobre Dexie
// (fluDb.goals + fluDb.goalCheckIns) vía habitService.
//
// Cumple:
//   - Regla #1: NO HARDCODE — categorías y límites desde FLU_CONFIG.habits
//   - Obligación #5: auditoría (la hace habitService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace habitService)
//   - Módulo G: alta de metas, check-in diario, rachas y progreso
//   - DI: now inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb, type GoalRecord } from '../core/db/fluDatabase';
import { logCaughtError } from '../lib/caughtError';
import {
  createHabitsService,
  type AddGoalResult,
  type CheckInInput,
  type CheckInResult,
  type GoalStats,
  type GoalStatus,
  type HabitsService,
  type NewGoalInput,
  type RemoveResult,
  type UpdateStatusResult,
} from '../core/habits/habitService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseHabitsOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface HabitsState {
  goals: GoalRecord[];
  stats: GoalStats[];
  loading: boolean;
}

export interface HabitsActions {
  refresh: () => Promise<void>;
  addGoal: (input: NewGoalInput) => Promise<AddGoalResult>;
  checkIn: (input: CheckInInput) => Promise<CheckInResult>;
  updateStatus: (id: string, status: GoalStatus) => Promise<UpdateStatusResult>;
  removeGoal: (id: string) => Promise<RemoveResult>;
}

export interface UseHabitsResult extends HabitsState, HabitsActions {
  service: HabitsService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useHabits({ now }: UseHabitsOptions = {}): UseHabitsResult {
  const config = FLU_CONFIG.habits || {};
  const categories =
    Array.isArray(config.categories) && config.categories.length > 0
      ? (config.categories as string[])
      : ['habito', 'meta'];
  const defaultTargetDays =
    typeof config.defaultTargetDays === 'number' ? config.defaultTargetDays : 21;
  const maxGoalsPerParticipant =
    typeof config.maxGoalsPerParticipant === 'number'
      ? config.maxGoalsPerParticipant
      : undefined;

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<HabitsService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createHabitsService({
      db: { goals: fluDb.goals, checkIns: fluDb.goalCheckIns },
      config: { categories, defaultTargetDays, maxGoalsPerParticipant },
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [stats, setStats] = useState<GoalStats[]>([]);
  const [loading, setLoading] = useState(true);

  /** Recarga las metas y sus estadísticas desde IndexedDB. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [goalRows, statRows] = await Promise.all([
        service.listGoals(),
        service.getStats(),
      ]);
      setGoals(goalRows);
      setStats(statRows);
    } catch (err) {
      logCaughtError('[useHabits] refresh error', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  /** Alta de una meta/hábito; refresca la lista si fue exitosa. */
  const addGoal = useCallback(
    async (input: NewGoalInput): Promise<AddGoalResult> => {
      const result = await service.addGoal(input);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Check-in diario; refresca las estadísticas si fue exitoso. */
  const checkIn = useCallback(
    async (input: CheckInInput): Promise<CheckInResult> => {
      const result = await service.checkIn(input);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Cambia el estado de una meta; refresca si fue exitoso. */
  const updateStatus = useCallback(
    async (id: string, status: GoalStatus): Promise<UpdateStatusResult> => {
      const result = await service.updateStatus(id, status);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Elimina una meta (y sus check-ins); refresca si fue exitoso. */
  const removeGoal = useCallback(
    async (id: string): Promise<RemoveResult> => {
      const result = await service.removeGoal(id);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  return {
    service,
    goals,
    stats,
    loading,
    refresh,
    addGoal,
    checkIn,
    updateStatus,
    removeGoal,
  };
}
