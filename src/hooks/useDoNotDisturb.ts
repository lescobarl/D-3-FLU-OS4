// ============================================================
// useDoNotDisturb — Estado "no molestar" (Fase 1, D2)
// ------------------------------------------------------------
// Config-driven (FLU_CONFIG.dnd) + overrides persistentes del
// usuario (STORAGE_KEYS.DND_*). Re-evalúa el estado cada tickMs.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { STORAGE_KEYS } from '../core/config/appConfig';
import { describeDndSchedule, isDoNotDisturbActive } from '../core/dnd/dndPolicy';

export interface DndSchedule {
  start: string;
  end: string;
}

export interface DoNotDisturbState {
  enabled: boolean;
  schedule: DndSchedule;
  allowUrgent: boolean;
  active: boolean;
  scheduleLabel: string;
}

/** Subconjunto persistible del estado (sin derivados `active`/`scheduleLabel`). */
export interface DndConfigData {
  enabled: boolean;
  schedule: DndSchedule;
  allowUrgent: boolean;
}

export interface DoNotDisturbActions {
  setEnabled: (enabled: boolean) => void;
  setSchedule: (schedule: DndSchedule) => void;
  setAllowUrgent: (allowUrgent: boolean) => void;
}

function readStoredSchedule(fallback: DndSchedule): DndSchedule {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(STORAGE_KEYS.DND_SCHEDULE);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.start === 'string' &&
      typeof parsed.end === 'string' &&
      typeof parsed.start === 'string'
    ) {
      return { start: parsed.start, end: parsed.end };
    }
  } catch {
        console.warn('[catch] src/hooks/useDoNotDisturb.ts');
    // ignorar valores corruptos → fallback
  }
  return fallback;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function readDndConfig(): DndConfigData {
  const base = FLU_CONFIG.dnd || {};
  const schedule: DndSchedule =
    base.schedule && base.schedule.start && base.schedule.end
      ? { start: String(base.schedule.start), end: String(base.schedule.end) }
      : { start: '22:00', end: '07:00' };
  const fallback = {
    enabled: base.enabled !== false,
    schedule,
    allowUrgent: base.allowUrgent !== false,
  };
  return {
    enabled: readStoredBoolean(STORAGE_KEYS.DND_ENABLED, fallback.enabled),
    schedule: readStoredSchedule(fallback.schedule),
    allowUrgent: readStoredBoolean(STORAGE_KEYS.DND_ALLOW_URGENT, fallback.allowUrgent),
  };
}

export function useDoNotDisturb(): [DoNotDisturbState, DoNotDisturbActions] {
  const [config, setConfig] = useState<DndConfigData>(() => readDndConfig());
  const [now, setNow] = useState<Date>(() => new Date());

  const tickMs = Number(FLU_CONFIG.dnd?.tickMs) || 60000;

  useEffect(() => {
    if (!config.enabled) return;
    const timer = window.setInterval(() => setNow(new Date()), tickMs);
    return () => window.clearInterval(timer);
  }, [config.enabled, tickMs]);

  const active = useMemo(() => isDoNotDisturbActive(now, config), [now, config]);
  const scheduleLabel = useMemo(() => describeDndSchedule(config), [config.schedule]);

  const persist = useCallback((patch: Partial<DndConfigData>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEYS.DND_ENABLED, String(next.enabled));
        window.localStorage.setItem(STORAGE_KEYS.DND_SCHEDULE, JSON.stringify(next.schedule));
        window.localStorage.setItem(STORAGE_KEYS.DND_ALLOW_URGENT, String(next.allowUrgent));
      }
      return next;
    });
  }, []);

  const setEnabled = useCallback((enabled: boolean) => persist({ enabled }), [persist]);
  const setSchedule = useCallback((schedule: DndSchedule) => persist({ schedule }), [persist]);
  const setAllowUrgent = useCallback(
    (allowUrgent: boolean) => persist({ allowUrgent }),
    [persist],
  );

  const state: DoNotDisturbState = useMemo(
    () => ({ ...config, active, scheduleLabel }),
    [config, active, scheduleLabel],
  );

  const actions: DoNotDisturbActions = useMemo(
    () => ({ setEnabled, setSchedule, setAllowUrgent }),
    [setEnabled, setSchedule, setAllowUrgent],
  );

  return [state, actions];
}
