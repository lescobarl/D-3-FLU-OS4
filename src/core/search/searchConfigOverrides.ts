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
import { STORAGE_KEYS } from '../config/appConfig';
import type { SearchProviderConfig, SearchResultType } from './searchSession';

/** Overrides de un proveedor individual (por id). */
export interface SearchProviderOverride {
  enabled?: boolean;
  key?: string | null;
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

/**
 * Aplica los overrides sobre la config base (sin mutarla). Los proveedores
 * conservan su flag `enabled` (aunque esté en false) para que el consumidor
 * pueda filtrarlos después; así deshabilitar un proveedor es efectivo.
 */
export function mergeSearchConfig(
  base: SearchRuntimeConfig,
  overrides?: SearchConfigOverrides,
): MergedSearchConfig {
  const ov = overrides || {};
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
    if (!typeOverrides) {
      providers[type] = group.slice();
      continue;
    }
    providers[type] = group.map((provider) => {
      const override = typeOverrides[provider.id || ''];
      if (!override) return provider;
      return {
        ...provider,
        enabled: override.enabled ?? provider.enabled,
        key: override.key !== undefined ? override.key : provider.key,
        maxResults: override.maxResults ?? provider.maxResults,
        timeoutMs: override.timeoutMs ?? provider.timeoutMs,
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

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

/** Carga los overrides persistidos ({} si no hay o hay error). */
export function loadSearchConfigOverrides(): SearchConfigOverrides {
  if (!storageAvailable()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.SEARCH_CONFIG_OVERRIDES);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SearchConfigOverrides;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Persiste los overrides (ignora errores de almacenamiento). */
export function saveSearchConfigOverrides(overrides: SearchConfigOverrides): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEYS.SEARCH_CONFIG_OVERRIDES,
      JSON.stringify(overrides),
    );
  } catch {
    // sin hardcode ni ruido: el patrón ignora errores de storage
  }
}

/** Borra los overrides persistidos. */
export function clearSearchConfigOverrides(): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEYS.SEARCH_CONFIG_OVERRIDES);
  } catch {
    // ignorar
  }
}

/** Carga el registro de uso diario persistido (null si no hay). */
export function loadDailyUsage(): DailyUsageRecord | null {
  if (!storageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.SEARCH_DAILY_USAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyUsageRecord;
    if (!parsed || typeof parsed.day !== 'string' || typeof parsed.count !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Persiste el registro de uso diario (ignora errores de almacenamiento). */
export function saveDailyUsage(record: DailyUsageRecord): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(STORAGE_KEYS.SEARCH_DAILY_USAGE, JSON.stringify(record));
  } catch {
    // ignorar
  }
}
