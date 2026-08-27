// ============================================================
// Session Dashboard
// ============================================================
// Multi-session dashboard showing history, stats, and
// navigation across sessions. Provides a high-level view
// of all FLU interactions.
//
// Cumple:
//   - Rule #1: NO HARDCODE
//   - React component (UI)
// ============================================================

import React, { useMemo } from 'react';
import type { ConversationEntry, MinuteEntry, SessionStats } from '../types/bridge';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface SessionSummary {
    id: string;
    date: string;
    duration: string;
    messageCount: number;
    participantCount: number;
    minuteCount: number;
    topTopics: string[];
}

export interface SessionDashboardProps {
    history: ConversationEntry[];
    minutes: MinuteEntry[];
    stats: SessionStats | null;
    language?: 'es' | 'en';
    onSelectSession?: (sessionId: string) => void;
}

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

const STOP_WORDS = new Set([
    'el', 'la', 'los', 'las', 'de', 'del', 'que', 'en', 'un', 'una',
    'y', 'e', 'o', 'a', 'con', 'por', 'para', 'es', 'se', 'no',
    'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
    'is', 'it', 'with', 'this', 'that', 'pero', 'más', 'muy',
]);

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

function extractTopics(entries: ConversationEntry[], max: number = 5): string[] {
    const freq = new Map<string, number>();
    for (const entry of entries) {
        const words = (entry.text || '').toLowerCase().split(/\s+/);
        for (const word of words) {
            if (word.length > 3 && !STOP_WORDS.has(word)) {
                freq.set(word, (freq.get(word) || 0) + 1);
            }
        }
    }
    return Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([word]) => word);
}

function formatDuration(ms: number): string {
    if (ms <= 0) return '—';
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
}

function getUniqueSpeakers(entries: ConversationEntry[]): number {
    const names = new Set<string>();
    for (const entry of entries) {
        names.add(entry.speakerName || (entry.role === 'flu' ? 'FLU' : 'User'));
    }
    return names.size;
}

// -----------------------------------------------------------
// Sub-components
// -----------------------------------------------------------

function StatCard({
    label,
    value,
    icon,
}: {
    label: string;
    value: string | number;
    icon: string;
}) {
    return (
        <div className="dashboard-stat-card">
            <span className="dashboard-stat-icon">{icon}</span>
            <div className="dashboard-stat-body">
                <span className="dashboard-stat-value">{value}</span>
                <span className="dashboard-stat-label">{label}</span>
            </div>
        </div>
    );
}

// -----------------------------------------------------------
// Main Component
// -----------------------------------------------------------

export function SessionDashboard({
    history,
    minutes,
    stats,
    language = 'es',
    onSelectSession,
}: SessionDashboardProps) {
    const summary = useMemo((): SessionSummary | null => {
        if (history.length === 0) return null;

        const timestamps = history
            .map((e) => e.timestamp)
            .filter((t): t is number => typeof t === 'number')
            .sort((a, b) => a - b);

        const durationMs = timestamps.length > 1
            ? timestamps[timestamps.length - 1] - timestamps[0]
            : 0;

        return {
            id: `session_${timestamps[0] || Date.now()}`,
            date: timestamps[0] ? new Date(timestamps[0]).toLocaleDateString() : '—',
            duration: formatDuration(durationMs),
            messageCount: history.length,
            participantCount: getUniqueSpeakers(history),
            minuteCount: minutes.length,
            topTopics: extractTopics(history, 5),
        };
    }, [history, minutes]);

    return (
        <div className="session-dashboard">
            {/* Current Session Stats */}
            <div className="dashboard-section">
                <h3 className="dashboard-section-title">
                    {language === 'es' ? 'Sesión Actual' : 'Current Session'}
                </h3>

                {summary ? (
                    <div className="dashboard-stats-grid">
                        <StatCard
                            label={language === 'es' ? 'Mensajes' : 'Messages'}
                            value={summary.messageCount}
                            icon="💬"
                        />
                        <StatCard
                            label={language === 'es' ? 'Participantes' : 'Participants'}
                            value={summary.participantCount}
                            icon="👥"
                        />
                        <StatCard
                            label={language === 'es' ? 'Duración' : 'Duration'}
                            value={summary.duration}
                            icon="⏱"
                        />
                        <StatCard
                            label={language === 'es' ? 'Minutas' : 'Minutes'}
                            value={summary.minuteCount}
                            icon="📝"
                        />
                        <StatCard
                            label={language === 'es' ? 'Interacciones totales' : 'Total interactions'}
                            value={stats?.totalInteractions ?? history.length}
                            icon="🔄"
                        />
                        <StatCard
                            label={language === 'es' ? 'Inicio' : 'Started'}
                            value={summary.date}
                            icon="📅"
                        />
                    </div>
                ) : (
                    <p className="dashboard-empty">
                        {language === 'es'
                            ? 'No hay datos de sesión disponibles'
                            : 'No session data available'}
                    </p>
                )}
            </div>

            {/* Topics */}
            {summary && summary.topTopics.length > 0 && (
                <div className="dashboard-section">
                    <h3 className="dashboard-section-title">
                        {language === 'es' ? 'Temas principales' : 'Main topics'}
                    </h3>
                    <div className="dashboard-topics">
                        {summary.topTopics.map((topic) => (
                            <span key={topic} className="dashboard-topic-tag">
                                {topic}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Recent Minutes */}
            {minutes.length > 0 && (
                <div className="dashboard-section">
                    <h3 className="dashboard-section-title">
                        {language === 'es' ? 'Minutas recientes' : 'Recent minutes'}
                    </h3>
                    <div className="dashboard-minute-list">
                        {minutes.slice(0, 5).map((minute) => (
                            <div
                                key={minute.id}
                                className="dashboard-minute-item"
                                onClick={() => onSelectSession?.(minute.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        onSelectSession?.(minute.id);
                                    }
                                }}
                            >
                                <span className="dashboard-minute-title">
                                    {minute.summarySnapshot?.titulo || minute.historyCode || 'Minute'}
                                </span>
                                <span className="dashboard-minute-date">
                                    {minute.createdAt
                                        ? new Date(minute.createdAt).toLocaleDateString()
                                        : '—'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Quick Stats from integration store */}
            {stats && (
                <div className="dashboard-section">
                    <h3 className="dashboard-section-title">
                        {language === 'es' ? 'Estadísticas' : 'Statistics'}
                    </h3>
                    <div className="dashboard-stats-detailed">
                        <div className="dashboard-stat-row">
                            <span>{language === 'es' ? 'Mensajes de usuario' : 'User messages'}</span>
                            <span className="dashboard-stat-number">{stats.totalUserMessages}</span>
                        </div>
                        <div className="dashboard-stat-row">
                            <span>{language === 'es' ? 'Mensajes de FLU' : 'FLU messages'}</span>
                            <span className="dashboard-stat-number">{stats.totalFluMessages}</span>
                        </div>
                        <div className="dashboard-stat-row">
                            <span>{language === 'es' ? 'Inicio de sesión' : 'Session start'}</span>
                            <span className="dashboard-stat-number">
                                {stats.sessionStartTime
                                    ? new Date(stats.sessionStartTime).toLocaleTimeString()
                                    : '—'}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
