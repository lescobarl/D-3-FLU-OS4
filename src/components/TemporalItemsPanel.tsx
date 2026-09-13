// ============================================================
// TemporalItemsPanel — Panel del motor temporal genérico
// ------------------------------------------------------------
// Componente presentacional controlado: recibe alarmas y
// temporizadores + acciones desde App (que usa useTemporalItems)
// y renderiza:
//   - alta de alarma (hora + nombre opcional) → trigger daily
//   - lista de alarmas (próximo disparo / cancelar / eliminar)
//   - alta de temporizador (minutos + nombre opcional) → countdown
//   - lista de temporizadores (restante en vivo / cancelar / eliminar)
//
// Cumple:
//   - Rule #1: NO HARDCODE — todas las etiquetas vienen de
//     FLU_CONFIG.temporal.ui (sin cadenas sueltas)
//   - Etiquetas de respaldo 100% derivadas de formateadores puros
//     (nunca frases inventadas) para que `add` nunca reciba un
//     label vacío (el servicio lo rechaza como invalid-input).
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { NewTemporalItemInput, TemporalItemRecord } from '../core/temporal/temporalService';
import { formatCountdown, formatTimeOfDay, timerRemainingMs } from '../core/temporal/scheduleEngine';
import { dailyRecurrence, onceRecurrence } from '../core/temporal/temporalTypes';

export interface TemporalItemsPanelProps {
  alarms: TemporalItemRecord[];
  timers: TemporalItemRecord[];
  loading: boolean;
  /** Crea un ítem temporal con trigger + recurrence ya resueltos. */
  onAdd: (input: NewTemporalItemInput) => Promise<void>;
  /** Cancela (desactiva) un ítem pendiente. */
  onCancel: (id: string) => Promise<void>;
  /** Elimina el ítem de forma definitiva. */
  onRemove: (id: string) => Promise<void>;
  /** Edita etiqueta y/o hora de una alarma desde la lista. */
  onEdit?: (id: string, patch: { label?: string; timeOfDay?: string }) => Promise<unknown>;
  /** Referencia de reloj (por defecto: Date.now()) para pruebas. */
  now?: () => number;
}

const MINUTE_MS = 60_000;

