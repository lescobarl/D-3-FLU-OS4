// @vitest-environment jsdom
// ============================================================
// Tests para useSearchSites -- Catalogo de sitios del Buscador (F2)
// ------------------------------------------------------------
// useSearchSites orquesta el catalogo dinamico (searchCatalog), que
// es un singleton de modulo sobre la tabla Dexie fluDb.searchSites.
// Se sustituye SOLO la frontera: se mockea el modulo searchCatalog
// (servicio/cache) con estado compartido vi.hoisted, sin tocar el
// modulo bajo prueba. searchCatalog.hydrate/list/CRUD son la unica
// via al almacenamiento, asi que el mock es la frontera real.
// `logCaughtError` se mockea (registro de errores capturados) para
// poder afirmar que la ruta de error se registra.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { SearchSite } from '../src/core/search/searchSiteTypes';

const sc = vi.hoisted(() => ({
  merged: [] as SearchSite[],
  dynamic: [] as SearchSite[],
  hydrateCount: 0,
  listCount: 0,
  hydrateError: null as unknown,
  listError: null as unknown,
  registerResult: { ok: true } as unknown,
  updateResult: { ok: true } as unknown,
  removeResult: true,
  lastRegister: null as unknown,
  lastUpdate: null as unknown,
  lastRemove: null as unknown,
  deriveAllowlistArgs: null as unknown,
  deriveTilesArgs: null as unknown,
}));

vi.mock('../src/lib/caughtError', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/caughtError')>(
    '../src/lib/caughtError',
  );
  return { ...actual, logCaughtError: vi.fn() };
});

vi.mock('../src/core/search/searchCatalog', () => ({
  getSearchSites: () => sc.merged,
  hydrateSearchSites: async () => {
    sc.hydrateCount += 1;
    if (sc.hydrateError) throw sc.hydrateError;
  },
  listDynamicSearchSites: async () => {
    sc.listCount += 1;
    if (sc.listError) throw sc.listError;
    return sc.dynamic;
  },
  registerSearchSite: async (data: SearchSite) => {
    sc.lastRegister = data;
    sc.dynamic = [...sc.dynamic, data];
    sc.merged = [...sc.merged, data];
    return sc.registerResult;
  },
  updateSearchSite: async (id: string, data: SearchSite) => {
    sc.lastUpdate = { id, data };
    sc.dynamic = sc.dynamic.map((s) => (s.dominio === id ? data : s));
    sc.merged = sc.merged.map((s) => (s.dominio === id ? data : s));
    return sc.updateResult;
  },
  removeSearchSite: async (id: string) => {
    sc.lastRemove = id;
    sc.dynamic = sc.dynamic.filter((s) => s.dominio !== id);
    sc.merged = sc.merged.filter((s) => s.dominio !== id);
    return sc.removeResult;
  },
  deriveAllowlist: (categorias: readonly string[], catalogo: readonly SearchSite[]) => {
    sc.deriveAllowlistArgs = { categorias, catalogo };
    return catalogo
      .filter((s) => s.aprobado && s.categorias.some((c) => categorias.includes(c)))
      .map((s) => s.dominio);
  },
  deriveTiles: (categorias: readonly string[], catalogo: readonly SearchSite[]) => {
    sc.deriveTilesArgs = { categorias, catalogo };
    return catalogo
      .filter((s) => s.aprobado && s.categorias.some((c) => categorias.includes(c)))
      .map((s) => ({
        id: s.dominio,
        label: s.label,
        domain: s.dominio,
        category: s.categorias[0] || '',
      }));
  },
}));

import { logCaughtError } from '../src/lib/caughtError';
import { useSearchSites } from '../src/hooks/useSearchSites';

function site(dominio: string, overrides: Partial<SearchSite> = {}): SearchSite {
  return {
    dominio,
    label: overrides.label ?? dominio,
    categorias: overrides.categorias ?? ['educacion'],
    idiomas: overrides.idiomas ?? ['es'],
    nivel: overrides.nivel ?? 'simple',
    aprobado: overrides.aprobado ?? true,
  };
}

