// ============================================================
// MoodPanel — Panel de bienestar y ánimo (Fase 5, Módulo H)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe participantes,
// historial de ánimo, resumen y callbacks desde App (que usa
// useMood) y renderiza:
//   - formulario de registro (participante + ánimo + nota)
//   - resumen agregado (promedio, mejor, peor, actual, total)
//   - historial con fecha, ánimo, nota y borrado
//
// Cumple:
//   - Rule #1: NO HARDCODE — etiquetas de FLU_CONFIG.mood.ui
//     y escala de FLU_CONFIG.mood (scaleMin..scaleMax)
//   - Módulo H: registro diario de ánimo persistente y resumen
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { configText } from './configText';
import type { MoodRecord, ParticipantRecord } from '../core/db/fluDatabase';
import type { LogMoodInput, MoodSummary } from '../core/mood/moodService';
import { runBusyAction, todayLocalDate } from './panelUtils';

export interface MoodPanelProps {
  participants: ParticipantRecord[];
  moods: MoodRecord[];
  summary: MoodSummary;
  loading: boolean;
  onLog: (input: LogMoodInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

export function MoodPanel({
  participants,
  moods,
  summary,
  loading,
  onLog,
  onRemove,
}: MoodPanelProps) {
  const config = FLU_CONFIG.mood || {};
  const ui = config.ui || {};
  const scaleMin = typeof config.scaleMin === 'number' ? config.scaleMin : 1;
  const scaleMax = typeof config.scaleMax === 'number' ? config.scaleMax : 5;

  const [participantId, setParticipantId] = useState('');
  const [mood, setMood] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Escala de ánimo generada desde config (sin hardcode).
  const scaleValues: number[] = [];
  for (let value = scaleMin; value <= scaleMax; value += 1) {
    scaleValues.push(value);
  }

  const moodLabel = (value: number): string =>
    configText(ui, `mood_${value}`, String(value));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedMood = Number(mood);
    if (!participantId || !mood || !Number.isFinite(parsedMood) || busy) return;
    const participant = participants.find((p) => p.id === participantId);
    setBusy(true);
    try {
      await onLog({
        participantId,
        participantName: participant?.name,
        date: today,
        mood: parsedMood,
        note: note.trim() ? note.trim() : undefined,
      });
      setMood('');
      setNote('');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = (id: string) => runBusyAction(busy, setBusy, () => onRemove(id));

  // Fecha local de hoy (mismo formato 'YYYY-MM-DD' que moodService).
  const today = todayLocalDate();

  const summaryItem = (label: string, value?: number | string): string | null =>
    value === undefined || value === null ? null : `${label}: ${value}`;

  const summaryLines = [
    summaryItem(ui.totalLabel || 'Registros', summary.totalLogs),
    summaryItem(ui.averageLabel || 'Promedio', summary.averageMood),
    summaryItem(ui.bestLabel || 'Mejor', summary.bestMood),
    summaryItem(ui.worstLabel || 'Peor', summary.worstMood),
    summaryItem(ui.currentLabel || 'Hoy', summary.currentMood),
  ].filter((line): line is string => line !== null);

  return (
    <details className="flu-settings-image-config">
      <summary className="flu-settings-image-config__summary">
        {ui.panelTitle || 'Bienestar y ánimo'}
      </summary>
      <div className="flu-settings-image-config__group">
        {/* Registro de ánimo */}
        <form className="flu-settings-section" onSubmit={handleSubmit}>
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.participantLabel || 'Participante'}</span>
              <select
                value={participantId}
                onChange={(event) => setParticipantId(event.target.value)}
                aria-label={ui.participantLabel || 'Participante'}
                data-testid="mood-add-participant"
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
              <span>{ui.moodLabel || 'Ánimo de hoy'}</span>
              <select
                value={mood}
                onChange={(event) => setMood(event.target.value)}
                aria-label={ui.moodLabel || 'Ánimo de hoy'}
                data-testid="mood-add-scale"
                disabled={busy}
              >
                <option value="">{ui.moodEmpty || '— Elegir ánimo —'}</option>
                {scaleValues.map((value) => (
                  <option key={value} value={value}>
                    {moodLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.noteLabel || 'Nota (opcional)'}</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={ui.notePlaceholder || '¿Cómo te sientes hoy?'}
                data-testid="mood-add-note"
                disabled={busy}
                rows={2}
              />
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="mood-add-submit"
              disabled={busy || !participantId || !mood}
            >
              {ui.addLabel || 'Registrar ánimo'}
            </button>
          </div>
        </form>

        {/* Resumen agregado */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading" data-testid="mood-summary">
              {ui.summaryLabel || 'Resumen'}
            </h4>
            {summary.totalLogs === 0 ? (
              <p className="flu-settings-image-config__hint">
                {ui.emptySummary || 'Aún no hay registros.'}
              </p>
            ) : (
              <p className="flu-settings-image-config__hint">
                {summaryLines.join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* Historial de ánimo */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.listLabel || 'Historial de ánimo'}</h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : moods.length === 0 ? (
              <p className="flu-settings-image-config__hint">
                {ui.emptyState || 'Aún no hay registros de ánimo.'}
              </p>
            ) : (
              <ul className="flu-reminders-list" data-testid="mood-list">
                {moods.map((entry) => (
                  <li
                    key={entry.id}
                    className="flu-reminders-item"
                    data-testid={`mood-item-${entry.id}`}
                  >
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">
                        {moodLabel(entry.mood)}
                        <span className="flu-reminders-item__when">
                          {entry.participantName || entry.participantId} · {entry.date}
                        </span>
                      </span>
                      {entry.note ? (
                        <span className="flu-reminders-item__when">{entry.note}</span>
                      ) : null}
                    </div>
                    <div className="flu-habits-actions">
                      <button
                        type="button"
                        data-testid={`mood-remove-${entry.id}`}
                        disabled={busy}
                        onClick={() => handleRemove(entry.id)}
                      >
                        {ui.removeLabel || 'Eliminar'}
                      </button>
                    </div>
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
