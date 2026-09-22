// ============================================================
// SearchControlCenter — Fase 5: Centro de Control del Buscador
// ------------------------------------------------------------
// Panel "Buscador y catálogo" (Configuración → Gestión). Integra:
//   1. Proveedores: on/off, key, máx. resultados, timeout. Se
//      persisten como overrides sobre la config (patrón
//      handleParticipantConfigChange / profile service).
//   2. Catálogo de sitios: tabla CRUD (embebe SearchCatalogPanel).
//   3. Categorías: vista config-driven con cantidad de sitios por
//      categoría (los tiles del inicio se derivan solos).
//   4. Idiomas y nivel: tabla de defaults por rol (defaultsByRole).
//   5. Seguridad: safeSearch / supervisado / límite diario.
//   6. Vista previa (dev): consulta de prueba (resultados + IA)
//      antes de confirmar la configuración.
//
// Regla #1: sin hardcode — todas las etiquetas viven en
// FLU_CONFIG.browser.search.ui (+ browser.ui / browser.catalog /
// browser.categories / browser.defaultsByRole) con fallback `|| '...'`.
// No contiene URLs literales. Presentacional: App inyecta estado y
// acciones (mismo patrón que SearchCatalogPanel / AmbientesPanel).
//
// Patrón draft → commit: los inputs editan un borrador local; al
// guardar se normalizan (solo se persisten valores que difieren de la
// config base) y se emite onChange(next). Los placeholders muestran el
// valor efectivo de la config, de modo que los valores base NUNCA se
// duplican en localStorage.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { asConfigNode, configTextMap } from './configText';
import {
  buildRuntimeConfig,
  fetchAiOverview,
  fetchTypeResults,
  resolveMergedSearchConfig,
} from '../hooks/useWorkspaceSearch';
import {
  applyProviderOverrides,
  mergeSearchConfig,
  parsePositiveInt,
  type SearchConfigOverrides,
  type SearchProviderOverride,
} from '../core/search/searchConfigOverrides';
import type {
  SearchProviderConfig,
  SearchResult,
  SearchResultType,
} from '../core/search/searchSession';
import type { SearchSite } from '../core/search/searchSiteTypes';
import type { RegisterResult, UpdateResult } from '../core/catalogs/catalogRegistry';
import { SearchCatalogPanel } from './SearchCatalogPanel';
import { useSettingsSaveRegistration } from './SettingsSaveContext';
import { logCaughtError } from '../lib/caughtError';

export interface SearchControlCenterProps {
  /** Overrides persistidos vigentes (cargados en App). */
  overrides: SearchConfigOverrides;
  /** Persiste los overrides. Acepta un objeto o un updater `(prev) => next`
   *  para que varios commits de la barra global compongan sin pisarse. */
  onChange: (
    next: SearchConfigOverrides | ((prev: SearchConfigOverrides) => SearchConfigOverrides),
  ) => void;
  /** Restablece los overrides a la config base (App: limpiar storage + audit). */
  onReset?: () => void;
  /** Allowlist curada del perfil (para la vista previa segura). */
  allowlist?: readonly string[];
  /** Catálogo fusionado vigente (built-ins + dinámicos). */
  sites: readonly SearchSite[];
  /** Dominios de sitios dinámicos (editables/borrables). */
  dynamicDomains: ReadonlySet<string>;
  loading: boolean;
  onRegister: (data: SearchSite) => Promise<RegisterResult<SearchSite>>;
  onUpdate: (id: string, data: SearchSite) => Promise<UpdateResult<SearchSite>>;
  onRemove: (id: string) => Promise<boolean>;
}

const SEARCH_TYPES: SearchResultType[] = ['web', 'images', 'video'];

/** Convierte un valor numérico de override a texto para los inputs. */
function numText(value: number | string | undefined): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

interface PreviewState {
  state: 'idle' | 'loading' | 'error' | 'done';
  results: SearchResult[];
  ai: string;
}

const PREVIEW_IDLE: PreviewState = { state: 'idle', results: [], ai: '' };

