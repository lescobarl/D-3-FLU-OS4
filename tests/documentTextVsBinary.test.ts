// ============================================================
// Guard — el TEXTO de origen va separado del BINARIO serializado
// ------------------------------------------------------------
// Causa raíz (caso 5): `GeneratedDocumentResult` solo tenía `content`,
// que para PDF es un data URL base64 → TTS y descarga lo trataban como
// texto (narración vacía / PDF ilegible). Este guard falla mientras el
// contrato de resultado no exponga el cuerpo en `text` y no exista un
// decodificador de data URL.
// ============================================================
import { describe, it, expect } from 'vitest';
import { serializeDocument, isDataUrl, dataUrlToBlob } from '../src/lib/formatAdapters';

const BODY =
    'Querida mamá:\n\nHoy vi un conejo saltando en el jardín.\n\nCon cariño,\nAdán.';

describe('documento — texto de origen separado del binario', () => {
    it('un formato nativo conserva el cuerpo en `text`', async () => {
        const r = await serializeDocument('md', BODY, 'Carta a mamá');
        expect(r.text).toBe(BODY);
        expect(r.content).toBe(BODY);
    });

    it('un binario conserva el cuerpo en `text` aunque `content` sea serializado', async () => {
        const r = await serializeDocument('pdf', BODY, 'Carta a mamá');
        expect(r.text).toBe(BODY);
        expect(r.mime).toBe('application/pdf');
        // Con pdfkit disponible: content es data URL; si degrada: es texto.
        if (isDataUrl(r.content)) {
            expect(r.content.startsWith('data:application/pdf')).toBe(true);
        }
    });

    it('isDataUrl distingue binario serializado de texto legible', () => {
        expect(isDataUrl('data:application/pdf;base64,QUJD')).toBe(true);
        expect(isDataUrl('Querida mamá')).toBe(false);
        expect(isDataUrl('')).toBe(false);
        expect(isDataUrl(undefined)).toBe(false);
    });

    it('dataUrlToBlob decodifica base64 a Blob real y rechaza lo que no es data URL', async () => {
        const blob = dataUrlToBlob('data:text/plain;base64,SG9sYQ==');
        expect(blob).not.toBeNull();
        expect(await blob!.text()).toBe('Hola');
        expect(dataUrlToBlob('no-es-data-url')).toBeNull();
    });
});
