// ============================================================
// useHorario — Horario de clases en el Pizarrón
// ------------------------------------------------------------
// Hook que gestiona las clases del horario sobre Dexie
// (fluDb.horario) vía horarioService. Se declara antes de
// useFluVoiceAssistant en App para que el asistente pueda
// consultar la próxima clase / las clases de hoy por voz.
//
// Cumple:
//   - Rule #1: NO HARDCODE — límites/colores desde FLU_CONFIG.horario
//   - Obligación #5: auditoría (la hace horarioService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace horarioService)
//   - DI: now inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb, type HorarioRecord } from '../core/db/fluDatabase';
import {
  createHorarioService,
  toMin,
  type AddHorarioResult,
  type HorarioService,
  type NewHorarioInput,
} from '../core/horario/horarioService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseHorarioOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface HorarioState {
  horario: HorarioRecord[];
  loading: boolean;
}

export interface HorarioActions {
  refresh: () => Promise<void>;
  add: (input: NewHorarioInput) => Promise<AddHorarioResult>;
  update: (id: string, patch: Partial<NewHorarioInput>) => Promise<HorarioRecord | null>;
  remove: (id: string) => Promise<boolean>;
  /** Próxima clase a partir de `at` (por defecto: ahora). */
  proximaClase: (at?: number) => Promise<HorarioRecord | null>;
  /** Clases del día ISO (1-7) a partir de `at` (por defecto: ahora). */
  clasesDeHoy: (at?: number) => Promise<HorarioRecord[]>;
}

export interface UseHorarioResult extends HorarioState, HorarioActions {
  service: HorarioService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useHorario({ now }: UseHorarioOptions = {}): UseHorarioResult {
  const config = (FLU_CONFIG as any).horario || {};
  const maxClasesPorDia = Number(config.maxClasesPorDia) || 16;
  const diaMin = Number(config.diaMin) || 1;
  const diaMax = Number(config.diaMax) || 7;
  const defaultColor = config.defaultColor || 'm1';
  const colores: readonly string[] = Array.isArray(config.colores)
    ? config.colores
    : ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<HorarioService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createHorarioService({
      db: fluDb.horario,
      config: { maxClasesPorDia, diaMin, diaMax, defaultColor, colores },
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  const [horario, setHorario] = useState<HorarioRecord[]>([]);
  const [loading, setLoading] = useState(true);

  /** Recarga la lista desde IndexedDB (ordenada por día y hora de inicio). */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await service.list();
      const sorted = all
        .slice()
        .sort((a, b) => a.dia - b.dia || toMin(a.inicio) - toMin(b.inicio));
      setHorario(sorted);
    } catch (err) {
      console.error('[useHorario] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  /** Registra una clase y refresca la lista. */
  const add = useCallback(
    async (input: NewHorarioInput): Promise<AddHorarioResult> => {
      const result = await service.add(input);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Actualiza una clase y refresca la lista. */
  const update = useCallback(
    async (id: string, patch: Partial<NewHorarioInput>): Promise<HorarioRecord | null> => {
      const updated = await service.update(id, patch);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Elimina una clase y refresca la lista. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const removed = await service.remove(id);
      if (removed) await refresh();
      return removed;
    },
    [service, refresh],
  );

  /** Próxima clase a partir de `at` (por defecto: ahora). */
  const proximaClase = useCallback(
    async (at?: number): Promise<HorarioRecord | null> => service.proximaClase(at),
    [service],
  );

  /** Clases del día ISO (1-7) a partir de `at` (por defecto: ahora). */
  const clasesDeHoy = useCallback(
    async (at?: number): Promise<HorarioRecord[]> => service.clasesDeHoy(at),
    [service],
  );

  return {
    service,
    horario,
    loading,
    refresh,
    add,
    update,
    remove,
    proximaClase,
    clasesDeHoy,
  };
}
