// @vitest-environment jsdom
// ============================================================
// Tests para useCommunicationProfiles — personalización profunda (FASE P)
// ============================================================
// El hook usa el singleton fluDb.communicationProfiles (Dexie) que NO es
// inyectable, así que se mockea el módulo fluDatabase con una tabla Map en
// memoria (vi.hoisted) para pruebas deterministas. El reloj se inyecta vía
// la opción now del hook y la configuración es la real de FLU_CONFIG
// (personalization), la fuente de verdad de producción.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { CommunicationProfileRecord } from '../../src/core/db/fluDatabase';

const { communicationProfilesMock } = vi.hoisted(() => {
  type Rec = CommunicationProfileRecord;
  let map = new Map<string, Rec>();
  const clone = (r: Rec): Rec => ({ ...r, sync: { ...r.sync } });
  const table = {
    async add(record: Rec): Promise<unknown> {
      map.set(record.id, clone(record));
      return record.id;
    },
    async put(record: Rec): Promise<unknown> {
      map.set(record.id, clone(record));
      return record.id;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async toArray(): Promise<Rec[]> {
      return Array.from(map.values()).map(clone);
    },
    // API Dexie mínima usada por communicationProfileService.getByParticipant.
    where(field: string): { equals(value: string): { first(): Promise<Rec | undefined> } } {
      return {
        equals(value: string) {
          return {
            async first(): Promise<Rec | undefined> {
              for (const row of map.values()) {
                if ((row as unknown as Record<string, unknown>)[field] === value) return clone(row);
              }
              return undefined;
            },
          };
        },
      };
    },
    __reset(): void {
      map = new Map<string, Rec>();
    },
    __seed(records: Rec[]): void {
      for (const record of records) map.set(record.id, clone(record));
    },
    __all(): Rec[] {
      return Array.from(map.values()).map(clone);
    },
  };
  return { communicationProfilesMock: table };
});

vi.mock('../../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/db/fluDatabase')>(
    '../../src/core/db/fluDatabase',
  );
  return {
    ...actual,
    addAuditLog: vi.fn(async () => undefined as never),
    fluDb: { communicationProfiles: communicationProfilesMock },
  };
});

import { useCommunicationProfiles } from '../../src/hooks/useCommunicationProfiles';

// Jueves 15 de enero de 2026, 10:00.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const SYNCHRONIZED_AT = new Date(NOW).toISOString();

// Configuración real de producción (FLU_CONFIG.personalization).
// defaultTone 'friendly', defaultExplanationLevel 'detallado',
// ttsRateByLevel { simple: 1.05, detallado: 0.95, avanzado: 0.9 }.
const DEFAULTS = {
  explanationLevel: 'detallado',
  tone: 'friendly',
  ttsRateDetallado: 0.95,
} as const;

function makeProfile(overrides: Partial<CommunicationProfileRecord> = {}): CommunicationProfileRecord {
  return {
    id: overrides.id || 'profile-1',
    participantId: overrides.participantId || 'part-1',
    participantName: overrides.participantName,
    explanationLevel: overrides.explanationLevel || DEFAULTS.explanationLevel,
    tone: overrides.tone || DEFAULTS.tone,
    autoExplanationLevel: overrides.autoExplanationLevel,
    autoTone: overrides.autoTone,
    manualExplanationLevel: overrides.manualExplanationLevel,
    manualTone: overrides.manualTone,
    observationCount: overrides.observationCount ?? 0,
    levelObservationCount: overrides.levelObservationCount ?? 0,
    toneObservationCount: overrides.toneObservationCount ?? 0,
    confidence: overrides.confidence ?? 0.15,
    lastObservation: overrides.lastObservation,
    source: overrides.source || 'default',
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
  };
}

