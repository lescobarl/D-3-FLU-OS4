// ============================================================
// src/components/AgendaPanel.tsx
// UI ÚNICA del calendario unificado (alarmas, recordatorios, citas,
// juntas, clases) — UN solo listado, diferenciado SOLO por color.
// ------------------------------------------------------------
// Secciones del panel lateral:
//   - PRÓXIMOS: resumen de lo próximo (top-N pendientes).
//   - AGENDA:   listado único día/semana/mes + agregar/editar/cancelar.
//   - (NOTAS vive aparte, en su propia sección del Pizarrón).
// Reutiliza el lenguaje visual del Pizarrón (`.hoy-panel__*`) ya definido
// en unified.css: sin CSS nuevo, sin hardcode de colores (derivados de
// FLU_CONFIG.agenda.colors en lectura).
// ============================================================
import { useMemo, useState } from 'react';
import { summarizeAgenda } from '../core/agenda/agendaSummary';
import type { AgendaView } from '../core/agenda/agendaQuery';
import type { AgendaColorMap, AgendaItem, AgendaKind, AgendaTrigger } from '../core/agenda/agendaModel';
import { AGENDA_KINDS, nextAgendaDue } from '../core/agenda/agendaModel';

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

export interface AgendaNoteEntry {
    id: string;
    label: string;
}

export interface AgendaNotesProps {
    items: ReadonlyArray<AgendaNoteEntry>;
    onAdd?: (label: string) => void;
    onEdit?: (id: string, label: string) => void;
    onRemove?: (id: string) => void;
}

