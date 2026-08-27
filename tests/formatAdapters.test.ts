// ============================================================
// formatAdapters.test.ts — pruebas de la capa de serialización (F3)
// ============================================================
// Cubre: FORMAT_INFO/getFormatInfo (10 formatos) y serializeDocument
// para formatos nativos (md/html/csv/json/ics/video). Nota: en
// jsdom URL.createObjectURL no está disponible, por lo que `url`
// siempre es '' y NO debe asumirse como valor.
// ============================================================

import { describe, test, expect } from 'vitest';
import { FORMAT_INFO, getFormatInfo, serializeDocument } from '../src/lib/formatAdapters';
import type { GenerationFormato } from '../src/types/documentContracts';

const ALL_FORMATS: GenerationFormato[] = [
    'pdf',
    'docx',
    'xlsx',
    'pptx',
    'md',
    'html',
    'csv',
    'json',
    'ics',
    'video',
];

describe('formatAdapters — FORMAT_INFO / getFormatInfo', () => {
    test('todos los formatos tienen extensión y MIME', () => {
        for (const formato of ALL_FORMATS) {
            const info = FORMAT_INFO[formato];
            expect(info.ext.length).toBeGreaterThan(0);
            expect(info.mime.length).toBeGreaterThan(0);
            expect(getFormatInfo(formato)).toEqual(info);
        }
    });

    test('video se serializa como markdown', () => {
        expect(FORMAT_INFO.video).toEqual({ ext: 'md', mime: 'text/markdown' });
    });

    test('formato desconocido devuelve txt/text-plain', () => {
        expect(getFormatInfo('raro' as GenerationFormato)).toEqual({ ext: 'txt', mime: 'text/plain' });
    });
});

describe('formatAdapters — serializeDocument (formatos nativos)', () => {
    test('md: contenido, MIME, extensión y nombre', async () => {
        const r = await serializeDocument('md', '# Título', 'mi documento');
        expect(r.content).toBe('# Título');
        expect(r.mime).toBe('text/markdown');
        expect(r.ext).toBe('md');
        expect(r.nombre).toBe('mi documento.md');
        expect(r.bytes).toBe(r.content.length);
    });

    test('md: no duplica la extensión ya presente en el nombre', async () => {
        const r = await serializeDocument('md', '# T', 'documento.md');
        expect(r.nombre).toBe('documento.md');
    });

    test('md: sanea caracteres no válidos del nombre', async () => {
        const r = await serializeDocument('md', '# T', 'doc ** malo // nombre');
        expect(r.nombre).toBe('doc  malo  nombre.md');
    });

    test('html: MIME y extensión correctos', async () => {
        const r = await serializeDocument('html', '<p>Hola</p>', 'pagina');
        expect(r.content).toBe('<p>Hola</p>');
        expect(r.mime).toBe('text/html');
        expect(r.ext).toBe('html');
        expect(r.nombre).toBe('pagina.html');
    });

    test('csv: MIME y extensión correctos', async () => {
        const r = await serializeDocument('csv', 'A;B', 'datos');
        expect(r.mime).toBe('text/csv');
        expect(r.ext).toBe('csv');
        expect(r.nombre).toBe('datos.csv');
    });

    test('json: MIME y extensión correctos', async () => {
        const r = await serializeDocument('json', '{"a":1}', 'salida');
        expect(r.mime).toBe('application/json');
        expect(r.ext).toBe('json');
        expect(r.nombre).toBe('salida.json');
    });

    test('ics: MIME y extensión correctos', async () => {
        const r = await serializeDocument('ics', 'BEGIN:VCALENDAR', 'calendario');
        expect(r.mime).toBe('text/calendar');
        expect(r.ext).toBe('ics');
        expect(r.nombre).toBe('calendario.ics');
    });

    test('video: se entrega como markdown', async () => {
        const r = await serializeDocument('video', '# Guion', 'video explicativo');
        expect(r.mime).toBe('text/markdown');
        expect(r.ext).toBe('md');
        expect(r.nombre).toBe('video explicativo.md');
    });

    test('formato desconocido cae a txt por defecto', async () => {
        const r = await serializeDocument('raro' as GenerationFormato, 'x', 'doc');
        expect(r.mime).toBe('text/plain');
        expect(r.ext).toBe('txt');
        expect(r.nombre).toBe('doc.txt');
    });
});