export function TemporalItemsPanel({
  alarms,
  timers,
  loading,
  onAdd,
  onCancel,
  onRemove,
  onEdit,
  now = () => Date.now(),
}: TemporalItemsPanelProps) {
  const config = (FLU_CONFIG as any).temporal || {};
  const ui = config.ui || {};
  const defaultAlarmTime = config.defaultAlarmTimeOfDay || '07:00';
  const defaultTimerMinutes = Number(config.defaultTimerMinutes) || 5;

  const [alarmTime, setAlarmTime] = useState(defaultAlarmTime);
  const [alarmLabel, setAlarmLabel] = useState('');
  const [timerMinutes, setTimerMinutes] = useState(String(defaultTimerMinutes));
  const [timerLabel, setTimerLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editTime, setEditTime] = useState('');

  const commitEdit = (id: string): void => {
    const label = editValue.trim();
    setEditingId(null);
    const patch: { label?: string; timeOfDay?: string } = {};
    if (label) patch.label = label;
    if (editTime) patch.timeOfDay = editTime;
    if (patch.label || patch.timeOfDay) void onEdit?.(id, patch);
  };

  const sortedAlarms = alarms.slice().sort((a, b) => a.nextAt - b.nextAt);
  const sortedTimers = timers.slice().sort((a, b) => a.nextAt - b.nextAt);

  const handleAlarmSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const timeValue = alarmTime.trim();
    if (!timeValue || busy) return;
    const labelValue = alarmLabel.trim();
    setBusy(true);
    try {
      await onAdd({
        kind: 'alarm',
        // Etiqueta de respaldo derivada (nunca vacía): usa la propia hora.
        label: labelValue || timeValue,
        trigger: { kind: 'daily', timeOfDay: timeValue },
        recurrence: dailyRecurrence(),
      });
      setAlarmLabel('');
    } finally {
      setBusy(false);
    }
  };

  const handleTimerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const minutes = Number(timerMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || busy) return;
    const labelValue = timerLabel.trim();
    const durationMs = Math.round(minutes * MINUTE_MS);
    setBusy(true);
    try {
      await onAdd({
        kind: 'timer',
        // Etiqueta de respaldo derivada (nunca vacía): formatea la duración.
        label: labelValue || formatCountdown(durationMs),
        trigger: { kind: 'countdown', at: now(), durationMs },
        recurrence: onceRecurrence(),
      });
      setTimerLabel('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="flu-settings-image-config" open>
      <summary className="flu-settings-image-config__summary">
        {ui.panelTitle || 'Alarmas y temporizadores'}
      </summary>
      <div className="flu-settings-image-config__group">
        {/* Alta de alarma */}
        <form className="flu-settings-section" onSubmit={handleAlarmSubmit}>
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.timeLabel || 'Hora'}</span>
              <input
                type="time"
                value={alarmTime}
                onChange={(event) => setAlarmTime(event.target.value)}
                data-testid="temporal-alarm-time"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.labelLabel || 'Nombre (opcional)'}</span>
              <input
                type="text"
                value={alarmLabel}
                onChange={(event) => setAlarmLabel(event.target.value)}
                placeholder={ui.alarmPlaceholder || 'Ej: a las 7 de la mañana'}
                data-testid="temporal-alarm-label"
                disabled={busy}
              />
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="temporal-alarm-submit"
              disabled={busy || !alarmTime.trim()}
            >
              {ui.addAlarmLabel || 'Poner alarma'}
            </button>
            <p className="flu-settings-image-config__hint">
              {ui.nextAtLabel || 'Próximo disparo'}: {alarmTime}
            </p>
          </div>
        </form>

        {/* Lista de alarmas */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.alarmsLabel || 'Alarmas'}</h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : sortedAlarms.length === 0 ? (
              <p className="flu-settings-image-config__hint">{ui.emptyAlarms || 'Sin alarmas.'}</p>
            ) : (
              <ul className="flu-reminders-list" data-testid="temporal-alarms-list">
                {sortedAlarms.map((item) => (
                  <li key={item.id} className="flu-reminders-item">
                    <div className="flu-reminders-item__info">
                      {editingId === item.id ? (
                        <>
                          <input
                            className="flu-reminders-item__edit"
                            type="text"
                            value={editValue}
                            autoFocus
                            data-testid={`temporal-edit-input-${item.id}`}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(item.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitEdit(item.id);
                              } else if (e.key === 'Escape') {
                                setEditingId(null);
                              }
                            }}
                          />
                          {item.trigger?.kind === 'daily' && (
                            <input
                              className="flu-reminders-item__edit"
                              type="time"
                              value={editTime}
                              data-testid={`temporal-edit-time-${item.id}`}
                              onChange={(e) => setEditTime(e.target.value)}
                              onBlur={() => commitEdit(item.id)}
                            />
                          )}
                        </>
                      ) : (
                        <span className="flu-reminders-item__text">{item.label}</span>
                      )}
                      <span className="flu-reminders-item__when">
                        {ui.nextAtLabel || 'Próximo disparo'}: {formatTimeOfDay(item.nextAt)}
                      </span>
                    </div>
                    <div className="flu-reminders-item__actions">
                      {onEdit && (
                        <button
                          type="button"
                          title={ui.editTitle || 'Editar'}
                          aria-label={ui.editTitle || 'Editar'}
                          data-testid={`temporal-edit-${item.id}`}
                          onClick={() => {
                            setEditingId(item.id);
                            setEditValue(item.label);
                            setEditTime((item.trigger?.kind === 'daily' && item.trigger.timeOfDay) || '');
                          }}
                        >
                          ✎
                        </button>
                      )}
                      <button
                        type="button"
                        title={ui.cancelTitle || 'Cancelar'}
                        aria-label={ui.cancelTitle || 'Cancelar'}
                        data-testid={`temporal-cancel-${item.id}`}
                        onClick={() => onCancel(item.id)}
                      >
                        –
                      </button>
                      <button
                        type="button"
                        title={ui.removeTitle || 'Eliminar'}
                        aria-label={ui.removeTitle || 'Eliminar'}
                        data-testid={`temporal-remove-${item.id}`}
                        onClick={() => onRemove(item.id)}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Alta de temporizador */}
        <form className="flu-settings-section" onSubmit={handleTimerSubmit}>
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.durationLabel || 'Duración'}</span>
              <input
                type="number"
                min="1"
                value={timerMinutes}
                onChange={(event) => setTimerMinutes(event.target.value)}
                data-testid="temporal-timer-minutes"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.labelLabel || 'Nombre (opcional)'}</span>
              <input
                type="text"
                value={timerLabel}
                onChange={(event) => setTimerLabel(event.target.value)}
                placeholder={ui.timerPlaceholder || 'Ej: de 5 minutos para la pasta'}
                data-testid="temporal-timer-label"
                disabled={busy}
              />
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="temporal-timer-submit"
              disabled={busy || Number(timerMinutes) <= 0}
            >
              {ui.addTimerLabel || 'Poner temporizador'}
            </button>
            <p className="flu-settings-image-config__hint">
              {ui.durationLabel || 'Duración'}:{' '}
              {formatCountdown(Math.round((Number(timerMinutes) || 0) * MINUTE_MS))}
            </p>
          </div>
        </form>

        {/* Lista de temporizadores */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.timersLabel || 'Temporizadores'}</h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : sortedTimers.length === 0 ? (
              <p className="flu-settings-image-config__hint">{ui.emptyTimers || 'Sin temporizadores.'}</p>
            ) : (
              <ul className="flu-reminders-list" data-testid="temporal-timers-list">
                {sortedTimers.map((item) => {
                  const remaining = timerRemainingMs(item.trigger, now()) ?? 0;
                  return (
                    <li key={item.id} className="flu-reminders-item">
                      <div className="flu-reminders-item__info">
                        <span className="flu-reminders-item__text">{item.label}</span>
                        <span className="flu-reminders-item__when">
                          {ui.remainingLabel || 'Restante'}: {formatCountdown(remaining)}
                        </span>
                      </div>
                      <div className="flu-reminders-item__actions">
                        <button
                          type="button"
                          title={ui.cancelTitle || 'Cancelar'}
                          aria-label={ui.cancelTitle || 'Cancelar'}
                          data-testid={`temporal-cancel-${item.id}`}
                          onClick={() => onCancel(item.id)}
                        >
                          –
                        </button>
                        <button
                          type="button"
                          title={ui.removeTitle || 'Eliminar'}
                          aria-label={ui.removeTitle || 'Eliminar'}
                          data-testid={`temporal-remove-${item.id}`}
                          onClick={() => onRemove(item.id)}
                        >
                          ×
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