export function SearchControlCenter({
  overrides,
  onChange,
  onReset,
  allowlist,
  sites,
  dynamicDomains,
  loading,
  onRegister,
  onUpdate,
  onRemove,
}: SearchControlCenterProps) {
  // Labels config-driven (Regla #1: sin hardcode).
  const ui = useMemo<Record<string, string>>(
    () => configTextMap(FLU_CONFIG.browser?.search?.ui),
    [],
  );
  const browserUi = useMemo<Record<string, string>>(
    () => configTextMap(FLU_CONFIG.browser?.ui),
    [],
  );
  const browserCatalog = useMemo<Record<string, string>>(
    () => configTextMap(FLU_CONFIG.browser?.catalog),
    [],
  );
  const categories = useMemo<Record<string, string>>(
    () => configTextMap(FLU_CONFIG.browser?.categories),
    [],
  );
  const defaultsByRole = useMemo<Record<string, Record<string, unknown>>>(
    () => {
      const out: Record<string, Record<string, unknown>> = {};
      const src = asConfigNode(FLU_CONFIG.browser?.defaultsByRole);
      if (src) {
        for (const [role, value] of Object.entries(src)) {
          const node = asConfigNode(value);
          if (node) out[role] = { ...node };
        }
      }
      return out;
    },
    [],
  );

  const label = (key: string, fallback: string): string => ui[key] || fallback;

  // Config base RAW (sin filtrar) para renderizar TODOS los proveedores.
  const runtime = useMemo(() => buildRuntimeConfig(), []);

  // Borrador local; se commit-a recién al guardar.
  const [draft, setDraft] = useState<SearchConfigOverrides>(overrides);
  const [dailyLimitText, setDailyLimitText] = useState(() =>
    overrides.dailyLimit !== undefined ? String(overrides.dailyLimit) : '',
  );
  const [previewQuery, setPreviewQuery] = useState('');
  const [preview, setPreview] = useState<PreviewState>(PREVIEW_IDLE);

  // Sincroniza el borrador cuando App persiste un cambio (post-save/reset).
  useEffect(() => {
    setDraft(overrides);
    setDailyLimitText(overrides.dailyLimit !== undefined ? String(overrides.dailyLimit) : '');
  }, [overrides]);

  // Config efectiva (base + borrador) para mostrar valores reales en UI.
  const merged = useMemo(() => mergeSearchConfig(runtime, draft), [runtime, draft]);

  // Cantidad de sitios por categoría (vista Categorías).
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    sites.forEach((site) => {
      site.categorias.forEach((cat) => {
        counts[cat] = (counts[cat] || 0) + 1;
      });
    });
    return counts;
  }, [sites]);

  const draftProvider = (type: SearchResultType, id: string): SearchProviderOverride =>
    draft.providers?.[type]?.[id] || {};

  const setProviderField = (
    type: SearchResultType,
    id: string,
    field: keyof SearchProviderOverride,
    value: unknown,
  ): void => {
    setDraft((prev) => {
      const providers = { ...(prev.providers || {}) };
      const group = { ...(providers[type] || {}) };
      const entry: SearchProviderOverride = { ...(group[id] || {}) };
      Reflect.set(entry, field, value);
      group[id] = entry;
      providers[type] = group;
      return { ...prev, providers };
    });
  };

  const setSecurity = (field: 'safeSearch' | 'supervised', value: boolean): void => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  /**
   * Normaliza el borrador a overrides limpios: solo persiste valores que
   * difieren de la config base. Los numéricos se parsean a entero positivo;
   * el límite diario usa 0 (sin límite) si no hay valor válido.
   */
  const handleSave = (): void => {
    onChange((prev) => {
      // Merge campo a campo (no reemplaza el grupo): conserva lo que
      // administra "Búsqueda web" y otros paneles.
      const providers = applyProviderOverrides(prev.providers, runtime.providers, draft.providers);

      const next: SearchConfigOverrides = { ...prev };
      if (providers && Object.keys(providers).length > 0) {
        next.providers = providers;
      } else {
        delete next.providers;
      }
      if (draft.safeSearch !== undefined) next.safeSearch = draft.safeSearch;
      else delete next.safeSearch;
      if (draft.supervised !== undefined) next.supervised = draft.supervised;
      else delete next.supervised;
      const dailyLimit = parsePositiveInt(dailyLimitText);
      if (dailyLimit !== undefined) next.dailyLimit = dailyLimit;
      else delete next.dailyLimit;

      return next;
    });
  };

  const handleReset = (): void => {
    setDraft({});
    setDailyLimitText('');
    setPreviewQuery('');
    setPreview(PREVIEW_IDLE);
    if (onReset) {
      onReset();
    } else {
      onChange({});
    }
  };

  // Guardar/Restablecer GLOBAL del configurador (barra al pie de Configuración).
  useSettingsSaveRegistration('search-control', { commit: handleSave, reset: handleReset });

  /**
   * Vista previa (dev): ejecuta la consulta contra el proxy con la config
   * efectiva del borrador (safeSearch / allowlist / proveedores / topes) y
   * el resumen de IA. La IA es best-effort: si falla no rompe la preview.
   */
  const handleRunPreview = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const q = previewQuery.trim();
    if (!q) return;
    const resolved = resolveMergedSearchConfig(draft);
    const baseParams = new URLSearchParams();
    baseParams.set('q', q);
    baseParams.set('lang', 'es');
    if (resolved.effectiveSafe) baseParams.set('safe', '1');
    if (allowlist && allowlist.length > 0) baseParams.set('allowlist', allowlist.join(','));
    setPreview({ state: 'loading', results: [], ai: '' });
    try {
      const fetched = await fetchTypeResults(
        resolved.endpoints.web,
        'web',
        resolved.providers.web,
        baseParams,
        resolved.timeoutMs,
        resolved.maxResultsByType.web,
      );
      if (!fetched.ok) {
        setPreview({ state: 'error', results: [], ai: '' });
        return;
      }
      let ai = '';
      if (resolved.aiEnabled) {
        ai = await fetchAiOverview(q, 'es', resolved.maxChars, resolved.aiOverviewTitle);
      }
      setPreview({ state: 'done', results: fetched.results, ai });
    } catch {
        logCaughtError('[catch] src/components/SearchControlCenter.tsx');
      setPreview({ state: 'error', results: [], ai: '' });
    }
  };

  const groupLabel = (type: SearchResultType): string => {
    const key =
      type === 'web'
        ? 'providerGroupWeb'
        : type === 'images'
          ? 'providerGroupImages'
          : 'providerGroupVideo';
    return label(key, type);
  };

  const languageLabel = (lang: string): string => browserCatalog[`lang_${lang}`] || lang;

  return (
    <details className="flu-settings-image-config">
      <summary className="flu-settings-image-config__summary">
        {label('searchControlTitle', 'Buscador y catálogo')}
      </summary>
      <div className="flu-settings-image-config__group">
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <p className="flu-settings-image-config__hint">
              {label('searchControlIntro', 'Configurá proveedores, catálogo, seguridad y vista previa del buscador.')}
            </p>
          </div>
        </div>

        {/* 1. Catálogo de sitios (CRUD embebido) — fuente de verdad de la allowlist */}
        <SearchCatalogPanel
          sites={sites}
          dynamicDomains={dynamicDomains}
          loading={loading}
          onRegister={onRegister}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />

        {/* 2. Categorías (vista config-driven) */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{label('categoriesSection', 'Categorías')}</h4>
            <p className="flu-settings-image-config__hint">
              {label('categoriesHint', 'Las categorías del catálogo y cuántos sitios tiene cada una. Los tiles del inicio se derivan automáticamente.')}
            </p>
            <ul className="flu-reminders-list" data-testid="search-categories-list">
              {Object.entries(categories).map(([key, categoryLabel]) => (
                <li key={key} className="flu-reminders-item flu-reminders-item--with-profile">
                  <div className="flu-reminders-item__info">
                    <span className="flu-reminders-item__text">{categoryLabel}</span>
                    <span className="flu-reminders-item__when">
                      {categoryCounts[key] || 0} {label('siteCountWord', 'sitios')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 3. Idiomas y nivel (defaults por rol) */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{label('languageLevelSection', 'Idiomas y nivel')}</h4>
            <p className="flu-settings-image-config__hint">
              {label('languageLevelHint', 'Idioma y nivel de lectura por rol; los sitios del catálogo los usan por defecto al resolver la búsqueda.')}
            </p>
            <div className="flu-reminders-list" data-testid="search-roles-list">
              {Object.entries(defaultsByRole).map(([role, roleCfg]) => {
                const lang = String(roleCfg.language || 'es');
                const level = String(roleCfg.readingLevel || 'simple');
                const langText = languageLabel(lang);
                const levelText = browserUi[`level_${level}`] || level;
                return (
                  <div key={role} className="flu-reminders-item flu-reminders-item--with-profile">
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">{role}</span>
                      <span className="flu-reminders-item__when">
                        {label('roleColumnLabel', 'Rol')}: {role} ·{' '}
                        {browserUi.languageLabel || 'Idioma'}: {langText} ·{' '}
                        {browserUi.readingLevelLabel || 'Nivel de lectura'}: {levelText}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 4. Proveedores (motores de búsqueda) */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{label('providersSection', 'Proveedores')}</h4>
            {SEARCH_TYPES.map((type) => {
              const list = merged.providers[type] || [];
              if (list.length === 0) return null;
              return (
                <div key={type} className="flu-settings-section">
                  <h5 className="flu-reminders__heading">{groupLabel(type)}</h5>
                  <div className="flu-reminders-list">
                    {list.map((provider: SearchProviderConfig) => {
                      const id = provider.id || '';
                      const ov = draftProvider(type, id);
                      return (
                        <div
                          key={id || type}
                          className="flu-reminders-item flu-reminders-item--with-profile"
                          data-testid={`search-provider-${type}-${id}`}
                        >
                          <div className="flu-reminders-item__info">
                            <span className="flu-reminders-item__text">{provider.label || id}</span>
                            <label className="flu-browser-profile__check">
                              <input
                                type="checkbox"
                                checked={provider.enabled !== false}
                                data-testid={`search-provider-enabled-${type}-${id}`}
                                onChange={(e) =>
                                  setProviderField(type, id, 'enabled', e.target.checked)
                                }
                              />
                              {label('providerEnabled', 'Habilitado')}
                            </label>
                          </div>
                          <div className="flu-browser-profile__row flu-browser-profile__row--wrap">
                            {provider.externalConfig !== true && (
                              <label className="flu-browser-profile__field">
                                <span className="flu-settings-image-config__hint">
                                  {label('providerKey', 'Clave (API)')}
                                </span>
                                <input
                                  type="text"
                                  value={typeof ov.key === 'string' ? ov.key : ''}
                                  placeholder={
                                    provider.key
                                      ? String(provider.key)
                                      : label('providerKeyPlaceholder', 'Dejalo vacío para usar la config')
                                  }
                                  data-testid={`search-provider-key-${type}-${id}`}
                                  onChange={(e) => setProviderField(type, id, 'key', e.target.value)}
                                />
                              </label>
                            )}
                            {provider.externalConfig !== true && provider.model !== undefined && (
                              <label className="flu-browser-profile__field">
                                <span className="flu-settings-image-config__hint">
                                  {label('providerModel', 'Modelo')}
                                </span>
                                <input
                                  type="text"
                                  style={{ fontFamily: 'monospace' }}
                                  value={typeof ov.model === 'string' ? ov.model : ''}
                                  placeholder={String(provider.model || '')}
                                  data-testid={`search-provider-model-${type}-${id}`}
                                  onChange={(e) => setProviderField(type, id, 'model', e.target.value)}
                                />
                              </label>
                            )}
                            <label className="flu-browser-profile__field">
                              <span className="flu-settings-image-config__hint">
                                {label('providerMaxResults', 'Máx. resultados')}
                              </span>
                              <input
                                type="number"
                                min={1}
                                value={numText(ov.maxResults)}
                                placeholder={numText(provider.maxResults)}
                                data-testid={`search-provider-max-${type}-${id}`}
                                onChange={(e) =>
                                  setProviderField(type, id, 'maxResults', e.target.value)
                                }
                              />
                            </label>
                            <label className="flu-browser-profile__field">
                              <span className="flu-settings-image-config__hint">
                                {label('providerTimeout', 'Timeout (ms)')}
                              </span>
                              <input
                                type="number"
                                min={1}
                                value={numText(ov.timeoutMs)}
                                placeholder={numText(provider.timeoutMs)}
                                data-testid={`search-provider-timeout-${type}-${id}`}
                                onChange={(e) =>
                                  setProviderField(type, id, 'timeoutMs', e.target.value)
                                }
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 5. Seguridad (filtrado de resultados) */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{label('securitySection', 'Seguridad')}</h4>
            <div className="flu-browser-profile__row flu-browser-profile__row--wrap">
              <label className="flu-browser-profile__check">
                <input
                  type="checkbox"
                  checked={merged.safeSearch}
                  data-testid="search-security-safesearch"
                  onChange={(e) => setSecurity('safeSearch', e.target.checked)}
                />
                {label('safeSearchLabel', 'Búsqueda segura (solo dominios permitidos)')}
              </label>
              <label className="flu-browser-profile__check">
                <input
                  type="checkbox"
                  checked={merged.supervised}
                  data-testid="search-security-supervised"
                  onChange={(e) => setSecurity('supervised', e.target.checked)}
                />
                {label('supervisedLabel', 'Modo supervisado')}
              </label>
            </div>
            <p className="flu-settings-image-config__hint">
              {label('safeSearchHint', 'Filtra los resultados para conservar únicamente los sitios curados.')}
            </p>
            <p className="flu-settings-image-config__hint">
              {label('supervisedHint', 'Fuerza la búsqueda segura en todos los tipos de resultado.')}
            </p>
            <label className="flu-browser-profile__field">
              <span className="flu-settings-image-config__hint">
                {label('dailyLimitLabel', 'Límite diario de búsquedas')} —{' '}
                {label('dailyLimitHint', '0 = sin límite')}
              </span>
              <input
                type="number"
                min={0}
                value={dailyLimitText}
                placeholder={numText(merged.dailyLimit)}
                data-testid="search-security-dailylimit"
                onChange={(e) => {
                  setDailyLimitText(e.target.value);
                }}
              />
            </label>
          </div>
        </div>

        {/* 6. Vista previa (dev) */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{label('previewSection', 'Vista previa (dev)')}</h4>
            <form
              onSubmit={handleRunPreview}
              className="flu-browser-profile__row flu-browser-profile__row--wrap"
            >
              <label className="flu-browser-profile__field flu-browser-profile__field--wide">
                <span className="flu-settings-image-config__hint">
                  {label('previewQueryLabel', 'Consulta de prueba')}
                </span>
                <input
                  type="text"
                  value={previewQuery}
                  placeholder={label('previewQueryPlaceholder', 'Escribí una consulta de prueba…')}
                  data-testid="search-preview-query"
                  onChange={(e) => setPreviewQuery(e.target.value)}
                />
              </label>
              <button type="submit" className="flu-ambientes-panel__create" data-testid="search-preview-run">
                {label('runPreview', 'Probar consulta')}
              </button>
            </form>
            {preview.state === 'loading' && (
              <p className="flu-settings-image-config__hint" data-testid="search-preview-loading">
                {label('previewLoading', 'Consultando…')}
              </p>
            )}
            {preview.state === 'error' && (
              <p className="flu-settings-image-config__hint" data-testid="search-preview-error">
                {label('previewError', 'No se pudo completar la consulta de prueba.')}
              </p>
            )}
            {preview.state === 'done' && (
              <div className="flu-settings-section__body" data-testid="search-preview-done">
                {preview.ai ? (
                  <>
                    <h5 className="flu-reminders__heading">{label('previewAi', 'Resumen de IA')}</h5>
                    <p className="flu-settings-image-config__hint">{preview.ai}</p>
                  </>
                ) : null}
                <h5 className="flu-reminders__heading">{label('previewResults', 'Resultados')}</h5>
                {preview.results.length === 0 ? (
                  <p className="flu-settings-image-config__hint">{label('previewEmpty', 'Sin resultados.')}</p>
                ) : (
                  <ul className="flu-reminders-list">
                    {preview.results.map((result, index) => (
                      <li
                        key={result.url || index}
                        className="flu-reminders-item flu-reminders-item--with-profile"
                      >
                        <div className="flu-reminders-item__info">
                          <span className="flu-reminders-item__text">{result.title}</span>
                          {result.snippet ? (
                            <span className="flu-reminders-item__when">{result.snippet}</span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {preview.state === 'idle' && (
              <p className="flu-settings-image-config__hint" data-testid="search-preview-empty">
                {label('previewEmpty', 'Ejecutá una consulta para ver la vista previa.')}
              </p>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
