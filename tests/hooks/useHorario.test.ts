// @vitest-environment jsdom
// ============================================================
// Tests para useHorario — horario de clases en el Pizarrón
// ============================================================
// El hook usa el singleton fluDb.horario (Dexie) que NO es
// inyectable, así que se mockea el módulo fluDatabase con una
// tabla Map en memoria (vi.hoisted) para pruebas deterministas.
// El reloj se inyecta vía la opción now del hook.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { HorarioRecord } from '../../src/core/db/fluDatabase';

const { fluDbHorarioMock } = vi.hoisted(() => {
  type FakeRecord = {
    id: string;
    materia: string;
    dia: number;
    inicio: string;
    fin: string;
    aula?: string;
    color?: string;
    reminders?: string[];
    createdAt: number;
    updatedAt: number;
    sync: { revision: number; updated_at: string; deleted: boolean };
  };
  let map = new Map<string, FakeRecord>();
  const clone = (r: FakeRecord): FakeRecord => ({ ...r, sync: { ...r.sync } });
  const horario = {
    async add(record: FakeRecord): Promise<unknown> {
      map.set(record.id, clone(record));
      return record.id;
    },
    async put(record: FakeRecord): Promise<unknown> {
      map.set(record.id, clone(record));
      return record.id;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<FakeRecord | undefined> {
      const row = map.get(id);
      return row ? clone(row) : undefined;
    },
    async toArray(): Promise<FakeRecord[]> {
      return Array.from(map.values()).map(clone);
    },
    __reset(): void {
      map = new Map<string, FakeRecord>();
    },
    __seed(records: FakeRecord[]): void {
      for (const record of records) map.set(record.id, clone(record));
    },
  };
  return { fluDbHorarioMock: horario };
});

vi.mock('../../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/db/fluDatabase')>(
    '../../src/core/db/fluDatabase',
  );
  return {
    ...actual,
    addAuditLog: vi.fn(async () => undefined as never),
    fluDb: { horario: fluDbHorarioMock },
  };
});

import { useHorario } from '../../src/hooks/useHorario';

// Jueves 15 de enero de 2026, 10:00 (día ISO 4, minuto 600).
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const SYNCHRONIZED_AT = new Date(NOW).toISOString();

function clase(overrides: Partial<HorarioRecord> = {}): HorarioRecord {
  return {
    id: overrides.id || 'hor-1',
    materia: overrides.materia || 'Matematicas',
    dia: overrides.dia ?? 4,
    inicio: overrides.inicio || '08:00',
    fin: overrides.fin || '09:00',
    aula: overrides.aula,
    color: overrides.color || 'm1',
    reminders: [],
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
  };
}

describe('useHorario — horario de clases en el Pizarrón', () => {
  beforeEach(() => {
    fluDbHorarioMock.__reset();
    vi.clearAllMocks();
  });

  it('carga inicial vacía con loading false', async () => {
    const { result } = renderHook(() => useHorario({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.horario).toEqual([]);
  });

  it('carga las clases sembradas ordenadas por día y hora de inicio', async () => {
    fluDbHorarioMock.__seed([
      clase({ id: 'hor-2', materia: 'Matematicas', dia: 4, inicio: '08:00', fin: '09:00' }),
      clase({ id: 'hor-1', materia: 'Fisica', dia: 2, inicio: '10:00', fin: '11:00' }),
    ]);
    const { result } = renderHook(() => useHorario({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.horario.map((c) => c.materia)).toEqual(['Fisica', 'Matematicas']);
  });

  it('add registra, refresca la lista ordenada y devuelve el registro', async () => {
    const { result } = renderHook(() => useHorario({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.add({ materia: 'Fisica', dia: 2, inicio: '10:00', fin: '11:00' });
    });
    await act(async () => {
      await result.current.add({ materia: 'Matematicas', dia: 4, inicio: '08:00', fin: '09:00' });
    });

    expect(result.current.horario.map((c) => c.materia)).toEqual(['Fisica', 'Matematicas']);
    expect(result.current.horario[1].materia).toBe('Matematicas');
  });

  it('add con entrada inválida no refresca la lista', async () => {
    const { result } = renderHook(() => useHorario({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: { ok: boolean; reason?: string } | undefined;
    await act(async () => {
      outcome = await result.current.add({ materia: '', dia: 4, inicio: '08:00', fin: '09:00' });
    });

    expect(outcome).toEqual({ ok: false, reason: 'invalid-input' });
    expect(result.current.horario).toEqual([]);
  });

  it('update modifica y refresca la lista', async () => {
    fluDbHorarioMock.__seed([clase({ id: 'hor-1', materia: 'Matematicas', dia: 4 })]);
    const { result } = renderHook(() => useHorario({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const updatedOutcome: { value: HorarioRecord | null } = { value: null };
    await act(async () => {
      updatedOutcome.value = await result.current.update('hor-1', { materia: 'Calculo' });
    });

    expect(updatedOutcome.value?.materia).toBe('Calculo');
    expect(result.current.horario.map((c) => c.materia)).toEqual(['Calculo']);
  });

  it('remove elimina y refresca la lista', async () => {
    fluDbHorarioMock.__seed([clase({ id: 'hor-1', materia: 'Matematicas', dia: 4 })]);
    const { result } = renderHook(() => useHorario({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let removed = false;
    await act(async () => {
      removed = await result.current.remove('hor-1');
    });

    expect(removed).toBe(true);
    expect(result.current.horario).toEqual([]);
  });

  it('proximaClase y clasesDeHoy pasan a través del servicio', async () => {
    fluDbHorarioMock.__seed([
      clase({ id: 'hor-1', materia: 'Quimica', dia: 4, inicio: '12:00', fin: '13:00' }),
    ]);
    const { result } = renderHook(() => useHorario({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const proximaOutcome: { value: HorarioRecord | null } = { value: null };
    const hoyOutcome: { value: HorarioRecord[] } = { value: [] };
    await act(async () => {
      proximaOutcome.value = await result.current.proximaClase(NOW);
      hoyOutcome.value = await result.current.clasesDeHoy(NOW);
    });

    expect(proximaOutcome.value?.materia).toBe('Quimica');
    expect(hoyOutcome.value.map((c) => c.materia)).toEqual(['Quimica']);
  });
});
