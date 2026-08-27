// ============================================================
// documentParser.test.ts — pruebas de la capa de lectura (F1)
// ============================================================
// Cubre: identificación por extensión/MIME, soporte de archivos,
// chunkText (fronteras de línea), detectSheetRol (densidad de
// fórmulas) y parseDocument con archivos de texto (jsdom File).
// ============================================================

import { describe, test, expect } from 'vitest';
import {
    getDocumentTipo,
    isSupportedDocument,
    chunkText,
    detectSheetRol,
    parseDocument,
} from '../src/lib/documentParser';

describe('documentParser — getDocumentTipo', () => {
    test('detecta tipo por extensión (sin MIME)', () => {
        const r = getDocumentTipo({ name: 'libro.xlsx', type: '' });
        expect(r.tipo).toBe('xlsx');
        expect(r.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    });

    test('el MIME del archivo (file.type) gana sobre el derivado de la extensión', () => {
        const r = getDocumentTipo({ name: 'reporte.pdf', type: 'text/html' });
        expect(r.tipo).toBe('pdf');
        expect(r.mime).toBe('text/html');
    });

    test('infiere el tipo desde el MIME cuando no hay extensión conocida', () => {
        expect(getDocumentTipo({ name: 'sin-ext', type: 'application/pdf' }).tipo).toBe('pdf');
        expect(getDocumentTipo({ name: 'archivo', type: 'text/plain' }).tipo).toBe('text');
        expect(getDocumentTipo({ name: 'hoja', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).tipo).toBe('xlsx');
        expect(getDocumentTipo({ name: 'docs', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }).tipo).toBe('docx');
        expect(getDocumentTipo({ name: 'slides', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }).tipo).toBe('pptx');
        expect(getDocumentTipo({ name: 'datos', type: 'text/csv' }).tipo).toBe('csv');
        expect(getDocumentTipo({ name: 'readme', type: 'text/markdown' }).tipo).toBe('md');
    });

    test('MIME macro de Excel produce xlsm', () => {
        const r = getDocumentTipo({ name: 'libro', type: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
        expect(r.tipo).toBe('xlsm');
        expect(r.mime).toBe('application/vnd.ms-excel.sheet.macroEnabled.12');
    });

    test('la extensión es case-insensitive', () => {
        expect(getDocumentTipo({ name: 'LIBRO.XLSX', type: '' }).tipo).toBe('xlsx');
        expect(getDocumentTipo({ name: 'Nota.TXT', type: '' }).tipo).toBe('text');
    });
});

describe('documentParser — isSupportedDocument', () => {
    test('acepta documentos soportados', () => {
        expect(isSupportedDocument({ name: 'a.xlsx' })).toBe(true);
        expect(isSupportedDocument({ name: 'a.xlsm' })).toBe(true);
        expect(isSupportedDocument({ name: 'a.pdf' })).toBe(true);
        expect(isSupportedDocument({ name: 'a.docx' })).toBe(true);
        expect(isSupportedDocument({ name: 'a.pptx' })).toBe(true);
        expect(isSupportedDocument({ name: 'a.csv' })).toBe(true);
        expect(isSupportedDocument({ name: 'a.md' })).toBe(true);
        expect(isSupportedDocument({ name: 'a.markdown' })).toBe(true);
        expect(isSupportedDocument({ name: 'a.txt' })).toBe(true);
        expect(isSupportedDocument({ name: 'a.json' })).toBe(true);
    });

    test('rechaza formatos no soportados', () => {
        expect(isSupportedDocument({ name: 'a.png' })).toBe(false);
        expect(isSupportedDocument({ name: 'a.jpg' })).toBe(false);
        expect(isSupportedDocument({ name: 'a.zip' })).toBe(false);
        expect(isSupportedDocument({ name: 'sin extension' })).toBe(false);
    });
});

describe('documentParser — chunkText', () => {
    test('texto corto produce un único chunk', () => {
        expect(chunkText('Hola mundo', 12)).toEqual(['Hola mundo']);
    });

    test('respeta la frontera de salto de línea (boundary)', () => {
        expect(chunkText('1111111111\n2222222222\n3333333333', 12)).toEqual([
            '1111111111',
            '2222222222',
            '3333333333',
        ]);
    });

    test('normaliza CRLF a LF antes de dividir', () => {
        expect(chunkText('aaa\r\nbbb', 4)).toEqual(['aaa', 'bbb']);
    });

    test('respeta el tope de chunks (maxChunks)', () => {
        const text = ['1111111111', '2222222222', '3333333333', '4444444444', '5555555555'].join('\n');
        expect(chunkText(text, 12, 2)).toHaveLength(2);
    });

    test('texto vacío devuelve lista vacía', () => {
        expect(chunkText('')).toEqual([]);
    });

    test('recorta espacios sobrantes de cada chunk', () => {
        expect(chunkText('   aaa   \n   bbb   ', 12)).toEqual(['aaa', 'bbb']);
    });
});

describe('documentParser — detectSheetRol', () => {
    test('hoja sin celdas es informativa', () => {
        expect(detectSheetRol({ celdas: 0, formulas: 0, valoresTexto: 0 })).toBe('informativa');
    });

    test('densidad de fórmulas >= 0.5 es calculo', () => {
        expect(detectSheetRol({ celdas: 10, formulas: 5, valoresTexto: 0 })).toBe('calculo');
    });

    test('densidad de fórmulas >= 0.15 es output', () => {
        expect(detectSheetRol({ celdas: 20, formulas: 3, valoresTexto: 0 })).toBe('output');
    });

    test('alto contenido textual >= 0.6 es informativa', () => {
        expect(detectSheetRol({ celdas: 10, formulas: 1, valoresTexto: 6 })).toBe('informativa');
    });

    test('el resto es input', () => {
        expect(detectSheetRol({ celdas: 10, formulas: 1, valoresTexto: 2 })).toBe('input');
    });
});

describe('documentParser — parseDocument (texto)', () => {
    test('archivo .txt produce el contrato completo', async () => {
        const file = new File(['Hola mundo de prueba'], 'nota.txt', { type: 'text/plain' });
        const result = await parseDocument(file);

        expect(result.contract.tipo).toBe('text');
        expect(result.contract.mime).toBe('text/plain');
        expect(result.contract.nombre).toBe('nota.txt');
        expect(result.contract.tamaño).toBe(file.size);
        expect(result.contract.resumen).toContain('Inicio del contenido: Hola mundo de prueba');
        expect(result.contract.puntos_clave).toEqual([]);
        expect(result.contract.qa_context).toBe('Hola mundo de prueba');
        expect(result.rawText).toBe('Hola mundo de prueba');
        expect(result.chunks).toEqual(['Hola mundo de prueba']);
        expect(result.warnings).toEqual([]);
    });

    test('archivo .csv construye resumen y qa_context', async () => {
        const file = new File(['Sección;Detalle\nTema;Prueba'], 'datos.csv', { type: 'text/csv' });
        const result = await parseDocument(file);

        expect(result.contract.tipo).toBe('csv');
        expect(result.contract.mime).toBe('text/csv');
        expect(result.contract.resumen).toContain('Inicio del contenido:');
        expect(result.contract.qa_context.length).toBeGreaterThan(0);
        expect(result.chunks.length).toBeGreaterThan(0);
    });

    test('archivo sin extensión con MIME text/plain se trata como texto', async () => {
        const file = new File(['contenido'], 'archivo', { type: 'text/plain' });
        const result = await parseDocument(file);
        expect(result.contract.tipo).toBe('text');
        expect(result.rawText).toBe('contenido');
    });

    test('texto largo se divide en varios chunks', async () => {
        const line = (i: number) => `linea ${i} - ${'x'.repeat(990)}`;
        const body = Array.from({ length: 5 }, (_, i) => line(i)).join('\n');
        const file = new File([body], 'largo.txt', { type: 'text/plain' });
        const result = await parseDocument(file);
        expect(result.chunks.length).toBeGreaterThan(1);
        expect(result.chunks.join(' ')).toContain('linea 0');
        expect(result.chunks.join(' ')).toContain('linea 4');
    });
});
