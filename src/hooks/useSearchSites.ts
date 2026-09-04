// ============================================================
// useSearchSites — Punto 2: Catálogo de sitios del Buscador (F2)
// ------------------------------------------------------------
// Hook que expone el catálogo dinámico de sitios de búsqueda
// sobre Dexie (fluDb.searchSites) vía searchCatalog.ts.
//
// A diferencia de useBrowserProfiles, searchCatalog es un
// singleton de módulo (registry + caché fusionada), por lo que
// NO se necesita serviceRef ni DI: el hook solo orquesta el
// refresh y el estado React.
//
// Cumple:
//   - Regla #1: NO HARDCODE — labels y defaults desde
//     FLU_CONFIG.browser (fuente de verdad)
//   - Obligación #5: auditoría (la hace searchCatalog/catalogRegistry)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace el registry)
//   - F2: agregar un sitio al catálogo = aparece en voz, barra,
//     tiles y resultados sin tocar código (deriveAllowlist/deriveTiles)
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSearchSites,
  hydrateSearchSites,
  listDynamicSearchSites,
  registerSearchSite,
  removeSearchSite,
  updateSearchSite,
  deriveAllowlist,
  deriveTiles,
} from '../core/search/searchCatalog';
import type { SearchSite, SearchSiteTile } from '../core/search/searchSiteTypes';
import type { RegisterResult, UpdateResult } from '../core/catalogs/catalogRegistry';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseSearchSitesState {
  /** Catálogo fusionado vigente (built-ins + dinámicos), keyed por dominio. */
  sites: readonly SearchSite[];
  /** Solo los sitios dinámicos persistidos (sin built-ins). */
  dynamic: SearchSite[];
  /** Set de dominios dinámicos (para distinguir built-ins en la UI). */
  dynamicDomains: ReadonlySet<string>;
  loading: boolean;
}

export interface UseSearchSitesActions {
  /** Re-hidrata la caché fusionada y actualiza el estado. */
  refresh: () => Promise<void>;
  /** Registra un sitio dinámico y refresca la caché. */
  register: (data: SearchSite) => Promise<RegisterResult<SearchSite>>;
  /** Actualiza un sitio dinámico y refresca la caché. */
  update: (id: string, data: SearchSite) => Promise<UpdateResult<SearchSite>>;
  /** Elimina un sitio dinámico y refresca la caché. */
  remove: (id: string) => Promise<boolean>;
  /** Deriva la allowlist desde el catálogo para unas categorías dadas. */
  deriveAllowlistFor: (categorias: readonly string[]) => string[];
  /** Deriva los tiles de inicio desde el catálogo para unas categorías dadas. */
  deriveTilesFor: (categorias: readonly string[]) => SearchSiteTile[];
}

export interface UseSearchSitesResult extends UseSearchSitesState, UseSearchSitesActions {}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useSearchSites(): UseSearchSitesResult {
  const [sites, setSites] = useState<readonly SearchSite[]>(() => getSearchSites());
  const [dynamic, setDynamic] = useState<SearchSite[]>([]);
  const [loading, setLoading] = useState(true);

  /** Re-hidrata la caché fusionada y actualiza el estado React. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      await hydrateSearchSites();
      setSites(getSearchSites());
      setDynamic(await listDynamicSearchSites());
    } catch (err) {
      console.error('[useSearchSites] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  /** Registra un sitio dinámico y refresca (aparece en voz, barra, tiles y resultados). */
  const register = useCallback(
    async (data: SearchSite): Promise<RegisterResult<SearchSite>> => {
      const result = await registerSearchSite(data);
      await refresh();
      return result;
    },
    [refresh],
  );

  /** Actualiza un sitio dinámico y refresca. */
  const update = useCallback(
    async (id: string, data: SearchSite): Promise<UpdateResult<SearchSite>> => {
      const result = await updateSearchSite(id, data);
      await refresh();
      return result;
    },
    [refresh],
  );

  /** Elimina un sitio dinámico y refresca. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const removed = await removeSearchSite(id);
      await refresh();
      return removed;
    },
    [refresh],
  );

  /** Deriva la allowlist (sitios aprobados de las categorías activas). */
  const deriveAllowlistFor = useCallback(
    (categorias: readonly string[]): string[] => deriveAllowlist(categorias, sites),
    [sites],
  );

  /** Deriva los tiles de inicio (mismo contrato que browser.panel.tiles). */
  const deriveTilesFor = useCallback(
    (categorias: readonly string[]): SearchSiteTile[] => deriveTiles(categorias, sites),
    [sites],
  );

  /** Dominios dinámicos para distinguir built-ins en la UI. */
  const dynamicDomains = useMemo(
    () => new Set(dynamic.map((site) => site.dominio)),
    [dynamic],
  );

  return {
    sites,
    dynamic,
    dynamicDomains,
    loading,
    refresh,
    register,
    update,
    remove,
    deriveAllowlistFor,
    deriveTilesFor,
  };
}
