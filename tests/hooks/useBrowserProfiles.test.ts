// @vitest-environment jsdom
// ============================================================
// Tests para useBrowserProfiles — Punto 2: Navegador curado
// ============================================================
// El hook usa el singleton fluDb.browserProfiles (Dexie) que NO es
// inyectable, así que se mockea el módulo fluDatabase con una tabla Map
// en memoria (vi.hoisted) para pruebas deterministas. El reloj se
// inyecta vía la opción now del hook y la configuración es la real de
// FLU_CONFIG.browser (la fuente de verdad de producción).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { BrowserProfileRecord } from '../../src/core/db/fluDatabase';
import type { SaveResult } from '../../src/core/browser/browserProfileService';

const { browserProfilesMock } = vi.hoisted(() => {
  type Rec = BrowserProfileRecord;
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
    async get(id: string): Promise<Rec | undefined> {
      const row = map.get(id);
      return row ? clone(row) : undefined;
    },
    async toArray(): Promise<Rec[]> {
      return Array.from(map.values()).map(clone);
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
  return { browserProfilesMock: table };
});

vi.mock('../../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/db/fluDatabase')>(
    '../../src/core/db/fluDatabase',
  );
  return {
    ...actual,
    addAuditLog: vi.fn(async () => undefined as never),
    fluDb: { browserProfiles: browserProfilesMock },
  };
});

import { useBrowserProfiles } from '../../src/hooks/useBrowserProfiles';

// Jueves 15 de enero de 2026, 10:00.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const SYNCHRONIZED_AT = new Date(NOW).toISOString();

// Configuración real de producción (FLU_CONFIG.browser.defaultProfile).
const DEFAULT_PROFILE = {
  categories: ['educacion', 'cuentos'],
  allowlist: ['wikipedia.org', 'educ.ar'],
  readingLevel: 'detallado',
  language: 'es',
  homeTiles: ['educacion', 'cuentos'],
} as const;

// Defaults por rol Estudiante (FLU_CONFIG.browser.defaultsByRole).
const ESTUDIANTE = {
  categories: ['educacion', 'cuentos', 'juegos'],
  allowlist: ['wikipedia.org', 'educ.ar'],
  readingLevel: 'simple',
  language: 'es',
  homeTiles: ['educacion', 'cuentos', 'juegos'],
} as const;

function makeProfile(overrides: Partial<BrowserProfileRecord> = {}): BrowserProfileRecord {
  return {
    id: overrides.id || 'part-1',
    participantId: overrides.participantId || 'part-1',
    participantName: overrides.participantName,
    categories: overrides.categories || [...DEFAULT_PROFILE.categories],
    allowlist: overrides.allowlist || [...DEFAULT_PROFILE.allowlist],
    readingLevel: overrides.readingLevel || DEFAULT_PROFILE.readingLevel,
    language: overrides.language || DEFAULT_PROFILE.language,
    homeTiles: overrides.homeTiles || [...DEFAULT_PROFILE.homeTiles],
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
  };
}

