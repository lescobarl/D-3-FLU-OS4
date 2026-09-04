// ============================================================
// ParticipantsPanel — Panel de participantes del hogar (Fase 3, A3/A4/A5/B9)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe los participantes
// y acciones desde App (que usa useParticipants) y renderiza:
//   - formulario de alta (nombre, rol, cumpleaños, etiqueta de hablante)
//   - lista de participantes registrados (eliminar)
//   - cumpleaños próximos (B9)
//
// Cumple:
//   - Rule #1: NO HARDCODE — todas las etiquetas vienen de
//     FLU_CONFIG.multiuser.ui y los roles de FLU_CONFIG.multiuser.roles
//   - A3: la etiqueta de hablante vincula diarización ↔ participante
//   - B9: se muestra la ventana de cumpleaños próximos calculada en App
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { CommunicationProfileRecord, ParticipantRecord } from '../core/db/fluDatabase';
import type { ParticipantInput, RegisterResult } from '../core/multiuser/participantRegistry';
import {
  EXPLANATION_LEVELS,
  TONE_OPTIONS,
  type ExplanationLevel,
  type ManualProfilePatch,
  type PersonalityTone,
} from '../core/personalization/communicationProfileService';

export interface ParticipantsPanelProps {
  items: ParticipantRecord[];
  loading: boolean;
  /** Participantes con cumpleaños dentro de la ventana config (B9). */
  birthdayNear?: ParticipantRecord[];
  onRegister: (input: ParticipantInput) => Promise<RegisterResult>;
  onRemove: (id: string) => Promise<void>;
  /** FASE P — Perfiles de comunicación cargados por persona (opcional). */
  profiles?: CommunicationProfileRecord[];
  /** FASE P — Fija manualmente nivel/tono de una persona (opcional). */
  onSetManual?: (
    participantId: string,
    patch: ManualProfilePatch,
    participantName?: string,
  ) => Promise<CommunicationProfileRecord>;
  /** FASE P — Vuelve a auto/default el perfil de una persona (opcional). */
  onResetPerson?: (participantId: string) => Promise<boolean>;
}

