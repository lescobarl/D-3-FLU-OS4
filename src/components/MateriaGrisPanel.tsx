// ============================================================
// MateriaGrisPanel — Panel de gamificación "materia gris" (Fase 3, F5)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe el leaderboard y
// las acciones desde App (que usa useMateriaGris) y renderiza:
//   - formulario de entrega de puntos (participante + acción)
//   - leaderboard ordenado por puntos
//   - historial reciente
//
// Cumple:
//   - Rule #1: NO HARDCODE — etiquetas de FLU_CONFIG.materiaGris.ui
//     y tabla de acciones de FLU_CONFIG.materiaGris.actions
//   - F5: puntos, leaderboard e historial visibles en la UI
// ============================================================
import { SettingsPanelShell } from './SettingsPanelShell';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/api/config';
import { configText } from './configText';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { ParticipantSelect } from './ParticipantSelect';
import type { MateriaGrisRecord, ParticipantRecord } from '../core/db/fluDatabase';
import type { AwardInput, LeaderboardRow } from '../core/multiuser/materiaGrisService';

export interface MateriaGrisPanelProps {
  participants: ParticipantRecord[];
  leaderboard: LeaderboardRow[];
  history: MateriaGrisRecord[];
  loading: boolean;
  onAward: (input: AwardInput) => Promise<void>;
}

export function MateriaGrisPanel({
  participants,
  leaderboard,
  history,
  loading,
  onAward,
}: MateriaGrisPanelProps) {
  const config = FLU_CONFIG.materiaGris || {};
  const ui = config.ui || {};
  const actions =
    config.actions && typeof config.actions === 'object'
      ? (config.actions as Record<string, number>)
      : {};

  const [participantId, setParticipantId] = useState('');
  const [action, setAction] = useState('');
  const { busy, run } = useAsyncAction('[MateriaGrisPanel]');

  const actionEntries = Object.entries(actions);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!participantId || !action) return;
    const participant = participants.find((p) => p.id === participantId);
    await run(() =>
      onAward({
        participantId,
        participantName: participant?.name,
        action,
      }),
    );
  };

  return (
    <SettingsPanelShell title={ui.panelTitle || 'Materia gris'}>
        {/* Entrega de puntos */}
        <form className="flu-settings-section" onSubmit={handleSubmit}>
          <div className="flu-settings-section__body">
            <ParticipantSelect
              value={participantId}
              onChange={setParticipantId}
              participants={participants}
              ui={ui}
              testId="materiagris-award-participant"
              disabled={busy}
              emptyFallback="— Elegir participante —"
            />
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.actionLabel || 'Acción'}</span>
              <select
                value={action}
                onChange={(event) => setAction(event.target.value)}
                aria-label={ui.actionLabel || 'Acción'}
                data-testid="materiagris-award-action"
                disabled={busy}
              >
                <option value="">{ui.actionEmpty || '— Elegir acción —'}</option>
                {actionEntries.map(([key, points]) => (
                  <option key={key} value={key}>
                    {configText(ui, `action_${key}`, key)} ({points} pts)
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="materiagris-award-submit"
              disabled={busy || !participantId || !action}
            >
              {ui.awardLabel || 'Otorgar puntos'}
            </button>
          </div>
        </form>

        {/* Leaderboard (F5) */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.leaderboardLabel || 'Leaderboard'}</h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : leaderboard.length === 0 ? (
              <p className="flu-settings-image-config__hint">{ui.emptyState || 'Aún no hay puntos otorgados.'}</p>
            ) : (
              <ul className="flu-reminders-list" data-testid="materiagris-leaderboard">
                {leaderboard.map((row) => (
                  <li key={row.participantId} className="flu-reminders-item">
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">{row.participantName || row.participantId}</span>
                      <span className="flu-reminders-item__when">
                        {row.points} pts · {row.actions} acciones
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Historial reciente */}
        {history.length > 0 && (
          <div className="flu-settings-section">
            <div className="flu-settings-section__body">
              <h4 className="flu-reminders__heading">{ui.historyLabel || 'Historial'}</h4>
              <ul className="flu-reminders-list" data-testid="materiagris-history">
                {history.slice(0, 20).map((entry) => (
                  <li key={entry.id} className="flu-reminders-item">
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">{entry.participantName || entry.participantId}</span>
                      <span className="flu-reminders-item__when">{entry.action} · +{entry.points} pts</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </SettingsPanelShell>
  );
}
