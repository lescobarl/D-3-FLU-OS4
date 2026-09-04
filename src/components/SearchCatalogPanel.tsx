// ============================================================
// SearchCatalogPanel — Punto 2: Catálogo de sitios del Buscador (F2)
// ------------------------------------------------------------
// Panel presentacional controlado en Configuración (grupo Gestión):
// recibe el catálogo fusionado (built-ins + dinámicos) desde App
// (que usa useSearchSites) y renderiza:
//   - una lista de sitios con dominio, nombre, categorías, idiomas,
//     nivel de lectura y aprobación
//   - built-ins: badge "Sistema" (no editables/borrables)
//   - dinámicos: botones "Editar" / "Eliminar" (con confirmación)
//   - botón "Nuevo sitio" y formulario crear/editar que sustituye
//     a la lista mientras edita
//
// Cumple:
//   - Regla #1: NO HARDCODE — etiquetas desde
//     FLU_CONFIG.browser.catalog (fuente de verdad) con fallback
//     `|| '...'`, y categorías/idiomas/niveles desde
//     FLU_CONFIG.browser (mismos catálogos que el perfil)
//   - F2: agregar un sitio aprobado = aparece en voz, barra, tiles
//     y resultados sin tocar código (deriveAllowlist/deriveTiles)
//   - Presentacional: sin acceso a stores; App inyecta estado y
//     acciones (mismo patrón que AmbientesPanel/BrowserProfilesPanel)
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type {
  SearchSite,
  SearchSiteLanguage,
  SearchSiteLevel,
} from '../core/search/searchSiteTypes';
import type { RegisterResult, UpdateResult } from '../core/catalogs/catalogRegistry';

export interface SearchCatalogPanelProps {
  /** Catálogo fusionado vigente (built-ins + dinámicos). */
  sites: readonly SearchSite[];
  /** Dominios de sitios dinámicos (editables/borrables). */
  dynamicDomains: ReadonlySet<string>;
  loading: boolean;
  /** Registra un sitio dinámico nuevo (searchCatalog.register). */
  onRegister: (data: SearchSite) => Promise<RegisterResult<SearchSite>>;
  /** Actualiza un sitio dinámico (searchCatalog.update). */
  onUpdate: (id: string, data: SearchSite) => Promise<UpdateResult<SearchSite>>;
  /** Elimina un sitio dinámico (searchCatalog.remove). */
  onRemove: (id: string) => Promise<boolean>;
}

/** Forma tipada de la configuración del catálogo (labels + catálogos válidos). */
interface CatalogConfig {
  labels: Record<string, string>;
  categories: Record<string, string>;
  readingLevels: string[];
  languages: string[];
  /** Labels de nivel de lectura (reutiliza browser.ui.level_*). */
  levelLabels: Record<string, string>;
}

type EditorState =
  | { mode: 'create'; seed: SearchSite }
  | { mode: 'edit'; id: string; seed: SearchSite }
  | null;

/** Sitio vacío por defecto para el formulario de creación. */
function emptySeed(): SearchSite {
  return {
    dominio: '',
    label: '',
    categorias: [],
    idiomas: [],
    nivel: 'simple',
    aprobado: true,
  };
}

/** Etiqueta legible de un idioma (config-driven con fallback). */
function languageLabel(labels: Record<string, string>, lang: string): string {
  return (
    labels[`lang_${lang}`] ||
    (lang === 'es' ? 'Español' : lang === 'en' ? 'English' : 'Ambos')
  );
}

interface SearchSiteEditorFormProps {
  seed: SearchSite;
  config: CatalogConfig;
  submitLabel: string;
  cancelLabel: string;
  onSubmit: (data: SearchSite) => Promise<string | null>;
  onCancel: () => void;
}

