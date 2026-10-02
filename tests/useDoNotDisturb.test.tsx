// @vitest-environment jsdom
// ============================================================
// Tests para useDoNotDisturb -- Estado "no molestar" (Fase 1, D2)
// ------------------------------------------------------------
// El hook es config-driven (FLU_CONFIG.dnd) + overrides persistentes
// (STORAGE_KEYS.DND_*). Se sustituye SOLO la frontera de almacenamiento
// mockeando localStore (localGet/localSet) con un Map en memoria
// vi.hoisted. La politica (dndPolicy) y la config (fluConfig) se usan
// REALES: el reloj se controla con fake timers + setSystemTime para
// que `active` sea determinista. logCaughtError se mockea para poder
// afirmar que el JSON corrupto se registra.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const store = vi.hoisted(() => new Map<string, string>());

vi.mock('../src/core/storage/localStore', () => ({
  localGet: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
  localSet: (key: string, value: string | number | boolean) => {
    store.set(key, String(value));
  },
  localRemove: (key: string) => {
    store.delete(key);
  },
  localKeys: () => Array.from(store.keys()),
  hasLocalStorage: () => true,
  localStorePort: () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} }),
}));

vi.mock('../src/lib/caughtError', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/caughtError')>(
    '../src/lib/caughtError',
  );
  return { ...actual, logCaughtError: vi.fn() };
});

import { logCaughtError } from '../src/lib/caughtError';
import { STORAGE_KEYS } from '../src/core/config/appConfig';
import { useDoNotDisturb } from '../src/hooks/useDoNotDisturb';

// FLU_CONFIG.dnd real: enabled=false, schedule 22:00-07:00, allowUrgent=true, tickMs=60000.
const TICK_MS = 60000;
const DASH = '\u2013';

function setNow(hours: number, minutes = 0): void {
  vi.setSystemTime(new Date(2026, 0, 15, hours, minutes, 0, 0));
}

