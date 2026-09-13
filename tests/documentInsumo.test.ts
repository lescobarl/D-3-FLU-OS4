// ============================================================
// documentInsumo.test.ts — Guard del insumo de documento (punto 11)
// ------------------------------------------------------------
// Invariante: un documento analizado produce un texto de INSUMO para el
// historial (prefiere qa_context, cae a resumen); sin texto → null.
// ============================================================
import { describe, expect, it } from 'vitest';
import { buildDocumentInsumo } from '../src/core/documents/documentInsumo';
import type { DocumentContract } from '../src/types/documentContracts';

function contract(overrides: Partial<DocumentContract> = {}): DocumentContract {
    return {
        tipo: 'text',
        mime: 'text/plain',
        nombre: 't.txt',
        tamaño: 10,
        errores: [],
        resumen: '',
        puntos_clave: [],
        qa_context: '',
        ...overrides,
    };
}

describe('buildDocumentInsumo', () => {
    it('prefiere qa_context sobre resumen', () => {
        const out = buildDocumentInsumo(contract({ qa_context: 'CONTEXTO_QA', resumen: 'RESUMEN' }));
        expect(out).toContain('CONTEXTO_QA');
        expect(out).not.toContain('RESUMEN');
    });

    it('cae a resumen cuando no hay qa_context', () => {
        expect(buildDocumentInsumo(contract({ resumen: 'SOLO_RESUMEN' }))).toContain('SOLO_RESUMEN');
    });

    it('sin texto → null (no ensucia el historial)', () => {
        expect(buildDocumentInsumo(contract())).toBeNull();
        expect(buildDocumentInsumo(null)).toBeNull();
    });

    it('etiqueta en inglés cuando language=en', () => {
        expect(buildDocumentInsumo(contract({ qa_context: 'X' }), 'en')).toContain(
            'Document context',
        );
    });
});
