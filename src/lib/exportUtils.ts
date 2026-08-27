// ============================================================
// Export Utilities — Conversation & Minute Export
// ============================================================
// Pure functions for exporting conversation history and minutes
// in various formats (JSON, Markdown, TXT).
//
// Cumple:
//   - Rule #1: NO HARDCODE
//   - Pure functions — no React dependencies
// ============================================================

import type { ConversationEntry, MinuteEntry } from '../types/bridge';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export type ExportFormat = 'json' | 'markdown' | 'txt';

export interface ExportOptions {
    /** Include timestamps */
    includeTimestamps: boolean;
    /** Include metadata (session info, speaker stats) */
    includeMetadata: boolean;
    /** Max entries to export (0 = all) */
    maxEntries: number;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
    includeTimestamps: true,
    includeMetadata: true,
    maxEntries: 0,
};

// -----------------------------------------------------------
// JSON Export
// -----------------------------------------------------------

/**
 * Export conversation history as a JSON string.
 */
export function exportAsJson(
    history: ConversationEntry[],
    minutes: MinuteEntry[],
    metadata: Record<string, unknown> = {},
    options: Partial<ExportOptions> = {},
): string {
    const cfg: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };
    const entries = cfg.maxEntries > 0 ? history.slice(-cfg.maxEntries) : history;

    const data: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        ...metadata,
        conversation: entries.map((entry) => ({
            id: entry.id,
            role: entry.role,
            speakerName: entry.speakerName,
            text: entry.text,
            timestamp: cfg.includeTimestamps ? entry.timestamp : undefined,
            sentiment: entry.sentiment,
            response: entry.response,
        })),
        minutes: minutes.map((m) => ({
            id: m.id,
            title: m.summarySnapshot?.titulo || m.summarySnapshot?.tema_sesion || '',
            content: m.summarySnapshot?.resumen || '',
            keyPoints: m.summarySnapshot?.acuerdos || [],
            createdAt: m.createdAt,
        })),
    };

    return JSON.stringify(data, null, 2);
}

// -----------------------------------------------------------
// Markdown Export
// -----------------------------------------------------------

/**
 * Format a timestamp for display.
 */
function formatTimestamp(ts: number | string): string {
    const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
    return d.toLocaleString();
}

/**
 * Export conversation history as a Markdown string.
 */
export function exportAsMarkdown(
    history: ConversationEntry[],
    minutes: MinuteEntry[],
    metadata: Record<string, unknown> = {},
    options: Partial<ExportOptions> = {},
): string {
    const cfg: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };
    const entries = cfg.maxEntries > 0 ? history.slice(-cfg.maxEntries) : history;

    const lines: string[] = [];

    // Header
    lines.push('# Conversation Export');
    lines.push('');
    lines.push(`**Exported:** ${new Date().toISOString()}`);
    if (metadata.sessionRole) lines.push(`**Session Role:** ${metadata.sessionRole}`);
    if (metadata.sessionTheme) lines.push(`**Session Theme:** ${metadata.sessionTheme}`);
    if (metadata.language) lines.push(`**Language:** ${metadata.language}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Conversation
    lines.push('## Conversation Log');
    lines.push('');

    for (const entry of entries) {
        const speaker = entry.speakerName || (entry.role === 'flu' ? 'FLU' : 'User');
        const timestamp = cfg.includeTimestamps ? ` _(${formatTimestamp(entry.timestamp)})_` : '';
        const sentiment = entry.sentiment ? ` [${entry.sentiment}]` : '';

        lines.push(`### ${speaker}${timestamp}${sentiment}`);
        lines.push('');
        lines.push(entry.text || '(empty)');
        lines.push('');

        if (entry.response) {
            lines.push(`> Response: ${entry.response}`);
            lines.push('');
        }
    }

    // Minutes
    if (minutes.length > 0) {
        lines.push('---');
        lines.push('');
        lines.push('## Minutes');
        lines.push('');

        for (const minute of minutes) {
            const title = minute.summarySnapshot?.titulo || minute.summarySnapshot?.tema_sesion || 'Untitled';
            lines.push(`### ${title}`);
            lines.push('');
            if (minute.summarySnapshot?.resumen) {
                lines.push(minute.summarySnapshot.resumen);
                lines.push('');
            }
            if (minute.summarySnapshot?.acuerdos && minute.summarySnapshot.acuerdos.length > 0) {
                lines.push('**Key Points:**');
                for (const kp of minute.summarySnapshot.acuerdos) {
                    lines.push(`- ${kp}`);
                }
                lines.push('');
            }
            if (cfg.includeTimestamps && minute.createdAt) {
                lines.push(`_Created: ${formatTimestamp(minute.createdAt)}_`);
                lines.push('');
            }
        }
    }

    return lines.join('\n');
}