export interface AgendaPanelProps {
    items: readonly AgendaItem[];
    colors: AgendaColorMap;
    /** Nombres legibles por tipo (config-driven; sin literales). Opcional. */
    labels?: Partial<Record<AgendaKind, string>>;
    /** Notas (texto, sin fecha): viven en su propia sección, no en el calendario. */
    notes?: AgendaNotesProps;
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

function formatDayLabel(ms: number, lang?: string): string {
    const d = new Date(ms);
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    if (lang === 'en') {
        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    }
    return `${days[d.getDay()]} ${d.getDate()} de ${months[d.getMonth()]}`;
}

function formatTimeLabel(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AgendaPanel({
    items,
    colors,
    labels,
    notes,
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
    const [noteDraft, setNoteDraft] = useState('');
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [editingNoteLabel, setEditingNoteLabel] = useState('');

    const submitNote = () => {
        const text = noteDraft.trim();
        if (!text || !notes?.onAdd) return;
        notes.onAdd(text);
        setNoteDraft('');
    };

    const startEditNote = (n: AgendaNoteEntry) => {
        setEditingNoteId(n.id);
        setEditingNoteLabel(n.label);
    };

    const saveNoteEdit = () => {
        if (!editingNoteId || !notes?.onEdit) return;
        const text = editingNoteLabel.trim();
        if (text) notes.onEdit(editingNoteId, text);
        setEditingNoteId(null);
        setEditingNoteLabel('');
    };

    const nowMs = typeof now === 'number' ? now : Date.now();

    const summary = useMemo(
        () => summarizeAgenda(items, view, nowMs, colors),
        [items, view, colors, nowMs],
    );

    // PRÓXIMOS: pendientes ordenados por su siguiente vencimiento (top 3).
    const proximos = useMemo(() => {
        return items
            .filter((i) => i.status === 'pending')
            .map((i) => ({ item: i, due: nextAgendaDue(i.trigger, nowMs) }))
            .filter((e) => Number.isFinite(e.due))
            .sort((a, b) => a.due - b.due)
            .slice(0, 3);
    }, [items, nowMs]);

    const resetForm = () => {
        setKind('recordatorio');
        setLabel('');
        setWhen('');
        setEditingId(null);
    };

    const submit = async () => {
        const text = label.trim();
        if (!text || !onAdd) return;
        const at = when ? fromDateTimeLocal(when) : nowMs;
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

    const kindLabel = (k: AgendaKind): string => labels?.[k] || k;

    return (
        <div className="hoy-panel" data-testid="agenda-panel">
            <header className="hoy-panel__header">
                <span className="hoy-panel__header-title">{labels ? 'Agenda' : 'Agenda'}</span>
                <span className="hoy-panel__header-date">{formatDayLabel(nowMs)}</span>
            </header>

            {/* PRÓXIMOS */}
            <section className="hoy-panel__section" aria-label="Próximos">
                <h4 className="hoy-panel__section-title">Próximos</h4>
                {proximos.length === 0 ? (
                    <p className="hoy-panel__empty">Sin próximos.</p>
                ) : (
                    proximos.map(({ item, due }) => (
                        <div key={item.id} className="hoy-panel__card" style={{ borderLeftColor: colors[item.kind] }}>
                            <span className="hoy-panel__card-time">{formatTimeLabel(due)}</span>
                            <div className="hoy-panel__card-body">
                                <span className="hoy-panel__card-title">{item.label}</span>
                                <span className="hoy-panel__card-meta">{kindLabel(item.kind)}</span>
                            </div>
                        </div>
                    ))
                )}
            </section>

            {/* AGENDA — un solo listado día/semana/mes */}
            <section className="hoy-panel__section" aria-label="Agenda">
                <h4 className="hoy-panel__section-title">Agenda</h4>

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
                                    {kindLabel(k)}
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
                            ⏰ {kindLabel(ringing.kind)}: {ringing.label}
                        </span>
                        {onStop ? (
                            <button className="agenda-ringing__stop" type="button" onClick={onStop}>
                                Detener
                            </button>
                        ) : null}
                    </div>
                ) : null}

                {summary.empty ? (
                    <p className="hoy-panel__empty" data-testid="agenda-empty">Sin pendientes.</p>
                ) : (
                    <ul className="agenda-list">
                        {summary.lines.map((line) => {
                            const item = items.find((i) => i.id === line.id);
                            return (
                                <li key={line.id} className="hoy-panel__card" data-testid={`agenda-item-${line.id}`} style={{ borderLeftColor: line.color }}>
                                    <span className="hoy-panel__card-time">{line.time}</span>
                                    <div className="hoy-panel__card-body">
                                        <span className="hoy-panel__card-title">{line.label}</span>
                                        {item?.kind ? (
                                            <span className="hoy-panel__card-meta">{kindLabel(item.kind)}</span>
                                        ) : null}
                                    </div>
                                    <div className="agenda-item__actions">
                                        {item && onEdit ? (
                                            <button className="agenda-item__edit" type="button" aria-label="Editar" onClick={() => startEdit(item)}>
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
            </section>

            {/* NOTAS — separadas (texto, sin fecha) */}
            {notes ? (
                <section className="hoy-panel__section" aria-label="Notas">
                    <h4 className="hoy-panel__section-title">Notas</h4>
                    {notes.items.length === 0 ? (
                        <p className="hoy-panel__empty">Aún no hay notas.</p>
                    ) : (
                        notes.items.map((n) => (
                            <div key={n.id} className="hoy-panel__card">
                                <div className="hoy-panel__card-body">
                                    {editingNoteId === n.id ? (
                                        <input
                                            className="agenda-form__label"
                                            type="text"
                                            value={editingNoteLabel}
                                            aria-label="Editar nota"
                                            autoFocus
                                            onChange={(e) => setEditingNoteLabel(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    saveNoteEdit();
                                                } else if (e.key === 'Escape') {
                                                    setEditingNoteId(null);
                                                }
                                            }}
                                        />
                                    ) : (
                                        <span className="hoy-panel__card-title">{n.label}</span>
                                    )}
                                </div>
                                <div className="agenda-item__actions">
                                    {editingNoteId === n.id ? (
                                        <button
                                            className="agenda-item__edit"
                                            type="button"
                                            aria-label="Guardar nota"
                                            onClick={saveNoteEdit}
                                        >
                                            ✓
                                        </button>
                                    ) : (
                                        notes.onEdit ? (
                                            <button
                                                className="agenda-item__edit"
                                                type="button"
                                                aria-label="Editar nota"
                                                onClick={() => startEditNote(n)}
                                            >
                                                ✎
                                            </button>
                                        ) : null
                                    )}
                                    {notes.onRemove ? (
                                        <button
                                            className="agenda-item__cancel"
                                            type="button"
                                            aria-label="Borrar nota"
                                            onClick={() => notes.onRemove?.(n.id)}
                                        >
                                            ×
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ))
                    )}
                    {notes.onAdd ? (
                        <form
                            className="agenda-form"
                            onSubmit={(e) => {
                                e.preventDefault();
                                submitNote();
                            }}
                        >
                            <input
                                className="agenda-form__label"
                                type="text"
                                placeholder="Nueva nota…"
                                value={noteDraft}
                                aria-label="Nueva nota"
                                onChange={(e) => setNoteDraft(e.target.value)}
                            />
                            <button className="agenda-form__submit" type="submit" disabled={!noteDraft.trim()}>
                                Agregar
                            </button>
                        </form>
                    ) : null}
                </section>
            ) : null}
        </div>
    );
}
