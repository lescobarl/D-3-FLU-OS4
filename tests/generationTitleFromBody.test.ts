// ============================================================
// Guard — el TÍTULO del documento es un rótulo, no el CUERPO
// ------------------------------------------------------------
// Causa raíz (caso 5): el historial escribía `titulo = tema`, y el tema
// se deriva del cuerpo del artifact → la carta aparecía con su contenido
// como título. Este guard falla mientras no exista una resolución única
// de título que separe rótulo de tema de generación.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildGenerationTopic, resolveDocumentTitle } from '../src/lib/generationTopic';

const BODY =
    'Querida mamá: hoy vi un conejo saltando en el jardín. Te extraño mucho y quería contarte que aprendí a usar FLU.';

describe('documento — el título es un rótulo corto, no el cuerpo', () => {
    it('usa el título del artifact cuando es un rótulo real', () => {
        expect(resolveDocumentTitle('Carta a mamá', BODY)).toBe('Carta a mamá');
    });

    it('cae al tema cuando el título es un placeholder de tipo', () => {
        expect(resolveDocumentTitle('Video', 'un conejo saltando')).toBe('un conejo saltando');
        expect(resolveDocumentTitle('Documento', 'un conejo saltando')).toBe('un conejo saltando');
    });

    it('cae al tema cuando no hay título', () => {
        expect(resolveDocumentTitle('', 'tema real')).toBe('tema real');
        expect(resolveDocumentTitle(undefined, 'tema real')).toBe('tema real');
    });

    it('flujo real: el tema sigue llevando el cuerpo, pero el título visible no', () => {
        const state = {
            conversationHistory: [],
            lastResponse: '',
            workspaceArtifact: { tipo: 'doc', titulo: 'Carta a mamá', contenido: BODY },
        } as never;
        const { tema, contenido } = buildGenerationTopic(state);
        expect(tema).toContain('conejo');
        expect(contenido).toBe(BODY);
        expect(resolveDocumentTitle('Carta a mamá', tema)).toBe('Carta a mamá');
    });
});
