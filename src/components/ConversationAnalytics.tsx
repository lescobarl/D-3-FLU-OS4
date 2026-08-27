// ============================================================
// Conversation Analytics Panel
// ============================================================
// Displays real-time analytics about the conversation:
// - Speaker distribution (who talks most)
// - Sentiment trends over time
// - Topic frequency
// - Turn counts and timing
//
// Cumple:
//   - Rule #1: NO HARDCODE
//   - React component (UI)
// ============================================================

import React, { useMemo } from 'react';
import type { ConversationEntry } from '../types/bridge';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface ConversationAnalyticsProps {
    history: ConversationEntry[];
    language?: 'es' | 'en';
}

interface SpeakerStats {
    name: string;
    messageCount: number;
    totalChars: number;
    avgMessageLength: number;
    percentage: number;
}

interface SentimentPoint {
    index: number;
    sentiment: string;
    label: string;
}

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

const SENTIMENT_COLORS: Record<string, string> = {
    positive: '#4caf50',
    negative: '#f44336',
    neutral: '#9e9e9e',
    mixed: '#ff9800',
};

const SENTIMENT_LABELS: Record<string, { es: string; en: string }> = {
    positive: { es: 'Positivo', en: 'Positive' },
    negative: { es: 'Negativo', en: 'Negative' },
    neutral: { es: 'Neutral', en: 'Neutral' },
    mixed: { es: 'Mixto', en: 'Mixed' },
};

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

function getSentimentLabel(sentiment: string | undefined, language: string): string {
    if (!sentiment) return language === 'es' ? 'Neutral' : 'Neutral';
    return SENTIMENT_LABELS[sentiment]?.[language as 'es' | 'en'] || sentiment;
}

// -----------------------------------------------------------
// Sub-components
// -----------------------------------------------------------

