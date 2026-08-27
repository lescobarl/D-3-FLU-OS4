// ============================================================
// Unit Tests — exportUtils.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    exportAsJson,
    exportAsMarkdown,
    exportAsTxt,
    exportConversation,
    getExportExtension,
    getExportMimeType,
    type ExportFormat,
} from '../src/lib/exportUtils';
import type { ConversationEntry, MinuteEntry } from '../src/types/bridge';

function makeEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
    return {
        id: 'entry-1',
        role: 'user',
        speakerName: 'Alice',
        text: 'Hello, this is a test message',
        timestamp: Date.now(),
        sentiment: 'neutral',
        ...overrides,
    } as ConversationEntry;
}

function makeMinute(overrides: Partial<MinuteEntry> = {}): MinuteEntry {
    return {
        id: 'min-1',
        createdAt: new Date().toISOString(),
        summarySnapshot: {
            titulo: 'Test Minute',
            tema_sesion: 'Testing',
            resumen: 'This is a test minute content',
            acuerdos: ['Point 1', 'Point 2'],
        },
        ...overrides,
    } as MinuteEntry;
}

describe('exportUtils — exportAsJson', () => {
    it('exports conversation as JSON string', () => {
        const entries = [makeEntry()];
        const minutes = [makeMinute()];
        const json = exportAsJson(entries, minutes, { sessionRole: 'test' });
        const parsed = JSON.parse(json);
        expect(parsed.conversation).toHaveLength(1);
        expect(parsed.minutes).toHaveLength(1);
        expect(parsed.sessionRole).toBe('test');
    });

    it('respects maxEntries option', () => {
        const entries = [makeEntry({ id: '1' }), makeEntry({ id: '2' })];
        const json = exportAsJson(entries, [], {}, { maxEntries: 1 });
        const parsed = JSON.parse(json);
        expect(parsed.conversation).toHaveLength(1);
    });

    it('includes minute data correctly', () => {
        const minutes = [makeMinute()];
        const json = exportAsJson([], minutes);
        const parsed = JSON.parse(json);
        expect(parsed.minutes[0].title).toBe('Test Minute');
        expect(parsed.minutes[0].keyPoints).toEqual(['Point 1', 'Point 2']);
    });
});

describe('exportUtils — exportAsMarkdown', () => {
    it('exports conversation as Markdown', () => {
        const entries = [makeEntry()];
        const md = exportAsMarkdown(entries, []);
        expect(md).toContain('# Conversation Export');
        expect(md).toContain('Alice');
        expect(md).toContain('Hello, this is a test message');
    });

    it('includes minutes section when minutes exist', () => {
        const minutes = [makeMinute()];
        const md = exportAsMarkdown([], minutes);
        expect(md).toContain('## Minutes');
        expect(md).toContain('Test Minute');
        expect(md).toContain('Point 1');
    });
});

describe('exportUtils — exportAsTxt', () => {
    it('exports conversation as plain text', () => {
        const entries = [makeEntry()];
        const txt = exportAsTxt(entries, []);
        expect(txt).toContain('CONVERSATION EXPORT');
        expect(txt).toContain('Alice');
        expect(txt).toContain('Hello, this is a test message');
    });

    it('includes minutes section', () => {
        const minutes = [makeMinute()];
        const txt = exportAsTxt([], minutes);
        expect(txt).toContain('MINUTES');
        expect(txt).toContain('Test Minute');
    });
});

describe('exportUtils — exportConversation', () => {
    it('routes to correct format', () => {
        const entries = [makeEntry()];
        const json = exportConversation('json', entries, []);
        expect(() => JSON.parse(json)).not.toThrow();

        const md = exportConversation('markdown', entries, []);
        expect(md).toContain('# Conversation Export');

        const txt = exportConversation('txt', entries, []);
        expect(txt).toContain('CONVERSATION EXPORT');
    });
});

describe('exportUtils — getExportExtension', () => {
    it('returns correct extensions', () => {
        expect(getExportExtension('json')).toBe('json');
        expect(getExportExtension('markdown')).toBe('md');
        expect(getExportExtension('txt')).toBe('txt');
    });
});

describe('exportUtils — getExportMimeType', () => {
    it('returns correct MIME types', () => {
        expect(getExportMimeType('json')).toBe('application/json');
        expect(getExportMimeType('markdown')).toBe('text/markdown');
        expect(getExportMimeType('txt')).toBe('text/plain');
    });
});