describe('useDoNotDisturb -- no molestar (D2)', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    setNow(12, 0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---- Bloque: resolucion config-driven y overrides persistentes ----

  it('sin overrides usa FLU_CONFIG.dnd (deshabilitado por defecto, inactivo)', () => {
    const { result } = renderHook(() => useDoNotDisturb());
    const [state] = result.current;

    expect(state.enabled).toBe(false);
    expect(state.schedule).toEqual({ start: '22:00', end: '07:00' });
    expect(state.allowUrgent).toBe(true);
    expect(state.active).toBe(false);
    expect(state.scheduleLabel).toBe(`22:00 ${DASH} 07:00`);
  });

  it('los overrides persistidos mandan sobre la config y activan el DND en ventana', () => {
    store.set(STORAGE_KEYS.DND_ENABLED, 'true');
    store.set(STORAGE_KEYS.DND_SCHEDULE, JSON.stringify({ start: '09:00', end: '10:00' }));
    store.set(STORAGE_KEYS.DND_ALLOW_URGENT, 'false');
    setNow(9, 30);

    const { result } = renderHook(() => useDoNotDisturb());
    const [state] = result.current;

    expect(state.enabled).toBe(true);
    expect(state.schedule).toEqual({ start: '09:00', end: '10:00' });
    expect(state.allowUrgent).toBe(false);
    expect(state.active).toBe(true);
    expect(state.scheduleLabel).toBe(`09:00 ${DASH} 10:00`);
  });

  it('solo acepta los booleanos exactos true/false; otro texto cae al default', () => {
    store.set(STORAGE_KEYS.DND_ENABLED, 'TRUE');
    store.set(STORAGE_KEYS.DND_ALLOW_URGENT, 'yes');

    const { result } = renderHook(() => useDoNotDisturb());
    const [state] = result.current;

    expect(state.enabled).toBe(false);
    expect(state.allowUrgent).toBe(true);
  });

  it('un schedule corrupto cae al default y registra el error capturado', () => {
    store.set(STORAGE_KEYS.DND_SCHEDULE, '{esto no es json');

    const { result } = renderHook(() => useDoNotDisturb());
    const [state] = result.current;

    expect(state.schedule).toEqual({ start: '22:00', end: '07:00' });
    expect(logCaughtError).toHaveBeenCalledWith(
      '[catch] src/hooks/useDoNotDisturb.ts',
      expect.any(Error),
    );
  });

  it('un schedule incompleto (sin end) cae al default', () => {
    store.set(STORAGE_KEYS.DND_SCHEDULE, JSON.stringify({ start: '09:00' }));

    const { result } = renderHook(() => useDoNotDisturb());
    expect(result.current[0].schedule).toEqual({ start: '22:00', end: '07:00' });
  });

  // ---- Bloque: acciones que persisten ----

  it('setEnabled actualiza el estado y persiste la clave DND_ENABLED', () => {
    const { result } = renderHook(() => useDoNotDisturb());
    const [, actions] = result.current;

    act(() => {
      actions.setEnabled(true);
    });

    expect(result.current[0].enabled).toBe(true);
    expect(store.get(STORAGE_KEYS.DND_ENABLED)).toBe('true');
  });

  it('setSchedule persiste el JSON y reescribe las tres claves, ademas del label', () => {
    const { result } = renderHook(() => useDoNotDisturb());
    const [, actions] = result.current;

    act(() => {
      actions.setSchedule({ start: '08:00', end: '09:00' });
    });

    expect(result.current[0].schedule).toEqual({ start: '08:00', end: '09:00' });
    expect(result.current[0].scheduleLabel).toBe(`08:00 ${DASH} 09:00`);
    expect(store.get(STORAGE_KEYS.DND_SCHEDULE)).toBe(JSON.stringify({ start: '08:00', end: '09:00' }));
    expect(store.has(STORAGE_KEYS.DND_ENABLED)).toBe(true);
    expect(store.has(STORAGE_KEYS.DND_ALLOW_URGENT)).toBe(true);
  });

  it('setAllowUrgent actualiza el estado y persiste la clave', () => {
    const { result } = renderHook(() => useDoNotDisturb());
    const [, actions] = result.current;

    act(() => {
      actions.setAllowUrgent(false);
    });

    expect(result.current[0].allowUrgent).toBe(false);
    expect(store.get(STORAGE_KEYS.DND_ALLOW_URGENT)).toBe('false');
  });

  it('un schedule invalido fijado por accion produce label de guion largo', () => {
    const { result } = renderHook(() => useDoNotDisturb());
    const [, actions] = result.current;

    act(() => {
      actions.setSchedule({ start: '99:99', end: 'nope' });
    });

    expect(result.current[0].scheduleLabel).toBe('\u2014');
  });

  // ---- Bloque: politica activa/inactiva (rango nocturno) ----

  it('active=true dentro de la ventana nocturna cuando esta habilitado', () => {
    store.set(STORAGE_KEYS.DND_ENABLED, 'true');
    setNow(23, 0);

    const { result } = renderHook(() => useDoNotDisturb());
    expect(result.current[0].active).toBe(true);
  });

  it('active=false fuera de la ventana nocturna', () => {
    store.set(STORAGE_KEYS.DND_ENABLED, 'true');
    setNow(12, 0);

    const { result } = renderHook(() => useDoNotDisturb());
    expect(result.current[0].active).toBe(false);
  });

  it('active=false aunque la hora este en ventana si esta deshabilitado', () => {
    setNow(23, 0);

    const { result } = renderHook(() => useDoNotDisturb());
    expect(result.current[0].enabled).toBe(false);
    expect(result.current[0].active).toBe(false);
  });

  // ---- Bloque: re-evaluacion periodica (tick) ----

  it('re-evalua active cada tickMs: al entrar en la ventana el timer lo activa', () => {
    store.set(STORAGE_KEYS.DND_ENABLED, 'true');
    setNow(12, 0);

    const { result } = renderHook(() => useDoNotDisturb());
    expect(result.current[0].active).toBe(false);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);

    act(() => {
      setNow(23, 0);
      vi.advanceTimersByTime(TICK_MS);
    });

    expect(result.current[0].active).toBe(true);
  });

  it('no programa timer cuando esta deshabilitado y lo limpia al desmontar si esta activo', () => {
    const disabled = renderHook(() => useDoNotDisturb());
    expect(vi.getTimerCount()).toBe(0);
    disabled.unmount();

    store.set(STORAGE_KEYS.DND_ENABLED, 'true');
    const enabled = renderHook(() => useDoNotDisturb());
    expect(vi.getTimerCount()).toBe(1);
    enabled.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
