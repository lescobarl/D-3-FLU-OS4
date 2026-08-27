// ============================================================
// Tests para src/lib/theoryOfMind.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    createTheoryOfMindState,
    getOrCreateParticipant,
    recordParticipantIntervention,
    recordParticipantEmotion,
    recordParticipantPreference,
    getParticipantModel,
    getActiveParticipants,
    getParticipantKnowledge,
    participantKnowsTopic,
    getParticipantSummary,
    formatTheoryOfMindForPrompt,
    DEFAULT_THEORY_OF_MIND_CONFIG,
} from '../src/lib/theoryOfMind';

const NOW = 1700000000000;

describe('theoryOfMind — createTheoryOfMindState', () => {
    it('crea estado vacío', () => {
        const state = createTheoryOfMindState();
        expect(state.participants).toEqual({});
        expect(state.totalParticipants).toBe(0);
        expect(state.lastUpdated).toBeGreaterThan(0);
    });
});

describe('theoryOfMind — getOrCreateParticipant', () => {
    it('crea un nuevo participante', () => {
        const state = createTheoryOfMindState();
        const result = getOrCreateParticipant(state, 'Hablante 1');
        expect(result.model.name).toBe('Hablante 1');
        expect(result.model.interventionCount).toBe(0);
        expect(result.state.totalParticipants).toBe(1);
    });

    it('retorna participante existente sin duplicar', () => {
        const state = createTheoryOfMindState();
        const { state: s1 } = getOrCreateParticipant(state, 'Hablante 1');
        const { state: s2, model } = getOrCreateParticipant(s1, 'Hablante 1');
        expect(s2.totalParticipants).toBe(1);
        expect(model.name).toBe('Hablante 1');
    });

    it('respeta maxParticipants eliminando el más antiguo', () => {
        const state = createTheoryOfMindState();
        let current = state;
        for (let i = 0; i < 12; i++) {
            const result = getOrCreateParticipant(current, `Hablante ${i}`, { maxParticipants: 10 });
            current = result.state;
        }
        expect(Object.keys(current.participants).length).toBeLessThanOrEqual(10);
    });
});

describe('theoryOfMind — recordParticipantIntervention', () => {
    it('registra una intervención y extrae temas', () => {
        const state = createTheoryOfMindState();
        const updated = recordParticipantIntervention(state, 'Hablante 1', 'Me gusta la programación en Python', NOW);
        const model = getParticipantModel(updated, 'Hablante 1')!;
        expect(model.interventionCount).toBe(1);
        expect(model.knownTopics.length).toBeGreaterThan(0);
    });

    it('incrementa interventionCount', () => {
        const state = createTheoryOfMindState();
        let current = recordParticipantIntervention(state, 'Hablante 1', 'Hola', NOW);
        current = recordParticipantIntervention(current, 'Hablante 1', 'Adiós', NOW + 1000);
        const model = getParticipantModel(current, 'Hablante 1')!;
        expect(model.interventionCount).toBe(2);
    });

    it('detecta preguntas y las registra en questionsAsked', () => {
        const state = createTheoryOfMindState();
        const updated = recordParticipantIntervention(state, 'Hablante 1', '¿Qué es inteligencia artificial?', NOW);
        const model = getParticipantModel(updated, 'Hablante 1')!;
        expect(model.questionsAsked.length).toBeGreaterThan(0);
    });
});

describe('theoryOfMind — recordParticipantEmotion', () => {
    it('registra emoción observada', () => {
        const state = createTheoryOfMindState();
        const updated = recordParticipantEmotion(state, 'Hablante 1', 'enojado', NOW, 'porque no le gustó');
        const model = getParticipantModel(updated, 'Hablante 1')!;
        expect(model.observedEmotions).toHaveLength(1);
        expect(model.observedEmotions[0].emotion).toBe('enojado');
        expect(model.observedEmotions[0].context).toBe('porque no le gustó');
    });

    it('apila múltiples emociones', () => {
        const state = createTheoryOfMindState();
        let current = recordParticipantEmotion(state, 'Hablante 1', 'feliz', NOW);
        current = recordParticipantEmotion(current, 'Hablante 1', 'triste', NOW + 1000);
        const model = getParticipantModel(current, 'Hablante 1')!;
        expect(model.observedEmotions).toHaveLength(2);
        expect(model.observedEmotions[0].emotion).toBe('triste'); // most recent first
    });
});