describe('useCommunicationProfiles — personalización profunda (FASE P)', () => {
  beforeEach(() => {
    communicationProfilesMock.__reset();
    vi.clearAllMocks();
  });

  it('carga inicial vacía con loading false', async () => {
    const { result } = renderHook(() => useCommunicationProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles).toEqual([]);
  });

  it('carga perfiles sembrados y los ordena por nombre', async () => {
    communicationProfilesMock.__seed([
      makeProfile({ id: 'profile-2', participantId: 'part-2', participantName: 'Luis' }),
      makeProfile({ id: 'profile-1', participantId: 'part-1', participantName: 'Ana' }),
    ]);
    const { result } = renderHook(() => useCommunicationProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles.map((p) => p.participantName)).toEqual(['Ana', 'Luis']);
  });

  it('ensure crea un perfil por defecto, lo persiste y refresca', async () => {
    const { result } = renderHook(() => useCommunicationProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created: CommunicationProfileRecord | undefined;
    await act(async () => {
      created = await result.current.ensure('part-monse', 'Monse');
    });

    expect(created?.participantId).toBe('part-monse');
    expect(created?.participantName).toBe('Monse');
    expect(created?.source).toBe('default');
    expect(created?.confidence).toBeCloseTo(0.15);
    expect(created?.sync.revision).toBe(1);
    expect(result.current.profiles.map((p) => p.participantId)).toEqual(['part-monse']);
  });

  it('setManual fija nivel y tono con prioridad máxima, persiste y refresca', async () => {
    const { result } = renderHook(() => useCommunicationProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updated: CommunicationProfileRecord | undefined;
    await act(async () => {
      updated = await result.current.setManual(
        'part-monse',
        { explanationLevel: 'avanzado', tone: 'formal' },
        'Monse',
      );
    });

    expect(updated?.manualExplanationLevel).toBe('avanzado');
    expect(updated?.manualTone).toBe('formal');
    expect(updated?.explanationLevel).toBe('avanzado');
    expect(updated?.tone).toBe('formal');
    expect(updated?.source).toBe('manual');
    expect(updated?.confidence).toBeCloseTo(0.95);
    expect(updated?.sync.revision).toBe(1);
    expect(result.current.profiles[0].manualExplanationLevel).toBe('avanzado');
  });

  it('setManual sobre un registro existente sube la revisión sync', async () => {
    communicationProfilesMock.__seed([
      makeProfile({
        id: 'profile-1',
        participantId: 'part-monse',
        participantName: 'Monse',
        sync: { revision: 3, updated_at: SYNCHRONIZED_AT, deleted: false },
      }),
    ]);
    const { result } = renderHook(() => useCommunicationProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updated: CommunicationProfileRecord | undefined;
    await act(async () => {
      updated = await result.current.setManual('part-monse', { tone: 'calm' });
    });

    expect(updated?.sync.revision).toBe(4);
    expect(updated?.tone).toBe('calm');
    expect(result.current.profiles[0].sync.revision).toBe(4);
  });

  it('resetPerson quita el manual, re-resuelve a default y refresca', async () => {
    communicationProfilesMock.__seed([
      makeProfile({
        id: 'profile-1',
        participantId: 'part-monse',
        participantName: 'Monse',
        manualExplanationLevel: 'avanzado',
        manualTone: 'formal',
        explanationLevel: 'avanzado',
        tone: 'formal',
        confidence: 0.95,
        source: 'manual',
      }),
    ]);
    const { result } = renderHook(() => useCommunicationProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.resetPerson('part-monse');
    });

    expect(ok).toBe(true);
    const profile = result.current.profiles[0];
    expect(profile.manualExplanationLevel).toBeUndefined();
    expect(profile.manualTone).toBeUndefined();
    expect(profile.explanationLevel).toBe(DEFAULTS.explanationLevel);
    expect(profile.tone).toBe(DEFAULTS.tone);
    expect(profile.source).toBe('default');
    expect(profile.confidence).toBeCloseTo(0.15);
  });

  it('applyObservation fusiona con señal (persiste y refresca) y devuelve null sin señal', async () => {
    const { result } = renderHook(() => useCommunicationProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const withSignal: { value: CommunicationProfileRecord | null } = { value: null };
    await act(async () => {
      withSignal.value = await result.current.applyObservation('part-monse', 'dame más detalle por favor', 'Monse');
    });

    expect(withSignal.value).not.toBeNull();
    expect(withSignal.value?.observationCount).toBe(1);
    expect(withSignal.value?.levelObservationCount).toBe(1);
    expect(withSignal.value?.autoExplanationLevel).toBe('detallado');
    expect(withSignal.value?.source).toBe('auto');
    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.profiles[0].observationCount).toBe(1);

    const withoutSignal: { value: CommunicationProfileRecord | null } = { value: null };
    await act(async () => {
      withoutSignal.value = await result.current.applyObservation('part-monse', 'hola que tal');
    });

    expect(withoutSignal.value).toBeNull();
    expect(result.current.profiles[0].observationCount).toBe(1);
  });

  it('resolveForTurn pasa a través (manual > auto > default) y NO persiste', async () => {
    communicationProfilesMock.__seed([
      makeProfile({
        id: 'profile-1',
        participantId: 'part-monse',
        participantName: 'Monse',
        manualExplanationLevel: 'simple',
        explanationLevel: 'simple',
        source: 'manual',
        confidence: 0.95,
      }),
    ]);
    const { result } = renderHook(() => useCommunicationProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolved: Awaited<ReturnType<typeof result.current.resolveForTurn>> | undefined;
    await act(async () => {
      resolved = await result.current.resolveForTurn('part-monse');
    });

    expect(resolved?.explanationLevel).toBe('simple');
    expect(resolved?.source).toBe('manual');
    expect(resolved?.ttsRate).toBeCloseTo(1.05);
    // El listado no cambió (resolveForTurn no persiste).
    expect(result.current.profiles.map((p) => p.participantId)).toEqual(['part-monse']);

    // Persona sin registro: cae a default sin crear nada.
    let missing: Awaited<ReturnType<typeof result.current.resolveForTurn>> | undefined;
    await act(async () => {
      missing = await result.current.resolveForTurn('part-inexistente');
    });

    expect(missing?.explanationLevel).toBe(DEFAULTS.explanationLevel);
    expect(missing?.tone).toBe(DEFAULTS.tone);
    expect(missing?.ttsRate).toBeCloseTo(DEFAULTS.ttsRateDetallado);
    expect(missing?.source).toBe('default');
    expect(result.current.profiles.map((p) => p.participantId)).toEqual(['part-monse']);
  });
});
