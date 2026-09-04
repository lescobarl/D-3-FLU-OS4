// ============================================================
// AssistantSettingsPanel — Ajustes del asistente personal (Fase 1)
// ------------------------------------------------------------
// Componente controlado (presentacional): notificaciones (canal),
// no molestar (DND) y repetición del onboarding. El estado vive en
// App (useDoNotDisturb + useNotificationCenter) y llega por props,
// de modo que DND se comparte con el centro de notificaciones.
// ============================================================
import type { NotificationChannel } from '../core/notifications/notificationService';
import type { DoNotDisturbState, DndSchedule } from '../hooks/useDoNotDisturb';

export interface AssistantSettingsPanelProps {
  channel: NotificationChannel;
  onChannelChange: (channel: NotificationChannel) => void;
  dnd: DoNotDisturbState;
  onSetDndEnabled: (enabled: boolean) => void;
  onSetDndSchedule: (schedule: DndSchedule) => void;
  onSetDndAllowUrgent: (allowUrgent: boolean) => void;
  onReplayOnboarding: () => void;
}

const CHANNEL_OPTIONS: Array<{ value: NotificationChannel; label: string }> = [
  { value: 'none', label: 'Silenciar' },
  { value: 'toast', label: 'Toast (en pantalla)' },
  { value: 'voice', label: 'Voz' },
  { value: 'both', label: 'Toast + voz' },
];

export function AssistantSettingsPanel({
  channel,
  onChannelChange,
  dnd,
  onSetDndEnabled,
  onSetDndSchedule,
  onSetDndAllowUrgent,
  onReplayOnboarding,
}: AssistantSettingsPanelProps) {
  return (
    <details className="flu-settings-image-config">
      <summary className="flu-settings-image-config__summary">
        Asistente personal
      </summary>
      <div className="flu-settings-image-config__group">
        {/* Notificaciones */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>Canal de notificaciones</span>
              <select
                value={channel}
                onChange={(event) => onChannelChange(event.target.value as NotificationChannel)}
                data-testid="notification-channel"
              >
                {CHANNEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* No molestar (DND) */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--checkbox">
              <input
                type="checkbox"
                checked={dnd.enabled}
                onChange={(event) => onSetDndEnabled(event.target.checked)}
                data-testid="dnd-enabled"
              />
              <span>No molestar</span>
            </label>

            {dnd.enabled && (
              <>
                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                  <span>Inicio del horario</span>
                  <input
                    type="time"
                    value={dnd.schedule.start}
                    onChange={(event) =>
                      onSetDndSchedule({ ...dnd.schedule, start: event.target.value })
                    }
                    data-testid="dnd-start"
                  />
                </label>
                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                  <span>Fin del horario</span>
                  <input
                    type="time"
                    value={dnd.schedule.end}
                    onChange={(event) =>
                      onSetDndSchedule({ ...dnd.schedule, end: event.target.value })
                    }
                    data-testid="dnd-end"
                  />
                </label>
                <label className="flu-settings-image-config__field flu-settings-image-config__field--checkbox">
                  <input
                    type="checkbox"
                    checked={dnd.allowUrgent}
                    onChange={(event) => onSetDndAllowUrgent(event.target.checked)}
                    data-testid="dnd-allow-urgent"
                  />
                  <span>Permitir urgentes durante el DND</span>
                </label>
                <p className="flu-settings-image-config__hint">
                  Estado actual: {dnd.active ? 'Activo' : 'Inactivo'} ({dnd.scheduleLabel})
                </p>
              </>
            )}
          </div>
        </div>

        {/* Onboarding */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <button
              type="button"
              className="flu-settings-image-config__field--stacked"
              onClick={onReplayOnboarding}
              data-testid="replay-onboarding"
            >
              Repetir bienvenida / onboarding
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