function SpeakerDistribution({ speakers }: { speakers: SpeakerStats[] }) {
    const maxPercentage = Math.max(...speakers.map((s) => s.percentage), 1);

    return (
        <div className="analytics-section">
            <h4 className="analytics-section-title">Speaker Distribution</h4>
            <div className="analytics-bar-chart">
                {speakers.map((speaker) => (
                    <div key={speaker.name} className="analytics-bar-row">
                        <span className="analytics-bar-label">{speaker.name}</span>
                        <div className="analytics-bar-track">
                            <div
                                className="analytics-bar-fill"
                                style={{
                                    width: `${(speaker.percentage / maxPercentage) * 100}%`,
                                }}
                            />
                        </div>
                        <span className="analytics-bar-value">
                            {speaker.messageCount} ({speaker.percentage.toFixed(0)}%)
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SentimentTimeline({ points }: { points: SentimentPoint[] }) {
    if (points.length === 0) return null;

    return (
        <div className="analytics-section">
            <h4 className="analytics-section-title">Sentiment Timeline</h4>
            <div className="analytics-sentiment-dots">
                {points.map((point) => (
                    <div
                        key={point.index}
                        className="analytics-sentiment-dot"
                        style={{
                            backgroundColor: SENTIMENT_COLORS[point.sentiment] || '#9e9e9e',
                        }}
                        title={`#${point.index + 1}: ${point.label}`}
                    />
                ))}
            </div>
            <div className="analytics-sentiment-legend">
                {Object.entries(SENTIMENT_COLORS).map(([key, color]) => (
                    <span key={key} className="analytics-legend-item">
                        <span
                            className="analytics-legend-dot"
                            style={{ backgroundColor: color }}
                        />
                        {key}
                    </span>
                ))}
            </div>
        </div>
    );
}

// -----------------------------------------------------------
// Main Component
// -----------------------------------------------------------

export function ConversationAnalytics({ history, language = 'es' }: ConversationAnalyticsProps) {
    const analytics = useMemo(() => {
        // Speaker stats
        const speakerMap = new Map<string, { count: number; chars: number }>();
        for (const entry of history) {
            const name = entry.speakerName || (entry.role === 'flu' ? 'FLU' : 'User');
            const existing = speakerMap.get(name) || { count: 0, chars: 0 };
            existing.count += 1;
            existing.chars += (entry.text || '').length;
            speakerMap.set(name, existing);
        }

        const totalMessages = history.length;
        const speakers: SpeakerStats[] = Array.from(speakerMap.entries())
            .map(([name, stats]) => ({
                name,
                messageCount: stats.count,
                totalChars: stats.chars,
                avgMessageLength: stats.count > 0 ? Math.round(stats.chars / stats.count) : 0,
                percentage: totalMessages > 0 ? (stats.count / totalMessages) * 100 : 0,
            }))
            .sort((a, b) => b.messageCount - a.messageCount);

        // Sentiment timeline
        const sentimentPoints: SentimentPoint[] = history
            .map((entry, index) => ({
                index,
                sentiment: entry.sentiment || 'neutral',
                label: getSentimentLabel(entry.sentiment, language),
            }))
            .filter((p) => p.sentiment !== 'neutral' || p.index % 5 === 0); // sample neutral

        // Topic extraction (simple word frequency)
        const wordFreq = new Map<string, number>();
        const stopWords = new Set([
            'el', 'la', 'los', 'las', 'de', 'del', 'que', 'en', 'un', 'una',
            'y', 'e', 'o', 'a', 'con', 'por', 'para', 'es', 'se', 'no',
            'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
            'is', 'it', 'with', 'this', 'that',
        ]);

        for (const entry of history) {
            const words = (entry.text || '').toLowerCase().split(/\s+/);
            for (const word of words) {
                if (word.length > 3 && !stopWords.has(word)) {
                    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
                }
            }
        }

        const topTopics = Array.from(wordFreq.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        // Timing
        const timestamps = history
            .map((e) => e.timestamp)
            .filter((t): t is number => typeof t === 'number')
            .sort((a, b) => a - b);

        const totalDurationMs = timestamps.length > 1
            ? timestamps[timestamps.length - 1] - timestamps[0]
            : 0;

        const avgGapMs = timestamps.length > 2
            ? timestamps.slice(1).reduce((sum, t, i) => sum + (t - timestamps[i]), 0) / (timestamps.length - 1)
            : 0;

        return { speakers, sentimentPoints, topTopics, totalDurationMs, avgGapMs, totalMessages };
    }, [history, language]);

    const formatDuration = (ms: number): string => {
        if (ms <= 0) return '—';
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        return `${mins}m ${secs}s`;
    };

    return (
        <div className="conversation-analytics">
            <div className="analytics-grid">
                {/* Summary Stats */}
                <div className="analytics-card">
                    <div className="analytics-stat">
                        <span className="analytics-stat-value">{analytics.totalMessages}</span>
                        <span className="analytics-stat-label">
                            {language === 'es' ? 'Mensajes totales' : 'Total messages'}
                        </span>
                    </div>
                </div>
                <div className="analytics-card">
                    <div className="analytics-stat">
                        <span className="analytics-stat-value">{analytics.speakers.length}</span>
                        <span className="analytics-stat-label">
                            {language === 'es' ? 'Participantes' : 'Participants'}
                        </span>
                    </div>
                </div>
                <div className="analytics-card">
                    <div className="analytics-stat">
                        <span className="analytics-stat-value">{formatDuration(analytics.totalDurationMs)}</span>
                        <span className="analytics-stat-label">
                            {language === 'es' ? 'Duración' : 'Duration'}
                        </span>
                    </div>
                </div>
                <div className="analytics-card">
                    <div className="analytics-stat">
                        <span className="analytics-stat-value">
                            {analytics.avgGapMs > 0 ? `${Math.round(analytics.avgGapMs / 1000)}s` : '—'}
                        </span>
                        <span className="analytics-stat-label">
                            {language === 'es' ? 'Intervalo promedio' : 'Avg. gap'}
                        </span>
                    </div>
                </div>

                {/* Speaker Distribution */}
                <div className="analytics-card analytics-card--wide">
                    <SpeakerDistribution speakers={analytics.speakers} />
                </div>

                {/* Sentiment Timeline */}
                <div className="analytics-card analytics-card--wide">
                    <SentimentTimeline points={analytics.sentimentPoints} />
                </div>

                {/* Top Topics */}
                <div className="analytics-card analytics-card--wide">
                    <div className="analytics-section">
                        <h4 className="analytics-section-title">
                            {language === 'es' ? 'Temas frecuentes' : 'Frequent topics'}
                        </h4>
                        <div className="analytics-tags">
                            {analytics.topTopics.map(([word, freq]) => (
                                <span key={word} className="analytics-tag">
                                    {word}
                                    <span className="analytics-tag-count">{freq}</span>
                                </span>
                            ))}
                            {analytics.topTopics.length === 0 && (
                                <span className="analytics-empty">
                                    {language === 'es' ? 'Sin datos suficientes' : 'Not enough data'}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
