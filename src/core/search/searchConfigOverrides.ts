// ============================================================
// searchConfigOverrides.ts — Centro de Control del Buscador (F5)
// ------------------------------------------------------------
// Overrides persistidos por el usuario sobre FLU_CONFIG.browser.search:
//   - proveedores: on/off, key, maxResults, timeoutMs (por id)
//   - tope global por tipo (maxResultsByType), timeoutMs, IA on/off
//   - seguridad: safeSearch, modo supervisado, límite diario
//
// Contiene SOLO lógica pura (mergeSearchConfig, evalDailyUsage) y
// helpers de persistencia en localStorage (patrón useConfigPersistence:
// try/catch que ignora errores de almacenamiento). Sin hardcode de URLs.
// ============================================================
import { STORAGE_KEYS, resolveTextApiKey } from '../config/appConfig';
import type { SearchProviderConfig, SearchResultType } from './searchSession';

/** Overrides de un proveedor individual (por id). */
export interface SearchProviderOverride {
  enabled?: boolean;
  key?: string | null;
  /** Modelo del proveedor (OpenRouter web), editable desde el configurador. */
  model?: string;
  maxResults?: number;
  timeoutMs?: number;
}

/** Overrides de configuración del buscador persistidos por el usuario. */
export interface SearchConfigOverrides {
  /** Overrides por proveedor, agrupados por tipo y clave id. */
  providers?: Partial<Record<SearchResultType, Record<string, SearchProviderOverride>>>;
  /** Tope global por tipo (web/images/video). */
  maxResultsByType?: Partial<Record<SearchResultType, number>>;
  /** Timeout global (ms). */
  timeoutMs?: number;
  /** Habilita/deshabilita el resumen de IA ("Puntos clave"). */
  aiEnabled?: boolean;
  /** Seguridad: conserva solo resultados permitidos por la allowlist. */
  safeSearch?: boolean;
  /** Seguridad: modo supervisado (fuerza safeSearch). */
  supervised?: boolean;
  /** Seguridad: límite diario de búsquedas (0 = sin límite). */
  dailyLimit?: number;
}

/** Config de búsqueda resuelta (la forma que consume el hook). */
export interface SearchRuntimeConfig {
  endpoints: Record<SearchResultType, string>;
  timeoutMs: number;
  maxResultsByType: Record<SearchResultType, number>;
  aiEnabled: boolean;
  maxChars: number;
  /** Nº máximo de resultados que alimentan el resumen determinista. */
  overviewMaxResults: number;
  providers: Record<SearchResultType, SearchProviderConfig[]>;
  errorState: string;
  aiOverviewTitle: string;
  dailyLimitMessage: string;
}

/** Config de búsqueda resuelta + campos de seguridad derivados (F5). */
export interface MergedSearchConfig extends SearchRuntimeConfig {
  safeSearch: boolean;
  supervised: boolean;
  /** Efectivo: safeSearch || supervisado. */
  effectiveSafe: boolean;
  dailyLimit: number;
}

const SEARCH_TYPES: SearchResultType[] = ['web', 'images', 'video'];

/** Parsea un entero positivo; undefined si no es válido (para commit). */
export function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return undefined;
}

/**
 * Fusiona los overrides de proveedores del borrador (Centro de Control)
 * sobre los vigentes, SIN borrar lo que administra otro panel.
 *
 * Reglas:
 * - Nunca reemplaza el grupo completo: parte de `prevProviders` y aplica
 *   campo por campo. Así, si el borrador no trae un tipo/proveedor, se
 *   conserva lo existente (p. ej. la clave/modelo que escribió "Búsqueda web").
 * - Los proveedores con `externalConfig` conservan su `key`/`model` vigentes
 *   (los edita "Búsqueda web", no el Centro de Control).
 * - `enabled`/`maxResults`/`timeoutMs` se normalizan contra la config base.
 */