describe('theoryOfMind — recordParticipantPreference', () => {
    it('registra preferencia', () => {
        const state = createTheoryOfMindState();
        const updated = recordParticipantPreference(state, 'Hablante 1', 'le gusta el tono formal', NOW);
        const model = getParticipantModel(updated, 'Hablante 1')!;
        expect(model.demonstratedPreferences).toContain('le gusta el tono formal');
    });

    it('no duplica preferencias', () => {
        const state = createTheoryOfMindState();
        let current = recordParticipantPreference(state, 'Hablante 1', 'formal', NOW);
        current = recordParticipantPreference(current, 'Hablante 1', 'formal', NOW + 1000);
        const model = getParticipantModel(current, 'Hablante 1')!;
        expect(model.demonstratedPreferences).toHaveLength(1);
    });
});

describe('theoryOfMind — getActiveParticipants', () => {
    it('retorna solo participantes activos', () => {
        const state = createTheoryOfMindState();
        let current = recordParticipantIntervention(state, 'Activo', 'Hola', NOW);
        current = recordParticipantIntervention(current, 'Inactivo', 'Hola', NOW - 60 * 60 * 1000); // 1 hour ago
        const active = getActiveParticipants(current, NOW, 30 * 60 * 1000);
        expect(active).toHaveLength(1);
        expect(active[0].name).toBe('Activo');
    });
});

describe('theoryOfMind — getParticipantKnowledge', () => {
    it('retorna temas conocidos por el participante', () => {
        const state = createTheoryOfMindState();
        const updated = recordParticipantIntervention(state, 'Hablante 1', 'Sé mucho sobre inteligencia artificial', NOW);
        const knowledge = getParticipantKnowledge(updated, 'Hablante 1');
        expect(knowledge.length).toBeGreaterThan(0);
    });

    it('retorna array vacío para participante desconocido', () => {
        const state = createTheoryOfMindState();
        expect(getParticipantKnowledge(state, 'Unknown')).toEqual([]);
    });
});

describe('theoryOfMind — participantKnowsTopic', () => {
    it('retorna true si el participante conoce el tema', () => {
        const state = createTheoryOfMindState();
        const updated = recordParticipantIntervention(state, 'Hablante 1', 'Me gusta la programación', NOW);
        expect(participantKnowsTopic(updated, 'Hablante 1', 'programación')).toBe(true);
    });

    it('retorna false para participante desconocido', () => {
        const state = createTheoryOfMindState();
        expect(participantKnowsTopic(state, 'Unknown', 'programación')).toBe(false);
    });
});

describe('theoryOfMind — getParticipantSummary', () => {
    it('genera resumen legible', () => {
        const state = createTheoryOfMindState();
        let current = recordParticipantIntervention(state, 'Hablante 1', 'Me gusta la programación', NOW);
        current = recordParticipantEmotion(current, 'Hablante 1', 'feliz', NOW);
        const summary = getParticipantSummary(current, 'Hablante 1');
        expect(summary).toContain('Hablante 1');
        expect(summary).toContain('intervened');
        expect(summary.length).toBeGreaterThan(0);
    });

    it('retorna string vacío para participante desconocido', () => {
        const state = createTheoryOfMindState();
        expect(getParticipantSummary(state, 'Unknown')).toBe('');
    });
});

describe('theoryOfMind — formatTheoryOfMindForPrompt', () => {
    it('genera prompt en español', () => {
        const state = createTheoryOfMindState();
        const updated = recordParticipantIntervention(state, 'Hablante 1', 'Hola a todos', NOW);
        const prompt = formatTheoryOfMindForPrompt(updated, 'es', NOW);
        expect(prompt).toContain('Lo que sé sobre los otros participantes');
    });

    it('genera prompt en inglés', () => {
        const state = createTheoryOfMindState();
        const updated = recordParticipantIntervention(state, 'Speaker 1', 'Hello everyone', NOW);
        const prompt = formatTheoryOfMindForPrompt(updated, 'en', NOW);
        expect(prompt).toContain('What I know about the other participants');
    });

    it('retorna string vacío si no hay participantes activos', () => {
        const state = createTheoryOfMindState();
        expect(formatTheoryOfMindForPrompt(state, 'es', NOW)).toBe('');
    });
});
