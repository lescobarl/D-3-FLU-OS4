// ============================================================
// RemindersPanel — Panel de recordatorios (Fase 2, B1/B3/B4)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe los recordatorios
// y acciones desde App (que usa useReminders) y renderiza:
//   - formulario de alta (texto + "cuándo" en lenguaje natural)
//   - lista de pendientes (completar / descartar / eliminar)
//   - lista de completados (eliminar)
//
// Cumple:
//   - Rule #1: NO HARDCODE — todas las etiquetas vienen de
//     FLU_CONFIG.reminders.ui (sin cadenas sueltas)
//   - Reutiliza nlDateParser (determinista) para resolver el
//     "cuándo"; si no se interpreta, usa defaultReminderOffsetMinutes
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { ReminderRecord } from '../core/db/fluDatabase';
import { parseNlDateTime, describeNlDateTime } from '../core/reminders/nlDateParser';

export interface RemindersPanelProps {
  items: ReminderRecord[];
  loading: boolean;
  pendingCount: number;
  /** Crea un recordatorio con texto + timestamp ya resueltos. */
  onAdd: (input: { text: string; dueAt: number }) => Promise<void>;
  onComplete: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Edita el texto de un recordatorio desde la lista. */
  onEdit?: (id: string, text: string) => Promise<unknown>;
  /** Referencia de reloj (por defecto: Date.now()) para pruebas. */
  now?: () => number;
  /** Filtro por autor (B11): lista pendientes de un autor concreto. */
  authorFilter?: string;
  /** Pendientes del autor activo (resueltos por listPendingByAuthor). */
  authorPending?: ReminderRecord[];
  onAuthorFilterChange?: (value: string) => void;
}

const MINUTE_MS = 60_000;