export function applyProviderOverrides(
  prevProviders: SearchConfigOverrides['providers'],
  baseProviders: Record<SearchResultType, SearchProviderConfig[]>,
  draftProviders: SearchConfigOverrides['providers'],
): SearchConfigOverrides['providers'] {
  const result: NonNullable<SearchConfigOverrides['providers']> = {};
  for (const type of SEARCH_TYPES) {
    const prevGroup = prevProviders?.[type] || {};
    const group: Record<string, SearchProviderOverride> = { ...prevGroup };
    const draftGroup = draftProviders?.[type];
    if (!draftGroup) {
      // El borrador no toca este tipo: conserva lo vigente.
      if (Object.keys(group).length > 0) result[type] = group;
      continue;
    }
    for (const provider of baseProviders[type] || []) {
      const id = provider.id || '';
      const ov = draftGroup[id];
      if (!ov) continue;
      const out: SearchProviderOverride = { ...(group[id] || {}) };
      if (ov.enabled !== undefined) {
        if (ov.enabled !== (provider.enabled !== false)) out.enabled = ov.enabled;
        else delete out.enabled;
      }
      if (provider.externalConfig !== true) {
        if (typeof ov.key === 'string' && ov.key.trim() !== '') out.key = ov.key.trim();
        else delete out.key;
        if (
          typeof ov.model === 'string' &&
          ov.model.trim() !== '' &&
          ov.model.trim() !== provider.model
        ) {
          out.model = ov.model.trim();
        } else {
          delete out.model;
        }
      }
      const maxResults = parsePositiveInt(ov.maxResults);
      if (maxResults !== undefined && maxResults !== provider.maxResults) out.maxResults = maxResults;
      else delete out.maxResults;
      const timeoutMs = parsePositiveInt(ov.timeoutMs);
      if (timeoutMs !== undefined && timeoutMs !== provider.timeoutMs) out.timeoutMs = timeoutMs;
      else delete out.timeoutMs;
      if (Object.keys(out).length > 0) group[id] = out;
      else delete group[id];
    }
    if (Object.keys(group).length > 0) result[type] = group;
  }
  return result;
}

/**
 * Aplica los overrides sobre la config base (sin mutarla). Los proveedores
 * conservan su flag `enabled` (aunque esté en false) para que el consumidor
 * pueda filtrarlos después; así deshabilitar un proveedor es efectivo.
 */
/**
 * Clave de OpenRouter tomada del resolver central (localStorage > env). Es la
 * misma fuente que el chat/imagen; se lee en cada llamada para que los tests
 * puedan stubbear el entorno.
 */
function envOpenRouterKey(): string {
  try {
    return resolveTextApiKey();
  } catch {
        console.warn('[catch] src/core/search/searchConfigOverrides.ts');
    return '';
  }
}

export function mergeSearchConfig(
  base: SearchRuntimeConfig,
  overrides?: SearchConfigOverrides,
): MergedSearchConfig {
  const ov = overrides || {};
  const envKey = envOpenRouterKey();
  const safeSearch = Boolean(ov.safeSearch);
  const supervised = Boolean(ov.supervised);
  const dailyLimit =
    typeof ov.dailyLimit === 'number' && ov.dailyLimit >= 0 ? ov.dailyLimit : 0;

  const maxResultsByType: Record<SearchResultType, number> = {
    web: ov.maxResultsByType?.web ?? base.maxResultsByType.web,
    images: ov.maxResultsByType?.images ?? base.maxResultsByType.images,
    video: ov.maxResultsByType?.video ?? base.maxResultsByType.video,
  };

  const providers = {} as Record<SearchResultType, SearchProviderConfig[]>;
  for (const type of SEARCH_TYPES) {
    const group = base.providers[type] || [];
    const typeOverrides = ov.providers?.[type];
    providers[type] = group.map((provider) => {
      const override = typeOverrides?.[provider.id || ''];
      // Respaldo: si no hay clave en la UI, el proveedor openrouter usa la del .env.
      const fallbackKey =
        provider.id === 'openrouter' && envKey ? envKey : provider.key;
      return {
        ...provider,
        enabled: override?.enabled ?? provider.enabled,
        key: override?.key !== undefined ? override.key : fallbackKey,
        model: override?.model ?? provider.model,
        maxResults: override?.maxResults ?? provider.maxResults,
        timeoutMs: override?.timeoutMs ?? provider.timeoutMs,
      };
    });
  }

  return {
    ...base,
    timeoutMs: ov.timeoutMs ?? base.timeoutMs,
    maxResultsByType,
    aiEnabled: ov.aiEnabled ?? base.aiEnabled,
    providers,
    safeSearch,
    supervised,
    effectiveSafe: safeSearch || supervised,
    dailyLimit,
  };
}

/** Registro de uso diario de búsquedas (fecha local + contador). */
export interface DailyUsageRecord {
  /** Fecha local YYYY-MM-DD. */
  day: string;
  /** Búsquedas contadas en ese día. */
  count: number;
}

/**
 * Evalúa una búsqueda contra el límite diario (0 = sin límite).
 * Devuelve si quedó bloqueada y el registro de uso que corresponde
 * persistir (función pura, testeable).
 */
export function evalDailyUsage(
  record: DailyUsageRecord | null,
  limit: number,
  today: string,
): { locked: boolean; next: DailyUsageRecord } {
  const current = record && record.day === today ? record : { day: today, count: 0 };
  if (limit > 0 && current.count >= limit) {
    return { locked: true, next: current };
  }
  return { locked: false, next: { day: today, count: current.count + 1 } };
}

