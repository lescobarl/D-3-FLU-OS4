// ============================================================
// useMateriaGris — Gamificación de participaciones (Fase 3, F5)
// ------------------------------------------------------------
// Hook que gestiona los puntos de "materia gris" por participante
// sobre Dexie (fluDb.materiaGris) vía materiaGrisService.
//
// Cumple:
//   - Regla #1: NO HARDCODE — tabla de acciones desde FLU_CONFIG.materiaGris
//   - Obligación #5: auditoría (la hace materiaGrisService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace materiaGrisService)
//   - F5: leaderboard, total por participante e historial
//   - DI: now inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb, type MateriaGrisRecord } from '../core/db/fluDatabase';
import {
  createMateriaGrisService,
  type AwardInput,
  type AwardResult,
  type LeaderboardRow,
  type MateriaGrisService,
} from '../core/multiuser/materiaGrisService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseMateriaGrisOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface MateriaGrisState {
  leaderboard: LeaderboardRow[];
  history: MateriaGrisRecord[];
  loading: boolean;
}

export interface MateriaGrisActions {
  refresh: () => Promise<void>;
  awardPoints: (input: AwardInput) => Promise<AwardResult>;
  getTotalFor: (participantId: string) => Promise<number>;
}

export interface UseMateriaGrisResult extends MateriaGrisState, MateriaGrisActions {
  service: MateriaGrisService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useMateriaGris({ now }: UseMateriaGrisOptions = {}): UseMateriaGrisResult {
  const config = (FLU_CONFIG as any).materiaGris || {};
  const actions =
    config.actions && typeof config.actions === 'object'
      ? (config.actions as Record<string, number>)
      : {};
  const maxEntriesPerParticipant =
    typeof config.maxEntriesPerParticipant === 'number'
      ? config.maxEntriesPerParticipant
      : undefined;

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<MateriaGrisService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createMateriaGrisService({
      db: fluDb.materiaGris,
      config: { actions, maxEntriesPerParticipant },
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [history, setHistory] = useState<MateriaGrisRecord[]>([]);
  const [loading, setLoading] = useState(true);

  /** Recarga el leaderboard y el historial desde IndexedDB. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [rows, entries] = await Promise.all([
        service.getLeaderboard(),
        service.getHistory(),
      ]);
      setLeaderboard(rows);
      setHistory(entries);
    } catch (err) {
      console.error('[useMateriaGris] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  /** Otorga puntos por una acción y refresca el leaderboard. */
  const awardPoints = useCallback(
    async (input: AwardInput): Promise<AwardResult> => {
      const result = await service.awardPoints(input);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Total de puntos acumulados por un participante. */
  const getTotalFor = useCallback(
    async (participantId: string): Promise<number> => service.getTotalFor(participantId),
    [service],
  );

  return {
    service,
    leaderboard,
    history,
    loading,
    refresh,
    awardPoints,
    getTotalFor,
  };
}
