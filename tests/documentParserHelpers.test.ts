/**
 * lib/documentParser — helpers internos (antes sin cubrir).
 *
 * POR QUE ESTE TEST: `src/lib/documentParser.ts` estaba al 34% (263 sentencias
 * sin cubrir) y su superficie publica ya tenia test; el hueco eran helpers
 * INTERNOS. Aqui se fijan dos puros: la inferencia de tipo por MIME y la lectura
 * de un ArrayBuffer como UTF-8.
 */
import { describe, expect, it } from 'vitest';
import { inferTipoFromMime, readArrayBufferAsUtf8 } from '../src/lib/documentParser';

describe('documentParser — inferTipoFromMime', () => {
    it('hojas de calculo -> xlsx, y con macro -> xlsm', () => {
        expect(inferTipoFromMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx');
        expect(inferTipoFromMime('application/vnd.ms-excel')).toBe('xlsx');
        expect(inferTipoFromMime('application/vnd.ms-excel.sheet.macroEnabled.12')).toBe('xlsm');
    });

    it('presentaciones -> pptx', () => {
        expect(inferTipoFromMime('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('pptx');
        expect(inferTipoFromMime('application/vnd.ms-powerpoint')).toBe('pptx');
    });

    it('word -> docx', () => {
        expect(inferTipoFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
        expect(inferTipoFromMime('application/msword')).toBe('docx');
    });

    it('pdf / csv / markdown', () => {
        expect(inferTipoFromMime('application/pdf')).toBe('pdf');
        expect(inferTipoFromMime('text/csv')).toBe('csv');
        expect(inferTipoFromMime('text/markdown')).toBe('md');
    });

    it('ignora mayusculas y cae a text por defecto', () => {
        expect(inferTipoFromMime('APPLICATION/PDF')).toBe('pdf');
        expect(inferTipoFromMime('text/plain')).toBe('text');
        expect(inferTipoFromMime('')).toBe('text');
    });
});

describe('documentParser — readArrayBufferAsUtf8', () => {
    it('decodifica UTF-8 preservando acentos y simbolos', () => {
        const original = 'café con leche — año 2026 · ñandú';
        const bytes = new TextEncoder().encode(original);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        expect(readArrayBufferAsUtf8(buffer)).toBe(original);
    });
});