const OVERRIDES_STORAGE_KEY = STORAGE_KEYS.SEARCH_CONFIG_OVERRIDES;

/** Último error de almacenamiento (para diagnóstico visible). */
let lastStorageError = '';
export function getLastStorageError(): string {
  return lastStorageError;
}

function safeGet(store: Storage | null | undefined, key: string): string | null {
  try {
    return store ? store.getItem(key) : null;
  } catch {
        console.warn('[catch] src/core/search/searchConfigOverrides.ts');
    return null;
  }
}

/**
 * Lee los overrides con respaldo: localStorage → sessionStorage.
 * Si localStorage está lleno/bloqueado, la config sigue disponible en la
 * sesión (sessionStorage). No se usa cookie: contiene la API key y una cookie
 * viajaría al servidor en cada request (exposición innecesaria).
 */
function readRawOverrides(): string | null {
  if (typeof window === 'undefined') return null;
  const ls = safeGet(window.localStorage, OVERRIDES_STORAGE_KEY);
  if (ls) return ls;
  return safeGet(window.sessionStorage, OVERRIDES_STORAGE_KEY);
}

/** Escribe con respaldo. Devuelve true si algo persistió. */
function writeRawOverrides(value: string): boolean {
  if (typeof window === 'undefined') return false;
  let ok = false;
  try {
    window.localStorage.setItem(OVERRIDES_STORAGE_KEY, value);
    lastStorageError = '';
    ok = true;
  } catch (error) {
    lastStorageError = (error as Error)?.name || 'localStorage error';
    console.warn(
      `[searchConfig] localStorage no disponible (${lastStorageError}); se usa respaldo en sessionStorage.`,
    );
    // Cuota llena/bloqueada: quitar el valor VIEJO para que no opaque al nuevo
    // (removeItem no consume cuota), así la lectura cae a sessionStorage.
    try {
      window.localStorage.removeItem(OVERRIDES_STORAGE_KEY);
    } catch {
        console.warn('[catch] src/core/search/searchConfigOverrides.ts');
      /* si tampoco se puede, la lectura usa sessionStorage */
    }
  }
  try {
    window.sessionStorage.setItem(OVERRIDES_STORAGE_KEY, value);
    ok = true;
  } catch (error) {
        console.warn('[catch] src/core/search/searchConfigOverrides.ts:', error);
    lastStorageError = `${lastStorageError}/${(error as Error)?.name || 'sessionStorage error'}`;
  }
  if (!ok) {
    console.error(
      '[searchConfig] No se pudo persistir la configuración del buscador (localStorage y sessionStorage llenos o bloqueados).',
      lastStorageError,
    );
  }
  return ok;
}

/** Carga los overrides persistidos ({} si no hay o hay error). */
export function loadSearchConfigOverrides(): SearchConfigOverrides {
  const raw = readRawOverrides();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SearchConfigOverrides;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
        console.warn('[catch] src/core/search/searchConfigOverrides.ts');
    return {};
  }
}

/**
 * Persiste los overrides en la primera fuente disponible
 * (localStorage → sessionStorage). Devuelve true si se guardó.
 */
export function saveSearchConfigOverrides(overrides: SearchConfigOverrides): boolean {
  return writeRawOverrides(JSON.stringify(overrides));
}

/** Borra los overrides persistidos de todas las fuentes. */
export function clearSearchConfigOverrides(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(OVERRIDES_STORAGE_KEY);
  } catch {
        console.warn('[catch] src/core/search/searchConfigOverrides.ts');
    /* ignorar */
  }
  try {
    window.sessionStorage.removeItem(OVERRIDES_STORAGE_KEY);
  } catch {
        console.warn('[catch] src/core/search/searchConfigOverrides.ts');
    /* ignorar */
  }
}

/** Carga el registro de uso diario persistido (null si no hay). */
export function loadDailyUsage(): DailyUsageRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.SEARCH_DAILY_USAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyUsageRecord;
    if (!parsed || typeof parsed.day !== 'string' || typeof parsed.count !== 'number') {
      return null;
    }
    return parsed;
  } catch {
        console.warn('[catch] src/core/search/searchConfigOverrides.ts');
    return null;
  }
}

/** Persiste el registro de uso diario (ignora errores de almacenamiento). */
export function saveDailyUsage(record: DailyUsageRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.SEARCH_DAILY_USAGE, JSON.stringify(record));
  } catch {
        console.warn('[catch] src/core/search/searchConfigOverrides.ts');
    // ignorar
  }
}
