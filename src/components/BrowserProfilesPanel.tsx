// ============================================================
// BrowserProfilesPanel — Punto 2: Navegador curado (edición)
// ------------------------------------------------------------
// Panel presentacional controlado en Configuración, hermano de
// ParticipantsPanel: recibe participantes + perfiles de navegador
// desde App (que usa useBrowserProfiles) y renderiza un editor
// por participante (categorías, allowlist, nivel, idioma,
// supervisión, búsqueda segura y límite diario).
//
// Cumple:
//   - Regla #1: NO HARDCODE — catálogo y etiquetas desde
//     FLU_CONFIG.browser (fuente de verdad) con fallback `|| '...'`
//   - Punto 2: el perfil guardado (manual) gana a rol y a default
//   - Re-sync de inputs: se ancla a valores string/primitivos
//     (allowlist.join(', ')) para no pisar la escritura en curso del
//     usuario con referencias de array.
// ============================================================
import { useEffect, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { BrowserProfileRecord, ParticipantRecord } from '../core/db/fluDatabase';
import type {
  BrowserLanguage,
  BrowserProfileConfig,
  BrowserProfilePatch,
  BrowserReadingLevel,
} from '../core/browser/browserProfileService';

export interface BrowserProfilesPanelProps {
  items: ParticipantRecord[];
  loading: boolean;
  /** Perfiles de navegador cargados por persona (id === participantId). */
  profiles?: BrowserProfileRecord[];
  /** Guarda un parche del perfil (el hook usa ensure/update). */
  onUpdate?: (
    participantId: string,
    patch: BrowserProfilePatch,
    participantName?: string,
    role?: string,
  ) => Promise<unknown>;
  /** Elimina el perfil de navegador de una persona. */
  onReset?: (participantId: string) => Promise<boolean>;
}

interface BrowserProfileEditorProps {
  participantId: string;
  participantName?: string;
  role?: string;
  profile?: BrowserProfileRecord;
  config: BrowserProfileConfig;
  onUpdate?: BrowserProfilesPanelProps['onUpdate'];
  onReset?: BrowserProfilesPanelProps['onReset'];
}

/**
 * Editor de perfil de navegador de una persona. Sin registro, muestra
 * los defaults por rol (o el default global) y el primer guardado crea
 * el perfil vía ensure.
 */
function BrowserProfileEditor({
  participantId,
  participantName,
  role,
  profile,
  config,
  onUpdate,
  onReset,
}: BrowserProfileEditorProps) {
  const ui = config.ui || {};
  const fallback = (role && (config.defaultsByRole || {})[role]) || config.defaultProfile;

  // Valores efectivos: perfil guardado (manual) > defaults por rol > default.
  // Fallback de arrays por LONGITUD (igual que resolveForSession): un array
  // vacío guardado no debe borrar los defaults por rol en la vista.
  const categories =
    profile?.categories && profile.categories.length > 0 ? profile.categories : fallback.categories;
  const allowlist =
    profile?.allowlist && profile.allowlist.length > 0 ? profile.allowlist : fallback.allowlist;
  const readingLevel = profile?.readingLevel ?? fallback.readingLevel;
  const language = profile?.language ?? fallback.language;

  // Clave STRING (no la referencia del array) para re-sincronizar sin
  // pisar la escritura en curso del usuario en cada render.
  const allowlistKey = allowlist.join(', ');
  const [allowlistText, setAllowlistText] = useState(allowlistKey);

  // Re-sync cuando cambian los valores persistidos (string/primitivo).
  useEffect(() => {
    setAllowlistText(allowlistKey);
  }, [allowlistKey]);

  const commit = (patch: BrowserProfilePatch): void => {
    if (!onUpdate) return;
    // El rol se reenvía para que ensure siembre los escalares desde los
    // defaults por rol cuando aún no existe registro (primer edit manual).
    onUpdate(participantId, patch, participantName, role).catch((error) => {
      console.error('[BrowserProfilesPanel] No se pudo guardar el perfil de navegador:', error);
    });
  };

  const toggleCategory = (key: string): void => {
    const next = new Set(categories);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    commit({ categories: Array.from(next) });
  };

  const handleAllowlistBlur = (): void => {
    const next = allowlistText
      .split(',')
      .map((site) => site.trim().toLowerCase())
      .filter(Boolean);
    if (next.join(', ') === allowlistKey) return; // sin cambios
    commit({ allowlist: next });
  };

  const handleReadingLevel = (value: string): void => {
    if (value === readingLevel) return;
    commit({ readingLevel: value as BrowserReadingLevel });
  };

  const handleLanguage = (value: string): void => {
    if (value === language) return;
    commit({ language: value as BrowserLanguage });
  };

  return (
    <div className="flu-browser-profile" data-testid={`browser-profile-${participantId}`}>
      <span className="flu-browser-profile__title">
        {ui.profileLabel || 'Perfil de navegador'}
      </span>

      <div
        className="flu-browser-profile__group"
        data-testid={`browser-profile-categories-${participantId}`}
      >
        <span className="flu-browser-profile__label">{ui.categoriesLabel || 'Categorías'}</span>
        <div className="flu-browser-profile__chips">
          {Object.entries(config.categories).map(([key, label]) => {
            const active = categories.includes(key);
            return (
              <label
                key={key}
                className={`flu-browser-profile__chip${active ? ' flu-browser-profile__chip--active' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleCategory(key)}
                  data-testid={`browser-profile-category-${key}-${participantId}`}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <label className="flu-browser-profile__field flu-browser-profile__field--wide">
        <span>{ui.allowlistLabel || 'Sitios permitidos'}</span>
        <input
          type="text"
          value={allowlistText}
          onChange={(event) => setAllowlistText(event.target.value)}
          onBlur={handleAllowlistBlur}
          placeholder={ui.allowlistPlaceholder || 'Ej: wikipedia.org, educ.ar'}
          data-testid={`browser-profile-allowlist-${participantId}`}
        />
      </label>

      <div className="flu-browser-profile__row">
        <label className="flu-browser-profile__field">
          <span>{ui.readingLevelLabel || 'Nivel de lectura'}</span>
          <select
            value={readingLevel}
            onChange={(event) => handleReadingLevel(event.target.value)}
            aria-label={ui.readingLevelLabel || 'Nivel de lectura'}
            data-testid={`browser-profile-level-${participantId}`}
          >
            {config.readingLevels.map((level) => (
              <option key={level} value={level}>
                {ui[`level_${level}`] || level}
              </option>
            ))}
          </select>
        </label>

        <label className="flu-browser-profile__field">
          <span>{ui.languageLabel || 'Idioma'}</span>
          <select
            value={language}
            onChange={(event) => handleLanguage(event.target.value)}
            aria-label={ui.languageLabel || 'Idioma'}
            data-testid={`browser-profile-language-${participantId}`}
          >
            {config.languages.map((lang) => (
              <option key={lang} value={lang}>
                {ui[`lang_${lang}`] ||
                  (lang === 'es' ? 'Español' : lang === 'en' ? 'English' : 'Ambos')}
              </option>
            ))}
          </select>
        </label>
      </div>

      {onReset && profile ? (
        <button
          type="button"
          className="flu-browser-profile__reset"
          onClick={() => onReset(participantId)}
          data-testid={`browser-profile-reset-${participantId}`}
        >
          {ui.resetLabel || 'Restablecer'}
        </button>
      ) : null}
    </div>
  );
}

export function BrowserProfilesPanel({
  items,
  loading,
  profiles = [],
  onUpdate,
  onReset,
}: BrowserProfilesPanelProps) {
  const config = (FLU_CONFIG.browser || {}) as BrowserProfileConfig;
  const ui = config.ui || {};

  const profileFor = (participantId: string): BrowserProfileRecord | undefined =>
    profiles.find((profile) => profile.participantId === participantId);

  return (
    <details className="flu-settings-image-config">
      <summary className="flu-settings-image-config__summary">
        {ui.panelTitle || 'Navegador curado'}
      </summary>
      <div className="flu-settings-image-config__group">
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">
              {ui.subtitleLabel || 'Perfil de navegador por participante'}
            </h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : items.length === 0 ? (
              <p className="flu-settings-image-config__hint">
                {ui.emptyState || 'Sin perfiles de navegador todavía.'}
              </p>
            ) : (
              <ul className="flu-reminders-list" data-testid="browser-profiles-list">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flu-reminders-item flu-reminders-item--with-profile"
                    data-testid={`browser-profile-item-${item.id}`}
                  >
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">{item.name}</span>
                      <span className="flu-reminders-item__when">{item.role || ''}</span>
                    </div>
                    <BrowserProfileEditor
                      participantId={item.id}
                      participantName={item.name}
                      role={item.role}
                      profile={profileFor(item.id)}
                      config={config}
                      onUpdate={onUpdate}
                      onReset={onReset}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
