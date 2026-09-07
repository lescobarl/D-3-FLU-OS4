// ============================================================
// NotificationCenterBell — Campana del centro de notificaciones
// ------------------------------------------------------------
// Presentacional: recibe el historial por props. Muestra un badge
// con las no leídas y abre un panel con el listado (Hoy / Ayer /
// Antes), con "Marcar todo leído" y "Limpiar". Etiquetas desde
// FLU_CONFIG.notifications.ui (Regla #1: sin hardcode).
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { NotificationCenterItem } from '../hooks/useNotificationCenter';
import './NotificationCenterBell.css';

export interface NotificationCenterBellProps {
    items: NotificationCenterItem[];
    unread: number;
    onMarkAllRead: () => void;
    onClear: () => void;
    language?: string;
}

function timeLabel(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(ts: number, now: number): string {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const day = new Date(ts);
    day.setHours(0, 0, 0, 0);
    const diff = Math.round((start.getTime() - day.getTime()) / 86400000);
    if (diff <= 0) return 'hoy';
    if (diff === 1) return 'ayer';
    return day.toLocaleDateString();
}

const CATEGORY_ICON: Record<string, string> = {
    reminder: '⏰',
    temporal: '🔔',
    alarm: '🔔',
    timer: '⏱️',
    system: '🛠️',
    autonomy: '🤖',
    success: '✅',
};

export function NotificationCenterBell({
    items,
    unread,
    onMarkAllRead,
    onClear,
    language = 'es',
}: NotificationCenterBellProps) {
    const ui = ((FLU_CONFIG as any)?.notifications?.ui as Record<string, string>) || {};
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const now = Date.now();
    const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);
    // Agrupar manteniendo orden: Hoy → Ayer → fechas anteriores.
    const groups: Array<{ label: string; rows: NotificationCenterItem[] }> = [];
    for (const row of sorted) {
        const label = dayLabel(row.timestamp, now);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.rows.push(row);
        else groups.push({ label, rows: [row] });
    }

    return (
        <div className="notif-bell" ref={rootRef} data-testid="notif-center">
            <button
                type="button"
                className="notif-bell__trigger"
                aria-label={ui.bellLabel || 'Centro de notificaciones'}
                aria-expanded={open}
                data-testid="notif-bell-trigger"
                onClick={() => setOpen((v) => !v)}
            >
                🔔
                {unread > 0 && (
                    <span className="notif-bell__badge" data-testid="notif-bell-badge">
                        {unread > 99 ? '99+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="notif-bell__panel" data-testid="notif-bell-panel">
                    <header className="notif-bell__panel-header">
                        <strong>{ui.title || 'Notificaciones'}</strong>
                        <div className="notif-bell__panel-actions">
                            <button
                                type="button"
                                onClick={onMarkAllRead}
                                disabled={unread === 0}
                                data-testid="notif-mark-read"
                            >
                                {ui.markAllRead || 'Marcar leído'}
                            </button>
                            <button type="button" onClick={onClear} disabled={items.length === 0} data-testid="notif-clear">
                                {ui.clear || 'Limpiar'}
                            </button>
                        </div>
                    </header>
                    <div className="notif-bell__list" data-testid="notif-bell-list">
                        {groups.length === 0 ? (
                            <p className="notif-bell__empty">{ui.empty || 'Sin notificaciones'}</p>
                        ) : (
                            groups.map((group) => (
                                <section key={group.label} className="notif-bell__group">
                                    <h4 className="notif-bell__group-title">
                                        {group.label === 'hoy'
                                            ? ui.today || 'Hoy'
                                            : group.label === 'ayer'
                                              ? ui.yesterday || 'Ayer'
                                              : group.label}
                                    </h4>
                                    {group.rows.map((row) => (
                                        <article
                                            key={row.id}
                                            className={`notif-bell__item${row.read ? '' : ' notif-bell__item--unread'}`}
                                            data-testid="notif-item"
                                        >
                                            <span className="notif-bell__item-icon" aria-hidden="true">
                                                {CATEGORY_ICON[row.category] || 'ℹ️'}
                                            </span>
                                            <div className="notif-bell__item-body">
                                                <span className="notif-bell__item-title">{row.title}</span>
                                                <span className="notif-bell__item-text">{row.body}</span>
                                            </div>
                                            <time className="notif-bell__item-time" dateTime={new Date(row.timestamp).toISOString()}>
                                                {timeLabel(row.timestamp)}
                                            </time>
                                        </article>
                                    ))}
                                </section>
                            ))
                        )}
                    </div>
                    <footer className="notif-bell__footer">
                        <span className="notif-bell__hint">{language === 'en' ? ui.channelHintEn || '' : ui.channelHint || ''}</span>
                    </footer>
                </div>
            )}
        </div>
    );
}

export default NotificationCenterBell;
