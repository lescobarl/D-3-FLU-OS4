// ============================================================
// DiaryPanel — Diario personal (Fase 6, Módulo J)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe participantes,
// entradas del diario y callbacks desde App (que usa useDiary)
// y renderiza:
//   - formulario de nueva entrada (fecha, título opcional,
//     contenido, ánimo opcional, vínculo opcional a participante)
//   - historial ordenado de más reciente a más antiguo con borrado
//
// Cumple:
//   - Rule #1: NO HARDCODE — etiquetas de FLU_CONFIG.diary.ui
//   - Módulo J: diario de notas/voz con fechas
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { configText } from './configText';
import type { DiaryEntryRecord, ParticipantRecord } from '../core/db/fluDatabase';
import type { DiaryEntryInput } from '../core/diary/diaryService';
import { runBusyAction, todayLocalDate } from './panelUtils';

export interface DiaryPanelProps {
  participants: ParticipantRecord[];
  entries: DiaryEntryRecord[];
  loading: boolean;
  onAdd: (input: DiaryEntryInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

export function DiaryPanel({
  participants,
  entries,
  loading,
  onAdd,
  onRemove,
}: DiaryPanelProps) {
  const config = FLU_CONFIG.diary || {};
  const ui = config.ui || {};
  const moodMax = typeof config.moodMax === 'number' ? config.moodMax : 5;

  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [busy, setBusy] = useState(false);

  // Fecha local de hoy (mismo formato 'YYYY-MM-DD' que diaryService).
  todayLocalDate();

  const moodValues: number[] = [];
  for (let value = 1; value <= moodMax; value += 1) {
    moodValues.push(value);
  }

  const moodLabel = (value: number): string =>
    configText(ui, `mood_${value}`, String(value));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedMood = mood ? Number(mood) : undefined;
    if (!date || !content.trim() || busy) return;
    if (parsedMood !== undefined && !Number.isFinite(parsedMood)) return;
    const participant = participants.find((p) => p.id === participantId);
    setBusy(true);
    try {
      await onAdd({
        date,
        title: title.trim() ? title.trim() : undefined,
        content: content.trim(),
        mood: parsedMood,
        participantId: participantId || undefined,
        participantName: participant?.name,
      });
      setTitle('');
      setContent('');
      setMood('');
      setParticipantId('');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = (id: string) => runBusyAction(busy, setBusy, () => onRemove(id));

  return (
    <details className="flu-settings-image-config">
      <summary className="flu-settings-image-config__summary">
        {ui.panelTitle || 'Diario personal'}
      </summary>
      <div className="flu-settings-image-config__group">
        {/* Nueva entrada */}
        <form className="flu-settings-section" onSubmit={handleSubmit}>
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.dateLabel || 'Fecha'}</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label={ui.dateLabel || 'Fecha'}
                data-testid="diary-add-date"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.titleLabel || 'Título'}</span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={ui.titlePlaceholder || 'Título (opcional)'}
                aria-label={ui.titleLabel || 'Título'}
                data-testid="diary-add-title"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.contentLabel || 'Contenido'}</span>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={ui.contentPlaceholder || '¿Qué quieres recordar hoy?'}
                aria-label={ui.contentLabel || 'Contenido'}
                data-testid="diary-add-content"
                disabled={busy}
                rows={3}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.moodLabel || 'Ánimo (opcional)'}</span>
              <select
                value={mood}
                onChange={(event) => setMood(event.target.value)}
                aria-label={ui.moodLabel || 'Ánimo (opcional)'}
                data-testid="diary-add-mood"
                disabled={busy}
              >
                <option value="">{ui.moodEmpty || '— Sin ánimo —'}</option>
                {moodValues.map((value) => (
                  <option key={value} value={value}>
                    {moodLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.participantLabel || 'Participante'}</span>
              <select
                value={participantId}
                onChange={(event) => setParticipantId(event.target.value)}
                aria-label={ui.participantLabel || 'Participante'}
                data-testid="diary-add-participant"
                disabled={busy}
              >
                <option value="">{ui.participantEmpty || '— Ninguno —'}</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="diary-add-submit"
              disabled={busy || !date || !content.trim()}
            >
              {ui.addLabel || 'Guardar entrada'}
            </button>
          </div>
        </form>

        {/* Historial del diario */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.listLabel || 'Historial del diario'}</h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : entries.length === 0 ? (
              <p className="flu-settings-image-config__hint">
                {ui.emptyState || 'Aún no hay entradas en el diario.'}
              </p>
            ) : (
              <ul className="flu-reminders-list" data-testid="diary-list">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flu-reminders-item"
                    data-testid={`diary-item-${entry.id}`}
                  >
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">
                        {entry.title || ui.untitledLabel || 'Sin título'}
                        <span className="flu-reminders-item__when">
                          {entry.date}
                          {entry.mood !== undefined ? ` · ${moodLabel(entry.mood)}` : ''}
                          {entry.participantName || entry.participantId
                            ? ` · ${entry.participantName || entry.participantId}`
                            : ''}
                        </span>
                      </span>
                      <span className="flu-reminders-item__when">{entry.content}</span>
                    </div>
                    <div className="flu-habits-actions">
                      <button
                        type="button"
                        data-testid={`diary-remove-${entry.id}`}
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