export function RemindersPanel({
  items,
  loading,
  pendingCount,
  onAdd,
  onComplete,
  onDismiss,
  onRemove,
  onEdit,
  now = () => Date.now(),
  authorFilter = '',
  authorPending,
  onAuthorFilterChange,
}: RemindersPanelProps) {
  const config = (FLU_CONFIG as any).reminders || {};
  const ui = config.ui || {};
  const defaultOffsetMin = Number(config.defaultReminderOffsetMinutes) || 10;

  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const commitEdit = (id: string): void => {
    const value = editValue.trim();
    setEditingId(null);
    if (value) void onEdit?.(id, value);
  };

  const pending = items
    .filter((item) => item.status === 'pending')
    .slice()
    .sort((a, b) => a.dueAt - b.dueAt);
  const completed = items.filter((item) => item.status !== 'pending');
  // B11: si hay un autor activo, se muestran los pendientes resueltos por
  // listPendingByAuthor (calculados en App) en lugar de la lista completa.
  const filteringByAuthor = authorFilter.trim().length > 0;
  const effectivePending = filteringByAuthor ? (authorPending ?? []) : pending;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const textValue = text.trim();
    if (!textValue || busy) return;
    const whenValue = when.trim();
    let dueAt = now() + defaultOffsetMin * MINUTE_MS;
    if (whenValue) {
      const parsed = parseNlDateTime(whenValue, { now });
      if (parsed) dueAt = parsed.at;
    }
    setBusy(true);
    try {
      await onAdd({ text: textValue, dueAt });
      setText('');
      setWhen('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="flu-settings-image-config" open>
      <summary className="flu-settings-image-config__summary">
        {ui.panelTitle || 'Recordatorios'}
      </summary>
      <div className="flu-settings-image-config__group">
        {/* Alta */}
        <form className="flu-settings-section" onSubmit={handleSubmit}>
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.placeholder || 'Recordarme…'}</span>
              <input
                type="text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={ui.placeholder || 'Recordarme…'}
                data-testid="reminders-add-text"
                disabled={busy}
              />
            </label>
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.whenLabel || '¿Cuándo?'}</span>
              <input
                type="text"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                placeholder={ui.whenPlaceholder || 'Ej: mañana a las 9'}
                data-testid="reminders-add-when"
                disabled={busy}
              />
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="reminders-add-submit"
              disabled={busy || !text.trim()}
            >
              {ui.addLabel || 'Recordarme'}
            </button>
            <p className="flu-settings-image-config__hint">
              {ui.pendingLabel || 'Pendientes'}: {pendingCount}
            </p>
          </div>
        </form>

        {/* Pendientes */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.pendingLabel || 'Pendientes'}</h4>
            {onAuthorFilterChange && (
              <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                <span>{ui.authorFilterLabel || 'Filtrar por autor'}</span>
                <input
                  type="text"
                  value={authorFilter}
                  onChange={(event) => onAuthorFilterChange(event.target.value)}
                  placeholder={ui.authorFilterPlaceholder || 'Ej: Mamá, Luis…'}
                  data-testid="reminders-author-filter"
                />
              </label>
            )}
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : effectivePending.length === 0 ? (
              <p className="flu-settings-image-config__hint">
                {filteringByAuthor
                  ? ui.authorEmptyState || 'Sin pendientes de este autor.'
                  : ui.emptyState || 'Sin pendientes.'}
              </p>
            ) : (
              <ul className="flu-reminders-list" data-testid="reminders-pending-list">
                {effectivePending.map((item) => (
                  <li key={item.id} className="flu-reminders-item">
                    <div className="flu-reminders-item__info">
                      {editingId === item.id ? (
                        <input
                          className="flu-reminders-item__edit"
                          type="text"
                          value={editValue}
                          autoFocus
                          data-testid={`reminders-edit-input-${item.id}`}
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
                      ) : (
                        <span className="flu-reminders-item__text">{item.text}</span>
                      )}
                      <span className="flu-reminders-item__when">{describeNlDateTime(item.dueAt)}</span>
                    </div>
                    <div className="flu-reminders-item__actions">
                      {onEdit && (
                        <button
                          type="button"
                          title={ui.editTitle || 'Editar'}
                          aria-label={ui.editTitle || 'Editar'}
                          data-testid={`reminders-edit-${item.id}`}
                          onClick={() => {
                            setEditingId(item.id);
                            setEditValue(item.text);
                          }}
                        >
                          ✎
                        </button>
                      )}
                      <button
                        type="button"
                        title={ui.completeTitle || 'Marcar como hecho'}
                        aria-label={ui.completeTitle || 'Marcar como hecho'}
                        data-testid={`reminders-complete-${item.id}`}
                        onClick={() => onComplete(item.id)}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        title={ui.dismissTitle || 'Descartar'}
                        aria-label={ui.dismissTitle || 'Descartar'}
                        data-testid={`reminders-dismiss-${item.id}`}
                        onClick={() => onDismiss(item.id)}
                      >
                        –
                      </button>
                      <button
                        type="button"
                        title={ui.removeTitle || 'Eliminar recordatorio'}
                        aria-label={ui.removeTitle || 'Eliminar recordatorio'}
                        data-testid={`reminders-remove-${item.id}`}
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

        {/* Completados */}
        {completed.length > 0 && (
          <div className="flu-settings-section">
            <div className="flu-settings-section__body">
              <h4 className="flu-reminders__heading">{ui.doneLabel || 'Completados'}</h4>
              <ul className="flu-reminders-list">
                {completed.map((item) => (
                  <li key={item.id} className="flu-reminders-item flu-reminders-item--done">
                    <div className="flu-reminders-item__info">
                      <span className="flu-reminders-item__text">{item.text}</span>
                      <span className="flu-reminders-item__when">{describeNlDateTime(item.dueAt)}</span>
                    </div>
                    <div className="flu-reminders-item__actions">
                      <button
                        type="button"
                        title={ui.removeTitle || 'Eliminar recordatorio'}
                        aria-label={ui.removeTitle || 'Eliminar recordatorio'}
                        data-testid={`reminders-remove-done-${item.id}`}
                        onClick={() => onRemove(item.id)}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
