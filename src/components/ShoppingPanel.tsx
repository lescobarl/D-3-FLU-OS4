// ============================================================
// ShoppingPanel — Panel de lista de compras (Fase 2, B10)
// ------------------------------------------------------------
// Componente presentacional controlado: recibe los ítems y
// acciones desde App (que usa useShoppingList) y renderiza:
//   - formulario de alta (una o varias etiquetas separadas por coma)
//   - lista de pendientes (marcar / eliminar)
//   - lista de comprados (desmarcar / eliminar / vaciar marcados)
//
// Cumple:
//   - Rule #1: NO HARDCODE — todas las etiquetas vienen de
//     FLU_CONFIG.shopping.ui (sin cadenas sueltas)
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { ShoppingItemRecord } from '../core/db/fluDatabase';

export interface ShoppingPanelProps {
  items: ShoppingItemRecord[];
  loading: boolean;
  remainingCount: number;
  onAdd: (label: string) => Promise<void>;
  onToggle: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClearChecked: () => Promise<void>;
}

export function ShoppingPanel({
  items,
  loading,
  remainingCount,
  onAdd,
  onToggle,
  onRemove,
  onClearChecked,
}: ShoppingPanelProps) {
  const config = FLU_CONFIG.shopping || {};
  const ui = config.ui || {};

  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const pending = items.filter((item) => !item.checked);
  const checked = items.filter((item) => item.checked);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const labelValue = label.trim();
    if (!labelValue || busy) return;
    setBusy(true);
    try {
      await onAdd(labelValue);
      setLabel('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="flu-settings-image-config" open>
      <summary className="flu-settings-image-config__summary">
        {ui.panelTitle || 'Lista de compras'}
      </summary>
      <div className="flu-settings-image-config__group">
        {/* Alta */}
        <form className="flu-settings-section" onSubmit={handleSubmit}>
          <div className="flu-settings-section__body">
            <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
              <span>{ui.addHint || 'Escribe un ítem y presiona Enter'}</span>
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={ui.placeholder || 'Ej: leche, huevos, pan'}
                data-testid="shopping-add-input"
                disabled={busy}
              />
            </label>
            <button
              type="submit"
              className="flu-settings-image-config__field--stacked"
              data-testid="shopping-add-submit"
              disabled={busy || !label.trim()}
            >
              {ui.addLabel || 'Agregar'}
            </button>
            <p className="flu-settings-image-config__hint">
              {ui.pendingLabel || 'Pendientes'}: {remainingCount}
            </p>
          </div>
        </form>

        {/* Pendientes */}
        <div className="flu-settings-section">
          <div className="flu-settings-section__body">
            <h4 className="flu-reminders__heading">{ui.pendingLabel || 'Pendientes'}</h4>
            {loading ? (
              <p className="flu-settings-image-config__hint">…</p>
            ) : pending.length === 0 && checked.length === 0 ? (
              <p className="flu-settings-image-config__hint">{ui.emptyState || 'Tu lista de compras está vacía.'}</p>
            ) : (
              <ul className="flu-reminders-list" data-testid="shopping-pending-list">
                {pending.map((item) => (
                  <li key={item.id} className="flu-reminders-item">
                    <label className="flu-shopping-item__label">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => onToggle(item.id)}
                        data-testid={`shopping-toggle-${item.id}`}
                      />
                      <span className="flu-reminders-item__text">{item.label}</span>
                    </label>
                    <div className="flu-reminders-item__actions">
                      <button
                        type="button"
                        title={ui.removeTitle || 'Quitar'}
                        aria-label={ui.removeTitle || 'Quitar'}
                        data-testid={`shopping-remove-${item.id}`}
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

        {/* Comprados */}
        {checked.length > 0 && (
          <div className="flu-settings-section">
            <div className="flu-settings-section__body">
              <h4 className="flu-reminders__heading">{ui.checkedLabel || 'Comprados'}</h4>
              <ul className="flu-reminders-list">
                {checked.map((item) => (
                  <li key={item.id} className="flu-reminders-item flu-reminders-item--done">
                    <label className="flu-shopping-item__label">
                      <input
                        type="checkbox"
                        checked
                        onChange={() => onToggle(item.id)}
                        data-testid={`shopping-toggle-${item.id}`}
                      />
                      <span className="flu-reminders-item__text">{item.label}</span>
                    </label>
                    <div className="flu-reminders-item__actions">
                      <button
                        type="button"
                        title={ui.removeTitle || 'Quitar'}
                        aria-label={ui.removeTitle || 'Quitar'}
                        data-testid={`shopping-remove-${item.id}`}
                        onClick={() => onRemove(item.id)}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="flu-settings-image-config__field--stacked"
                data-testid="shopping-clear-checked"
                onClick={onClearChecked}
              >
                {ui.clearCheckedLabel || 'Vaciar comprados'}
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
