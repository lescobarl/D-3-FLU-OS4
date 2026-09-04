// ============================================================
// HabitsPanel — Panel de hábitos y metas (Fase 4, Módulo G)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe participantes,
// estadísticas de metas y callbacks desde App (que usa useHabits)
// y renderiza:
//   - formulario de alta (participante + título + categoría + días)
//   - lista de metas con racha, progreso y check-in de hoy
//   - cambio de estado (activa/hecha/pausada) y borrado
//
// Cumple:
//   - Rule #1: NO HARDCODE — etiquetas de FLU_CONFIG.habits.ui
//     y categorías de FLU_CONFIG.habits.categories
//   - Módulo G: hábitos/metas persistentes, rachas y check-in diario
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { GoalStatus, ParticipantRecord } from '../core/db/fluDatabase';
import type { GoalStats, NewGoalInput } from '../core/habits/habitService';

export interface HabitsPanelProps {
  participants: ParticipantRecord[];
  stats: GoalStats[];
  loading: boolean;
  onAdd: (input: NewGoalInput) => Promise<void>;
  onCheckIn: (goalId: string, date: string, done: boolean) => Promise<void>;
  onStatus: (id: string, status: GoalStatus) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const STATUS_ORDER: GoalStatus[] = ['active', 'done', 'paused', 'archived'];

export function HabitsPanel({
  participants,
  stats,
  loading,
  onAdd,
  onCheckIn,
  onStatus,
  onRemove,
}: HabitsPanelProps) {
  const config = (FLU_CONFIG as any).habits || {};
  const ui = config.ui || {};
  const categories =
    Array.isArray(config.categories) && config.categories.length > 0
      ? (config.categories as string[])
      : ['habito', 'meta'];

  const [participantId, setParticipantId] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(categories[0] || '');
  const [targetDays, setTargetDays] = useState('');
  const [busy, setBusy] = useState(false);

  // Fecha local de hoy (mismo formato 'YYYY-MM-DD' que habitService).
  const today = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!participantId || !title.trim() || !category || busy) return;
    const participant = participants.find((p) => p.id === participantId);
    setBusy(true);
    try {
      const parsedTarget = targetDays ? Number(targetDays) : undefined;
      await onAdd({
        participantId,
        participantName: participant?.name,
        title: title.trim(),
        category,
        targetDays: typeof parsedTarget === 'number' && parsedTarget > 0 ? parsedTarget : undefined,
      });
      setTitle('');
      setTargetDays('');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleToday = async (goalId: string, currentDone: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await onCheckIn(goalId, today, !currentDone);
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (id: string, status: GoalStatus) => {
    if (busy) return;
    setBusy(true);
    try {
      await onStatus(id, status);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await onRemove(id);
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (status: GoalStatus): string =>
    ui[`status_${status}`] || status;

  const progressLabel = (stat: GoalStats): string => {
    if (typeof stat.progress === 'number' && typeof stat.goal.targetDays === 'number') {
      return `${stat.completedDays}/${stat.goal.targetDays} ${stat.goal.unit || 'días'}`;
    }
    return `${stat.completedDays} ${stat.goal.unit || 'días'}`;
  };

  const visibleStats = stats
    .slice()
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.goal.status) - STATUS_ORDER.indexOf(b.goal.status) ||
        b.goal.createdAt - a.goal.createdAt,
    );

  return (
    <details className="flu-settings-image-config">
      <summary className="flu-settings-image-config__summary">
        {ui.panelTitle || 'Hábitos y metas'}
      </summary>
      <div className="flu-settings-image-config__group">
        {/* Alta de meta/hábito */}
        <form className="flu-settings-section" onSubmit={handleAdd}>
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.participantLabel || 'Participante'}</span>
              <select
                value={participantId}
                onChange={(event) => setParticipantId(event.target.value)}
                aria-label={ui.participantLabel || 'Participante'}
                data-testid="habits-add-participant"
                disabled={busy}
              >
                <option value="">{ui.participantEmpty || '— Elegir participante —'}</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.titleLabel || 'Meta o hábito'}</span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={ui.titlePlaceholder || 'Ej. Leer 15 minutos'}
                data-testid="habits-add-title"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.categoryLabel || 'Categoría'}</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label={ui.categoryLabel || 'Categoría'}
                data-testid="habits-add-category"
                disabled={busy}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {ui[`category_${c}`] || c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.targetLabel || 'Días objetivo (opcional)'}</span>
              <input
                type="number"
                min={1}
                value={targetDays}
                onChange={(event) => setTargetDays(event.target.value)}
                placeholder={ui.targetPlaceholder || '21'}
                data-testid="habits-add-target"
                disabled={busy}
              />
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="habits-add-submit"
              disabled={busy || !participantId || !title.trim() || !category}
            >
              {ui.addLabel || 'Agregar meta'}
            </button>
          </div>
        </form>

        {/* Lista de metas con racha y check-in */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.listLabel || 'Mis metas'}</h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : visibleStats.length === 0 ? (
              <p className="flu-settings-image-config__hint">
                {ui.emptyState || 'Aún no hay metas registradas.'}
              </p>
            ) : (
              <ul className="flu-reminders-list" data-testid="habits-list">
                {visibleStats.map((stat) => {
                  const goal = stat.goal;
                  const todayDone = stat.todayCheckIn?.done ?? false;
                  return (
                    <li key={goal.id} className="flu-reminders-item" data-testid={`habits-item-${goal.id}`}>
                      <div className="flu-reminders-item__info">
                        <span className="flu-reminders-item__text">
                          {goal.title}
                          <span className="flu-reminders-item__when">
                            {goal.participantName || goal.participantId} · {statusLabel(goal.status)}
                          </span>
                        </span>
                        <span className="flu-reminders-item__when" data-testid={`habits-streak-${goal.id}`}>
                          🔥 {stat.streak} {ui.streakUnit || 'día(s)'} · {progressLabel(stat)}
                        </span>
                      </div>
                      <div className="flu-habits-actions">
                        <label className="flu-habits-checkin">
                          <input
                            type="checkbox"
                            checked={todayDone}
                            onChange={() => handleToggleToday(goal.id, todayDone)}
                            data-testid={`habits-checkin-${goal.id}`}
                            disabled={busy || goal.status !== 'active'}
                          />
                          <span>{ui.todayLabel || 'Hoy'}</span>
                        </label>
                        <select
                          value={goal.status}
                          onChange={(event) => handleStatus(goal.id, event.target.value as GoalStatus)}
                          aria-label={ui.statusLabel || 'Estado'}
                          data-testid={`habits-status-${goal.id}`}
                          disabled={busy}
                        >
                          {STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {statusLabel(s)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          data-testid={`habits-remove-${goal.id}`}
                          disabled={busy}
                          onClick={() => handleRemove(goal.id)}
                        >
                          {ui.removeLabel || 'Eliminar'}
                        </button>
                      </div>
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