describe('useBrowserProfiles — Punto 2: navegador curado', () => {
  beforeEach(() => {
    browserProfilesMock.__reset();
    vi.clearAllMocks();
  });

  it('carga inicial vacía con loading false', async () => {
    const { result } = renderHook(() => useBrowserProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles).toEqual([]);
  });

  it('carga perfiles sembrados y los ordena por nombre', async () => {
    browserProfilesMock.__seed([
      makeProfile({ id: 'part-2', participantId: 'part-2', participantName: 'Luis' }),
      makeProfile({ id: 'part-1', participantId: 'part-1', participantName: 'Ana' }),
    ]);
    const { result } = renderHook(() => useBrowserProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles.map((p) => p.participantName)).toEqual(['Ana', 'Luis']);
  });

  it('ensure crea un perfil por defecto, lo persiste y refresca', async () => {
    const { result } = renderHook(() => useBrowserProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created: SaveResult | undefined;
    await act(async () => {
      created = await result.current.ensure('part-monse', 'Monse');
    });

    expect(created?.ok).toBe(true);
    expect(created?.record?.participantId).toBe('part-monse');
    expect(created?.record?.participantName).toBe('Monse');
    expect(created?.record?.readingLevel).toBe(DEFAULT_PROFILE.readingLevel);
    expect(created?.record?.sync.revision).toBe(1);
    expect(result.current.profiles.map((p) => p.participantId)).toEqual(['part-monse']);
  });

  it('update cambia categorías y nivel, persiste y refresca', async () => {
    browserProfilesMock.__seed([
      makeProfile({
        id: 'part-monse',
        participantId: 'part-monse',
        participantName: 'Monse',
        sync: { revision: 3, updated_at: SYNCHRONIZED_AT, deleted: false },
      }),
    ]);
    const { result } = renderHook(() => useBrowserProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updated: SaveResult | undefined;
    await act(async () => {
      updated = await result.current.update(
        'part-monse',
        { categories: ['cuentos', 'juegos'], readingLevel: 'avanzado' },
        'Monse',
      );
    });

    expect(updated?.ok).toBe(true);
    expect(updated?.record?.categories).toEqual(['cuentos', 'juegos']);
    expect(updated?.record?.readingLevel).toBe('avanzado');
    expect(updated?.record?.sync.revision).toBe(4);
    expect(result.current.profiles[0].categories).toEqual(['cuentos', 'juegos']);
    expect(result.current.profiles[0].readingLevel).toBe('avanzado');
  });

  it('update sin registro previo crea el perfil vía ensure', async () => {
    const { result } = renderHook(() => useBrowserProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let updated: SaveResult | undefined;
    await act(async () => {
      updated = await result.current.update(
        'part-monse',
        { categories: ['educacion', 'cuentos', 'juegos'] },
        'Monse',
      );
    });

    expect(updated?.ok).toBe(true);
    expect(updated?.record?.participantName).toBe('Monse');
    expect(updated?.record?.categories).toEqual(['educacion', 'cuentos', 'juegos']);
    expect(updated?.record?.sync.revision).toBe(1);
    expect(result.current.profiles[0].participantId).toBe('part-monse');
  });

  it('update con rol y sin registro previo conserva los defaults por rol (primer edit)', async () => {
    const { result } = renderHook(() => useBrowserProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Primer edit manual de un Estudiante: solo se tocan categorías.
    let updated: SaveResult | undefined;
    await act(async () => {
      updated = await result.current.update(
        'part-estudiante',
        { categories: ['educacion', 'cuentos'] },
        'Estudiante',
        'Estudiante',
      );
    });

    expect(updated?.ok).toBe(true);
    // Los escalares conservan el rol Estudiante (simple).
    expect(updated?.record?.readingLevel).toBe(ESTUDIANTE.readingLevel);
    expect(updated?.record?.categories).toEqual(['educacion', 'cuentos']);
    expect(updated?.record?.sync.revision).toBe(1);
  });

  it('reset elimina el perfil y devuelve false sin registro', async () => {
    browserProfilesMock.__seed([
      makeProfile({ id: 'part-monse', participantId: 'part-monse', participantName: 'Monse' }),
    ]);
    const { result } = renderHook(() => useBrowserProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.reset('part-monse');
    });

    expect(ok).toBe(true);
    expect(result.current.profiles).toEqual([]);

    let missing = true;
    await act(async () => {
      missing = await result.current.reset('part-inexistente');
    });

    expect(missing).toBe(false);
  });

  it('resolveForSession prioriza manual > rol > default y NO persiste', async () => {
    browserProfilesMock.__seed([
      makeProfile({
        id: 'part-monse',
        participantId: 'part-monse',
        participantName: 'Monse',
        categories: ['musica'],
        allowlist: ['musica.org'],
        readingLevel: 'avanzado',
        language: 'both',
        homeTiles: ['musica'],
      }),
    ]);
    const { result } = renderHook(() => useBrowserProfiles({ now: () => NOW }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Manual: hay registro guardado, gana aunque el rol sugiera otra cosa.
    let manual: Awaited<ReturnType<typeof result.current.resolveForSession>> | undefined;
    await act(async () => {
      manual = await result.current.resolveForSession('part-monse', { role: 'Estudiante', name: 'Monse' });
    });

    expect(manual?.source).toBe('manual');
    expect(manual?.readingLevel).toBe('avanzado');
    expect(manual?.categories).toEqual(['musica']);

    // Rol: sin registro, usa los defaults del rol Estudiante.
    let role: Awaited<ReturnType<typeof result.current.resolveForSession>> | undefined;
    await act(async () => {
      role = await result.current.resolveForSession('part-otro', { role: 'Estudiante' });
    });

    expect(role?.source).toBe('role');
    expect(role?.readingLevel).toBe(ESTUDIANTE.readingLevel);

    // Default: sin registro y sin rol, usa el default global.
    let def: Awaited<ReturnType<typeof result.current.resolveForSession>> | undefined;
    await act(async () => {
      def = await result.current.resolveForSession('part-inexistente');
    });

    expect(def?.source).toBe('default');
    expect(def?.readingLevel).toBe(DEFAULT_PROFILE.readingLevel);

    // El listado no cambió (resolveForSession no persiste).
    expect(result.current.profiles.map((p) => p.participantId)).toEqual(['part-monse']);
  });
});