function resetSc(): void {
  sc.merged = [];
  sc.dynamic = [];
  sc.hydrateCount = 0;
  sc.listCount = 0;
  sc.hydrateError = null;
  sc.listError = null;
  sc.registerResult = { ok: true };
  sc.updateResult = { ok: true };
  sc.removeResult = true;
  sc.lastRegister = null;
  sc.lastUpdate = null;
  sc.lastRemove = null;
  sc.deriveAllowlistArgs = null;
  sc.deriveTilesArgs = null;
}

async function mountLoaded() {
  const rendered = renderHook(() => useSearchSites());
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

describe('useSearchSites -- catalogo de sitios (F2)', () => {
  beforeEach(() => {
    resetSc();
    vi.clearAllMocks();
  });

  // ---- Bloque: carga inicial ----

  it('carga inicial expone el catalogo fusionado, los dinamicos y sus dominios', async () => {
    sc.merged = [site('builtin.org'), site('dynamic.org')];
    sc.dynamic = [site('dynamic.org')];

    const { result } = await mountLoaded();

    expect(result.current.sites.map((s) => s.dominio)).toEqual(['builtin.org', 'dynamic.org']);
    expect(result.current.dynamic.map((s) => s.dominio)).toEqual(['dynamic.org']);
    expect(result.current.dynamicDomains.has('dynamic.org')).toBe(true);
    expect(result.current.dynamicDomains.has('builtin.org')).toBe(false);
    expect(sc.hydrateCount).toBeGreaterThanOrEqual(1);
    expect(sc.listCount).toBeGreaterThanOrEqual(1);
  });

  it('refresh re-hidrata y refleja el catalogo nuevo en sites y dynamicDomains', async () => {
    sc.merged = [site('viejo.org')];
    sc.dynamic = [];

    const { result } = await mountLoaded();
    expect(result.current.sites.map((s) => s.dominio)).toEqual(['viejo.org']);

    sc.merged = [site('viejo.org'), site('nuevo.org')];
    sc.dynamic = [site('nuevo.org')];

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.sites.map((s) => s.dominio)).toEqual(['viejo.org', 'nuevo.org']);
    expect(result.current.dynamicDomains.has('nuevo.org')).toBe(true);
  });

  // ---- Bloque: errores de refresh (frontera) ----

  it('si hydrate falla registra el error y conserva el catalogo previo', async () => {
    sc.merged = [site('estable.org')];
    sc.dynamic = [];

    const { result } = await mountLoaded();
    const before = result.current.sites;

    sc.hydrateError = new Error('dexie caido');
    sc.merged = [site('no-debe-verse.org')];

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.sites).toBe(before);
    expect(result.current.loading).toBe(false);
    expect(logCaughtError).toHaveBeenCalledWith(
      '[useSearchSites] refresh error',
      expect.any(Error),
    );
  });

  it('si listDynamic falla, sites si se actualiza pero conserva el dynamic previo', async () => {
    sc.merged = [site('a.org')];
    sc.dynamic = [site('a.org')];

    const { result } = await mountLoaded();

    sc.merged = [site('a.org'), site('b.org')];
    sc.dynamic = [site('a.org'), site('b.org')];
    sc.listError = new Error('list fallo');

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.sites.map((s) => s.dominio)).toEqual(['a.org', 'b.org']);
    expect(result.current.dynamic.map((s) => s.dominio)).toEqual(['a.org']);
    expect(logCaughtError).toHaveBeenCalledWith(
      '[useSearchSites] refresh error',
      expect.any(Error),
    );
  });

  // ---- Bloque: CRUD dinamico ----

  it('register delega en el servicio, refresca y expone el nuevo sitio', async () => {
    const { result } = await mountLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.register(site('new.org'));
    });

    expect((sc.lastRegister as SearchSite).dominio).toBe('new.org');
    expect(returned).toBe(sc.registerResult);
    expect(result.current.sites.map((s) => s.dominio)).toEqual(['new.org']);
    expect(result.current.dynamicDomains.has('new.org')).toBe(true);
  });

  it('update delega con id y datos, refresca y devuelve el resultado del servicio', async () => {
    sc.merged = [site('a.org')];
    sc.dynamic = [site('a.org')];

    const { result } = await mountLoaded();
    const editado = site('a.org', { label: 'Editado', aprobado: false });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.update('a.org', editado);
    });

    expect(sc.lastUpdate).toEqual({ id: 'a.org', data: editado });
    expect(returned).toBe(sc.updateResult);
    expect(result.current.sites[0].label).toBe('Editado');
    expect(result.current.sites[0].aprobado).toBe(false);
  });

  it('remove delega, refresca y refleja la baja en sites y dynamicDomains', async () => {
    sc.merged = [site('a.org'), site('b.org')];
    sc.dynamic = [site('b.org')];

    const { result } = await mountLoaded();

    let removed = false;
    await act(async () => {
      removed = await result.current.remove('b.org');
    });

    expect(sc.lastRemove).toBe('b.org');
    expect(removed).toBe(true);
    expect(result.current.sites.map((s) => s.dominio)).toEqual(['a.org']);
    expect(result.current.dynamicDomains.has('b.org')).toBe(false);
  });

  it('remove devuelve false cuando el servicio no elimina nada', async () => {
    sc.merged = [site('a.org')];
    sc.removeResult = false;

    const { result } = await mountLoaded();

    let removed = true;
    await act(async () => {
      removed = await result.current.remove('inexistente.org');
    });

    expect(removed).toBe(false);
    expect(result.current.sites.map((s) => s.dominio)).toEqual(['a.org']);
  });

  // ---- Bloque: derivaciones sobre el catalogo vigente ----

  it('deriveAllowlistFor reenvia las categorias y el catalogo vigente', async () => {
    sc.merged = [
      site('edu.org', { categorias: ['educacion'] }),
      site('juego.org', { categorias: ['juegos'] }),
    ];

    const { result } = await mountLoaded();

    let allowlist: string[] = [];
    act(() => {
      allowlist = result.current.deriveAllowlistFor(['educacion']);
    });

    const args = sc.deriveAllowlistArgs as {
      categorias: readonly string[];
      catalogo: readonly SearchSite[];
    };
    expect(args.categorias).toEqual(['educacion']);
    expect(args.catalogo).toBe(result.current.sites);
    expect(allowlist).toEqual(['edu.org']);
  });

  it('deriveTilesFor usa el catalogo vigente y excluye sitios no aprobados', async () => {
    sc.merged = [
      site('edu.org', { categorias: ['educacion'], label: 'Educa' }),
      site('noaprobado.org', { categorias: ['educacion'], aprobado: false }),
    ];

    const { result } = await mountLoaded();

    let tiles: { domain: string; label: string }[] = [];
    act(() => {
      tiles = result.current.deriveTilesFor(['educacion']);
    });

    expect(tiles.map((t) => t.domain)).toEqual(['edu.org']);
    expect(tiles[0].label).toBe('Educa');
    const args = sc.deriveTilesArgs as {
      categorias: readonly string[];
      catalogo: readonly SearchSite[];
    };
    expect(args.catalogo).toBe(result.current.sites);
  });

  it('las derivaciones usan el catalogo ACTUALIZADO tras un refresh', async () => {
    sc.merged = [site('edu.org', { categorias: ['educacion'] })];

    const { result } = await mountLoaded();

    let first: string[] = [];
    act(() => {
      first = result.current.deriveAllowlistFor(['educacion']);
    });
    expect(first).toEqual(['edu.org']);

    sc.merged = [];
    sc.dynamic = [];
    await act(async () => {
      await result.current.refresh();
    });

    let after: string[] = [];
    act(() => {
      after = result.current.deriveAllowlistFor(['educacion']);
    });

    expect(after).toEqual([]);
    const args = sc.deriveAllowlistArgs as { catalogo: readonly SearchSite[] };
    expect(args.catalogo).toBe(result.current.sites);
  });
});