// -----------------------------------------------------------
// TXT Export
// -----------------------------------------------------------

/**
 * Export conversation history as a plain text string.
 */
export function exportAsTxt(
    history: ConversationEntry[],
    minutes: MinuteEntry[],
    metadata: Record<string, unknown> = {},
    options: Partial<ExportOptions> = {},
): string {
    const cfg: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };
    const entries = cfg.maxEntries > 0 ? history.slice(-cfg.maxEntries) : history;

    const lines: string[] = [];

    lines.push('=== CONVERSATION EXPORT ===');
    lines.push(`Exported: ${new Date().toISOString()}`);
    if (metadata.sessionRole) lines.push(`Session Role: ${metadata.sessionRole}`);
    if (metadata.sessionTheme) lines.push(`Session Theme: ${metadata.sessionTheme}`);
    lines.push('');
    lines.push('--- CONVERSATION LOG ---');
    lines.push('');

    for (const entry of entries) {
        const speaker = entry.speakerName || (entry.role === 'flu' ? 'FLU' : 'User');
        const timestamp = cfg.includeTimestamps ? ` [${formatTimestamp(entry.timestamp)}]` : '';
        lines.push(`${speaker}${timestamp}:`);
        lines.push(entry.text || '(empty)');
        lines.push('');
    }

    if (minutes.length > 0) {
        lines.push('--- MINUTES ---');
        lines.push('');
        for (const minute of minutes) {
            const title = minute.summarySnapshot?.titulo || minute.summarySnapshot?.tema_sesion || 'Untitled';
            lines.push(`Title: ${title}`);
            if (minute.summarySnapshot?.resumen) lines.push(`Content: ${minute.summarySnapshot.resumen}`);
            if (minute.summarySnapshot?.acuerdos) {
                lines.push('Key Points:');
                for (const kp of minute.summarySnapshot.acuerdos) {
                    lines.push(`  - ${kp}`);
                }
            }
            lines.push('');
        }
    }

    return lines.join('\n');
}

// -----------------------------------------------------------
// Main Export Function
// -----------------------------------------------------------

/**
 * Export conversation history in the specified format.
 */
export function exportConversation(
    format: ExportFormat,
    history: ConversationEntry[],
    minutes: MinuteEntry[],
    metadata: Record<string, unknown> = {},
    options: Partial<ExportOptions> = {},
): string {
    switch (format) {
        case 'json':
            return exportAsJson(history, minutes, metadata, options);
        case 'markdown':
            return exportAsMarkdown(history, minutes, metadata, options);
        case 'txt':
            return exportAsTxt(history, minutes, metadata, options);
        default:
            return exportAsJson(history, minutes, metadata, options);
    }
}

/**
 * Get file extension for a format.
 */
export function getExportExtension(format: ExportFormat): string {
    switch (format) {
        case 'json': return 'json';
        case 'markdown': return 'md';
        case 'txt': return 'txt';
    }
}

/**
 * Get MIME type for a format.
 */
export function getExportMimeType(format: ExportFormat): string {
    switch (format) {
        case 'json': return 'application/json';
        case 'markdown': return 'text/markdown';
        case 'txt': return 'text/plain';
    }
}