export function ParticipantsPanel({
  items,
  loading,
  birthdayNear = [],
  profiles = [],
  onRegister,
  onRemove,
  onSetManual,
  onResetPerson,
}: ParticipantsPanelProps) {
  const config = (FLU_CONFIG as any).multiuser || {};
  const ui = config.ui || {};
  const roles = Array.isArray(config.roles) ? (config.roles as readonly string[]) : [];
  const pui = ((FLU_CONFIG as any).personalization || {}).ui || {};
  // Perfil anónimo por defecto (config-driven vía multiuser.skipDefaults):
  // siempre existe como semilla y NO se puede eliminar.
  const anonymousName = String((config.skipDefaults || {}).anonymousName || 'Anónimo');
  const isAnonymous = (item: ParticipantRecord): boolean =>
    item.name.trim().toLowerCase() === anonymousName.toLowerCase();

  const profileFor = (participantId: string): CommunicationProfileRecord | undefined =>
    profiles.find((profile) => profile.participantId === participantId);

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [birthday, setBirthday] = useState('');
  const [speakerLabel, setSpeakerLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nameValue = name.trim();
    if (!nameValue || busy) return;
    setBusy(true);
    try {
      const result = await onRegister({
        name: nameValue,
        role: role || undefined,
        birthday: birthday || undefined,
        speakerLabel: speakerLabel.trim() || undefined,
      });
      if (result.ok) {
        setName('');
        setRole('');
        setBirthday('');
        setSpeakerLabel('');
      }
    } finally {
      setBusy(false);
    }
  };

  /** FASE P — Fija manualmente el nivel de explicación ("" = Auto → sin cambio). */
  const handleSetLevel = (item: ParticipantRecord, value: string) => {
    if (!value || !onSetManual) return;
    onSetManual(item.id, { explanationLevel: value as ExplanationLevel }, item.name).catch((error) => {
      console.error('[ParticipantsPanel] No se pudo guardar el nivel manual:', error);
    });
  };

  /** FASE P — Fija manualmente el tono ("" = Auto → sin cambio). */
  const handleSetTone = (item: ParticipantRecord, value: string) => {
    if (!value || !onSetManual) return;
    onSetManual(item.id, { tone: value as PersonalityTone }, item.name).catch((error) => {
      console.error('[ParticipantsPanel] No se pudo guardar el tono manual:', error);
    });
  };

  return (
    <details className="flu-settings-image-config">
      <summary className="flu-settings-image-config__summary">
        {ui.panelTitle || 'Participantes'}
      </summary>
      <div className="flu-settings-image-config__group">
        {/* Alta */}
        <form className="flu-settings-section" onSubmit={handleSubmit}>
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.nameLabel || 'Nombre'}</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={ui.namePlaceholder || 'Ej: Mamá, Luis, Ana…'}
                data-testid="participants-add-name"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.roleLabel || 'Rol'}</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                aria-label={ui.roleLabel || 'Rol'}
                data-testid="participants-add-role"
                disabled={busy}
              >
                <option value="">{ui.roleEmpty || '— Sin rol —'}</option>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.birthdayLabel || 'Cumpleaños'}</span>
              <input
                type="date"
                value={birthday}
                onChange={(event) => setBirthday(event.target.value)}
                data-testid="participants-add-birthday"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.speakerLabel || 'Etiqueta de hablante'}</span>
              <input
                type="text"
                value={speakerLabel}
                onChange={(event) => setSpeakerLabel(event.target.value)}
                placeholder={ui.speakerPlaceholder || 'Ej: Hablante_01 (opcional)'}
                data-testid="participants-add-speaker"
                disabled={busy}
              />
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="participants-add-submit"
              disabled={busy || !name.trim()}
            >
              {ui.addLabel || 'Registrar participante'}
            </button>
          </div>
        </form>

        {/* Cumpleaños próximos (B9) */}
        {birthdayNear.length > 0 && (
          <div className="flu-settings-section">
            <div className="flu-settings-section__body">
              <h4 className="flu-reminders__heading">{ui.birthdayNearLabel || 'Cumpleaños próximos'}</h4>
              <ul className="flu-reminders-list" data-testid="participants-birthday-near">
                {birthdayNear.map((item) => (
                  <li key={item.id} className="flu-reminders-item">
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">{item.name}</span>
                      <span className="flu-reminders-item__when">{item.birthday || ''}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Lista de participantes */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.listLabel || 'Participantes registrados'}</h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : items.length === 0 ? (
              <p className="flu-settings-image-config__hint">{ui.emptyState || 'Aún no hay participantes.'}</p>
            ) : (
              <ul className="flu-reminders-list" data-testid="participants-list">
                {items.map((item) => {
                  const profile = profileFor(item.id);
                  return (
                    <li
                      key={item.id}
                      className={`flu-reminders-item${onSetManual ? ' flu-reminders-item--with-profile' : ''}`}
                    >
                      <div className="flu-reminders-item__info">
                        <span className="flu-reminders-item__text">{item.name}</span>
                        <span className="flu-reminders-item__when">
                          {[item.role, item.speakerLabel, item.birthday].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flu-reminders-item__actions">
                        {!isAnonymous(item) && (
                          <button
                            type="button"
                            title={ui.removeTitle || 'Eliminar participante'}
                            aria-label={ui.removeTitle || 'Eliminar participante'}
                            data-testid={`participants-remove-${item.id}`}
                            onClick={() => onRemove(item.id)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      {onSetManual && (
                        <div className="flu-communication-profile" data-testid={`participants-profile-${item.id}`}>
                          <span className="flu-communication-profile__title">
                            {pui.panelTitle || 'Perfil de comunicación'}
                          </span>
                          <label className="flu-communication-profile__field">
                            <span>{pui.explanationLabel || 'Nivel de explicación'}</span>
                            <select
                              value={profile?.manualExplanationLevel ?? ''}
                              onChange={(event) => handleSetLevel(item, event.target.value)}
                              aria-label={pui.explanationLabel || 'Nivel de explicación'}
                              data-testid={`participants-profile-level-${item.id}`}
                            >
                              <option value="">{pui.autoPlaceholder || 'Auto'}</option>
                              {EXPLANATION_LEVELS.map((level) => (
                                <option key={level} value={level}>
                                  {pui[`level_${level}`] || level}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flu-communication-profile__field">
                            <span>{pui.toneLabel || 'Tono'}</span>
                            <select
                              value={profile?.manualTone ?? ''}
                              onChange={(event) => handleSetTone(item, event.target.value)}
                              aria-label={pui.toneLabel || 'Tono'}
                              data-testid={`participants-profile-tone-${item.id}`}
                            >
                              <option value="">{pui.autoPlaceholder || 'Auto'}</option>
                              {TONE_OPTIONS.map((tone) => (
                                <option key={tone} value={tone}>
                                  {pui[`tone_${tone}`] || tone}
                                </option>
                              ))}
                            </select>
                          </label>
                          {onResetPerson && (profile?.manualExplanationLevel || profile?.manualTone) ? (
                            <button
                              type="button"
                              className="flu-communication-profile__reset"
                              onClick={() => onResetPerson(item.id)}
                              data-testid={`participants-profile-reset-${item.id}`}
                            >
                              {pui.resetLabel || 'Restablecer'}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