/** Formulario crear/editar de un sitio del catálogo. */
function SearchSiteEditorForm({
  seed,
  config,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel,
}: SearchSiteEditorFormProps) {
  const { labels, categories, readingLevels, languages, levelLabels } = config;

  // Re-sync por valores primitivos/string: el seed cambia entre crear y
  // editar, y cada cambio de contexto debe reconstruir el formulario.
  const [dominio, setDominio] = useState(seed.dominio);
  const [label, setLabel] = useState(seed.label);
  const [categorias, setCategorias] = useState<string[]>(seed.categorias);
  const [idiomas, setIdiomas] = useState<SearchSiteLanguage[]>(seed.idiomas);
  const [nivel, setNivel] = useState<string>(seed.nivel);
  const [aprobado, setAprobado] = useState<boolean>(seed.aprobado);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleCategoria = (key: string): void => {
    setCategorias((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  };

  const toggleIdioma = (lang: string): void => {
    const value = lang as SearchSiteLanguage;
    setIdiomas((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    );
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const dominioTrimmed = dominio.trim().toLowerCase();
    const labelTrimmed = label.trim();
    if (!dominioTrimmed || !labelTrimmed || categorias.length === 0) {
      setError(
        labels.invalidError ||
          'Revisa los datos: dominio y nombre son obligatorios y debes elegir al menos una categoría.',
      );
      return;
    }
    setSaving(true);
    try {
      const message = await onSubmit({
        dominio: dominioTrimmed,
        label: labelTrimmed,
        categorias,
        idiomas,
        nivel: nivel as SearchSiteLevel,
        aprobado,
      });
      if (message) setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flu-browser-profile"
      onSubmit={handleSubmit}
      data-testid="search-catalog-form"
    >
      <span className="flu-browser-profile__title">
        {labels.panelTitle || 'Catálogo de sitios'}
      </span>

      <label className="flu-browser-profile__field flu-browser-profile__field--wide">
        <span>{labels.domainLabel || 'Dominio'}</span>
        <input
          type="text"
          value={dominio}
          onChange={(event) => setDominio(event.target.value)}
          placeholder={labels.domainPlaceholder || 'Ej: khanacademy.org'}
          data-testid="search-site-dominio"
        />
      </label>

      <label className="flu-browser-profile__field flu-browser-profile__field--wide">
        <span>{labels.labelLabel || 'Nombre'}</span>
        <input
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={labels.labelPlaceholder || 'Ej: Khan Academy'}
          data-testid="search-site-label"
        />
      </label>

      <div className="flu-browser-profile__group">
        <span className="flu-browser-profile__label">
          {labels.categoriesLabel || 'Categorías'}
        </span>
        <div className="flu-browser-profile__chips">
          {Object.entries(categories).map(([key, categoryLabel]) => {
            const active = categorias.includes(key);
            return (
              <label
                key={key}
                className={`flu-browser-profile__chip${active ? ' flu-browser-profile__chip--active' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleCategoria(key)}
                  data-testid={`search-site-categoria-${key}`}
                />
                <span>{categoryLabel}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flu-browser-profile__group">
        <span className="flu-browser-profile__label">
          {labels.languagesLabel || 'Idiomas'}
        </span>
        <div className="flu-browser-profile__chips">
          {languages.map((lang) => {
            const active = idiomas.includes(lang as SearchSiteLanguage);
            return (
              <label
                key={lang}
                className={`flu-browser-profile__chip${active ? ' flu-browser-profile__chip--active' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleIdioma(lang)}
                  data-testid={`search-site-idioma-${lang}`}
                />
                <span>{languageLabel(labels, lang)}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flu-browser-profile__row">
        <label className="flu-browser-profile__field">
          <span>{labels.levelLabel || 'Nivel de lectura'}</span>
          <select
            value={nivel}
            onChange={(event) => setNivel(event.target.value)}
            aria-label={labels.levelLabel || 'Nivel de lectura'}
            data-testid="search-site-nivel"
          >
            {readingLevels.map((level) => (
              <option key={level} value={level}>
                {levelLabels[`level_${level}`] || level}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flu-browser-profile__check">
        <input
          type="checkbox"
          checked={aprobado}
          onChange={(event) => setAprobado(event.target.checked)}
          data-testid="search-site-aprobado"
        />
        <span>{labels.approvedLabel || 'Aprobado'}</span>
      </label>

      {error ? (
        <p className="flu-settings-image-config__hint" data-testid="search-catalog-error">
          {error}
        </p>
      ) : null}

      <div className="flu-browser-profile__row">
        <button
          type="submit"
          className="flu-ambientes-panel__create"
          disabled={saving}
          data-testid="search-site-save"
        >
          {saving ? '…' : submitLabel}
        </button>
        <button
          type="button"
          className="flu-browser-profile__reset"
          onClick={onCancel}
          data-testid="search-site-cancel"
        >
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}

export function SearchCatalogPanel({
  sites,
  dynamicDomains,
  loading,
  onRegister,
  onUpdate,
  onRemove,
}: SearchCatalogPanelProps) {
  const browser = ((FLU_CONFIG as any).browser || {}) as {
    catalog?: Record<string, string>;
    categories?: Record<string, string>;
    readingLevels?: string[];
    languages?: string[];
    ui?: Record<string, string>;
  };
  const labels = browser.catalog || {};
  const categories = browser.categories || {};
  const readingLevels = browser.readingLevels || ['simple', 'detallado', 'avanzado'];
  const languages = browser.languages || ['es', 'en', 'both'];
  const levelLabels = browser.ui || {};

  const config: CatalogConfig = { labels, categories, readingLevels, languages, levelLabels };

  const [editor, setEditor] = useState<EditorState>(null);

  const mapReason = (
    reason:
      | Extract<RegisterResult<SearchSite>, { ok: false }>['reason']
      | Extract<UpdateResult<SearchSite>, { ok: false }>['reason'],
  ): string => {
    switch (reason) {
      case 'duplicate':
        return labels.duplicateError || 'Ya existe un sitio con ese dominio.';
      case 'reserved':
        return labels.reservedError || 'Ese dominio pertenece al catálogo de sistema y no se puede modificar.';
      case 'not-found':
        return labels.notFoundError || 'El sitio no existe o ya fue eliminado.';
      default:
        return labels.invalidError || 'Revisa los datos: el dominio debe ser un host válido (ej: wikipedia.org).';
    }
  };

  const startCreate = (): void => {
    setEditor({ mode: 'create', seed: emptySeed() });
  };

  const startEdit = (site: SearchSite): void => {
    setEditor({
      mode: 'edit',
      id: site.dominio,
      seed: { ...site, categorias: [...site.categorias], idiomas: [...site.idiomas] },
    });
  };

  const handleEditorSubmit = async (payload: SearchSite): Promise<string | null> => {
    if (!editor) return labels.invalidError || 'No se puede guardar sin contexto.';
    if (editor.mode === 'create') {
      const result = await onRegister(payload);
      if (result.ok) {
        setEditor(null);
        return null;
      }
      return mapReason(result.reason);
    }
    const result = await onUpdate(editor.id, payload);
    if (result.ok) {
      setEditor(null);
      return null;
    }
    return mapReason(result.reason);
  };

  const handleRemove = async (site: SearchSite): Promise<void> => {
    if (!window.confirm(labels.removeConfirm || '¿Eliminar este sitio del catálogo?')) return;
    await onRemove(site.dominio);
  };

  return (
    <details className="flu-settings-image-config">
      <summary className="flu-settings-image-config__summary">
        {labels.panelTitle || 'Catálogo de sitios'}
      </summary>
      <div className="flu-settings-image-config__group">
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            {editor ? (
              <SearchSiteEditorForm
                seed={editor.seed}
                config={config}
                submitLabel={
                  editor.mode === 'create'
                    ? labels.createLabel || 'Nuevo sitio'
                    : labels.saveLabel || 'Guardar cambios'
                }
                cancelLabel={labels.cancelLabel || 'Cancelar'}
                onSubmit={handleEditorSubmit}
                onCancel={() => setEditor(null)}
              />
            ) : (
              <>
                <h4 className="flu-reminders__heading">
                  {labels.panelTitle || 'Catálogo de sitios'}
                </h4>
                <p className="flu-settings-image-config__hint">
                  {labels.hint ||
                    'Agregar un sitio aprobado lo hace aparecer en voz, barra, tiles y resultados sin tocar código.'}
                </p>
                <button
                  type="button"
                  className="flu-ambientes-panel__create"
                  data-testid="search-site-create"
                  onClick={startCreate}
                >
                  {labels.createLabel || 'Nuevo sitio'}
                </button>
                {loading ? (
                  <p className="flu-settings-image-config__hint">
                    {labels.loadingLabel || 'Cargando catálogo…'}
                  </p>
                ) : sites.length === 0 ? (
                  <p className="flu-settings-image-config__hint">
                    {labels.emptyState || 'No hay sitios en el catálogo todavía.'}
                  </p>
                ) : (
                  <ul className="flu-reminders-list" data-testid="search-catalog-list">
                    {sites.map((site) => {
                      const isFixed = !dynamicDomains.has(site.dominio);
                      const categoriesText =
                        site.categorias.map((cat) => categories[cat] || cat).join(', ') || '—';
                      const languagesText =
                        site.idiomas.map((lang) => languageLabel(labels, lang)).join(', ') || '—';
                      const levelText = levelLabels[`level_${site.nivel}`] || site.nivel;
                      return (
                        <li
                          key={site.dominio}
                          className="flu-reminders-item flu-reminders-item--with-profile"
                          data-testid={`search-site-item-${site.dominio}`}
                        >
                          <div className="flu-reminders-item__info">
                            <span className="flu-reminders-item__text">{site.label}</span>
                            <span className="flu-reminders-item__when">{site.dominio}</span>
                            <span className="flu-reminders-item__when">
                              {categoriesText} · {languagesText} · {levelText}
                            </span>
                          </div>
                          <div className="flu-browser-profile__row">
                            {isFixed ? (
                              <span className="flu-settings-image-config__hint">
                                {labels.builtinBadge || 'Sistema'}
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="flu-browser-profile__reset"
                                  data-testid={`search-site-edit-${site.dominio}`}
                                  onClick={() => startEdit(site)}
                                >
                                  {labels.editLabel || 'Editar'}
                                </button>
                                <button
                                  type="button"
                                  className="flu-browser-profile__reset"
                                  data-testid={`search-site-remove-${site.dominio}`}
                                  onClick={() => handleRemove(site)}
                                >
                                  {labels.removeLabel || 'Eliminar'}
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
