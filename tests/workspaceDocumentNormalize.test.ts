// ============================================================
// Guard de comportamiento — Caso 5
// ------------------------------------------------------------
// Si el cuerpo de una carta/documento llega en `titulo` y
// `contenido` viene vacío, se normaliza: body en `contenido` y
// un título corto. Así el TTS local tiene cuerpo que narrar.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    normalizeWorkspaceDocumentFields,
    buildGenerationTopic,
} from '../src/lib/generationTopic';

const CARTA =
    'Estimada Ana:\n\nLe escribo para agradecerle su apoyo durante el proyecto. ' +
    'Su trabajo fue clave para que todo saliera bien y quiero que lo sepa. ' +
    'Un abrazo cordial, Luis.';

describe('normalizeWorkspaceDocumentFields — cuerpo que llega en titulo', () => {
    it('mueve el cuerpo al contenido y deja un título corto', () => {
        const normalized = normalizeWorkspaceDocumentFields({ titulo: CARTA, contenido: '' });

        expect(normalized.contenido).toBe(CARTA);
        expect(normalized.titulo.length).toBeLessThan(CARTA.length);
        expect(normalized.titulo.length).toBeLessThanOrEqual(80);
    });

    it('el artefacto normalizado llega con contenido no vacío al generador', () => {
        const normalized = normalizeWorkspaceDocumentFields({ titulo: CARTA, contenido: '' });
        const topic = buildGenerationTopic({
            conversationHistory: [],
            lastResponse: '',
            workspaceArtifact: { tipo: 'doc', ...normalized },
        });

        expect(topic.contenido.length).toBeGreaterThan(0);
        expect(topic.contenido).toContain('Estimada Ana');
    });

    it('no altera un título corto sin contenido', () => {
        const normalized = normalizeWorkspaceDocumentFields({ titulo: 'Carta para Ana', contenido: '' });
        expect(normalized.titulo).toBe('Carta para Ana');
        expect(normalized.contenido).toBe('');
    });

    it('no altera cuando ya hay contenido', () => {
        const normalized = normalizeWorkspaceDocumentFields({ titulo: 'Carta', contenido: CARTA });
        expect(normalized.titulo).toBe('Carta');
        expect(normalized.contenido).toBe(CARTA);
    });
});
