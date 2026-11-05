// ============================================================
// generationTopic.test.ts — Contenido REAL de generación
// doc/video con datos productivos (Bug #5/#6)
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildGenerationTopic, cleanTopicFromCommand } from '../src/lib/generationTopic';

function makeState(overrides: Record<string, unknown>) {
    return {
        conversationHistory: [],
        lastResponse: '',
        workspaceArtifact: null,
        ...overrides,
    } as never;
}

describe('🧪 buildGenerationTopic — contenido real, sin filler del asistente', () => {
    it('cleanTopicFromCommand quita wake+verbo+tipo: video', () => {
        expect(cleanTopicFromCommand('ok flu crea un video de un conejo saltando')).toBe('un conejo saltando');
    });

    it('cleanTopicFromCommand quita wake+verbo+tipo: carta', () => {
        expect(cleanTopicFromCommand('genera una carta sobre un conejo saltando')).toBe('un conejo saltando');
    });

    it('con artefacto de VIDEO del contrato: el contenido NO contiene el filler "Procederé"', () => {
        const state = makeState({
            conversationHistory: [
                { role: 'user', speakerName: 'Adán', text: 'ok flu crea un video de un conejo saltando' },
            ],
            lastResponse: 'Procederé a generar un video de un conejo saltando.',
            workspaceArtifact: { tipo: 'video', titulo: 'Video', contenido: 'un conejo saltando' },
        });
        const { tema, contenido } = buildGenerationTopic(state);
        expect(contenido.includes('Procederé')).toBe(false);
        expect(contenido.includes('conejo')).toBe(true);
        expect(tema.includes('conejo')).toBe(true);
    });

    it('con artefacto de DOCUMENTO (carta): usa el contenido real, no la respuesta', () => {
        const state = makeState({
            conversationHistory: [
                { role: 'user', speakerName: 'Adán', text: 'genera una carta sobre un conejo saltando' },
            ],
            lastResponse: 'Procederé a generar una carta.',
            workspaceArtifact: { tipo: 'doc', titulo: 'Carta', contenido: 'Querido amigo: hoy vi un conejo saltando…' },
        });
        const { contenido } = buildGenerationTopic(state);
        expect(contenido).toContain('conejo');
        expect(contenido).not.toContain('Procederé');
        expect(contenido).toContain('Querido amigo');
    });
});
