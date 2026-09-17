// ============================================================
// src/components/AgendaPanel.tsx
// UI ÚNICA del calendario unificado (alarmas, recordatorios, citas,
// juntas, clases) — UN solo panel, diferenciados SOLO por color.
// Notas y "próximos" NO viven aquí.
// ============================================================
import { useMemo, useState } from 'react';
import { summarizeAgenda } from '../core/agenda/agendaSummary';
import type { AgendaView } from '../core/agenda/agendaQuery';
import type { AgendaColorMap, AgendaItem, AgendaKind, AgendaTrigger } from '../core/agenda/agendaModel';
import { AGENDA_KINDS } from '../core/agenda/agendaModel';

const VIEWS: ReadonlyArray<{ key: AgendaView; label: string }> = [
    { key: 'day', label: 'Hoy' },
    { key: 'week', label: 'Semana' },
    { key: 'month', label: 'Mes' },
];

export interface AgendaAddInput {
    kind: AgendaKind;
    label: string;
    trigger: AgendaTrigger;
}

export interface AgendaPanelProps {
    items: readonly AgendaItem[];
    colors: AgendaColorMap;
    /** Nombres legibles por tipo (config-driven; sin literales). Opcional. */
    labels?: Partial<Record<AgendaKind, string>>;
    onCancel?: (id: string) => void;
    onAdd?: (input: AgendaAddInput) => void | Promise<void>;
    onEdit?: (id: string, patch: { label?: string; trigger?: AgendaTrigger }) => void | Promise<void>;
    ringing?: { id: string; kind: AgendaKind; label: string; at: number } | null;
    onStop?: () => void;
    now?: number;
}

function toDateTimeLocal(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(value: string): number {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.getTime() : Date.now();
}

export function AgendaPanel({
    items,
    colors,
    labels,
    onCancel,
    onAdd,
    onEdit,
    ringing,
    onStop,
    now,
}: AgendaPanelProps) {
    const [view, setView] = useState<AgendaView>('day');
    const [kind, setKind] = useState<AgendaKind>('recordatorio');
    const [label, setLabel] = useState('');
    const [when, setWhen] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const summary = useMemo(
        () => summarizeAgenda(items, view, typeof now === 'number' ? now : Date.now(), colors),
        [items, view, colors, now],
    );

    const resetForm = () => {
        setKind('recordatorio');
        setLabel('');
        setWhen('');
        setEditingId(null);
    };

    const submit = async () => {
        const text = label.trim();
        if (!text || !onAdd) return;
        const at = when ? fromDateTimeLocal(when) : Date.now();
        setSaving(true);
        try {
            if (editingId && onEdit) {
                await onEdit(editingId, { label: text, trigger: { type: 'absolute', at } });
            } else {
                await onAdd({ kind, label: text, trigger: { type: 'absolute', at } });
            }
            resetForm();
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (item: AgendaItem) => {
        setEditingId(item.id);
        setKind(item.kind);
        setLabel(item.label);
        if (item.trigger.type === 'absolute') setWhen(toDateTimeLocal(item.trigger.at));
        else setWhen('');
    };

    return (
        <div className="agenda-panel" data-testid="agenda-panel">
            <div className="agenda-tabs" role="tablist">
                {VIEWS.map((v) => (
                    <button
                        key={v.key}
                        type="button"
                        role="tab"
                        data-testid={`agenda-view-${v.key}`}
                        aria-selected={view === v.key}
                        className={`agenda-tab${view === v.key ? ' agenda-tab--active' : ''}`}
                        onClick={() => setView(v.key)}
                    >
                        {v.label}
                    </button>
                ))}
            </div>

            {onAdd ? (
                <form
                    className="agenda-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                    }}
                >
                    <select
                        className="agenda-form__kind"
                        value={kind}
                        aria-label="Tipo"
                        onChange={(e) => setKind(e.target.value as AgendaKind)}
                    >
                        {AGENDA_KINDS.map((k) => (
                            <option key={k} value={k}>
                                {labels?.[k] || k}
                            </option>
                        ))}
                    </select>
                    <input
                        className="agenda-form__label"
                        type="text"
                        placeholder="¿Qué? Ej. junta de comité"
                        value={label}
                        aria-label="Descripción"
                        onChange={(e) => setLabel(e.target.value)}
                    />
                    <input
                        className="agenda-form__when"
                        type="datetime-local"
                        value={when}
                        aria-label="Fecha y hora"
                        onChange={(e) => setWhen(e.target.value)}
                    />
                    <button className="agenda-form__submit" type="submit" disabled={saving || !label.trim()}>
                        {editingId ? 'Guardar' : 'Agregar'}
                    </button>
                    {editingId ? (
                        <button className="agenda-form__cancel" type="button" onClick={resetForm}>
                            Cancelar
                        </button>
                    ) : null}
                </form>
            ) : null}

            {ringing ? (
                <div className="agenda-ringing" role="alert">
                    <span className="agenda-ringing__label">
                        ⏰ {labels?.[ringing.kind] || ringing.kind}: {ringing.label}
                    </span>
                    {onStop ? (
                        <button className="agenda-ringing__stop" type="button" onClick={onStop}>
                            Detener
                        </button>
                    ) : null}
                </div>
            ) : null}

            {summary.empty ? (
                <p className="agenda-empty" data-testid="agenda-empty">
                    Sin pendientes.
                </p>
            ) : (
                <ul className="agenda-list">
                    {summary.lines.map((line) => {
                        const item = items.find((i) => i.id === line.id);
                        return (
                            <li key={line.id} className="agenda-item" data-testid={`agenda-item-${line.id}`}>
                                <span className="agenda-item__swatch" style={{ background: line.color }} aria-hidden="true" />
                                <div className="agenda-item__body">
                                    <span className="agenda-item__time">{line.time}</span>
                                    <span className="agenda-item__label">{line.label}</span>
                                    {item?.kind ? (
                                        <span className="agenda-item__kind">{labels?.[item.kind] || item.kind}</span>
                                    ) : null}
                                </div>
                                <div className="agenda-item__actions">
                                    {item && onEdit ? (
                                        <button
                                            className="agenda-item__edit"
                                            type="button"
                                            aria-label="Editar"
                                            onClick={() => startEdit(item)}
                                        >
                                            ✎
                                        </button>
                                    ) : null}
                                    {onCancel ? (
                                        <button
                                            className="agenda-item__cancel"
                                            type="button"
                                            aria-label="Cancelar"
                                            data-testid={`agenda-cancel-${line.id}`}
                                            onClick={() => onCancel(line.id)}
                                        >
                                            ×
                                        </button>
                                    ) : null}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
