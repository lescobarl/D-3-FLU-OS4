// ============================================================
// Tests para src/lib/userEmotionDetector.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    detectUserEmotion,
    detectUserPraise,
    detectUserCriticism,
    detectTopicChange,
    detectInterruption,
    DEFAULT_USER_EMOTION_CONFIG,
} from '../src/lib/userEmotionDetector';

const NOW = 1700000000000;

describe('userEmotionDetector — detectUserEmotion', () => {
    it('detecta feliz con texto positivo en español', () => {
        const result = detectUserEmotion('Estoy muy feliz hoy');
        expect(result.emotion).toBe('feliz');
        expect(result.mood).toBe('positive');
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('detecta feliz con texto positivo en inglés', () => {
        const result = detectUserEmotion('I am so happy today');
        expect(result.emotion).toBe('feliz');
        expect(result.mood).toBe('positive');
    });

    it('detecta triste con texto negativo', () => {
        const result = detectUserEmotion('Estoy muy triste');
        expect(result.emotion).toBe('triste');
        expect(result.mood).toBe('negative');
    });

    it('detecta enojado con texto de enfado', () => {
        const result = detectUserEmotion('Estoy enojado con esto');
        expect(result.emotion).toBe('enojado');
        expect(result.mood).toBe('negative');
    });

    it('detecta agradecido con agradecimiento', () => {
        const result = detectUserEmotion('Muchas gracias por tu ayuda');
        expect(result.emotion).toBe('agradecido');
        expect(result.mood).toBe('positive');
    });

    it('detecta confundido con confusión', () => {
        const result = detectUserEmotion('No entiendo lo que dices');
        expect(result.emotion).toBe('confundido');
        expect(result.mood).toBe('neutral');
    });

    it('detecta sorprendido con sorpresa', () => {
        const result = detectUserEmotion('No puedo creerlo, es increíble');
        expect(result.emotion).toBe('sorprendido');
        expect(result.mood).toBe('neutral');
    });

    it('detecta frustrado con frustración', () => {
        const result = detectUserEmotion('Estoy muy frustrado con esto');
        expect(result.emotion).toBe('frustrado');
        expect(result.mood).toBe('negative');
    });

    it('retorna neutral para texto vacío', () => {
        const result = detectUserEmotion('');
        expect(result.emotion).toBe('neutral');
        expect(result.mood).toBe('neutral');
        expect(result.confidence).toBe(1);
    });

    it('retorna neutral para texto sin emociones detectables', () => {
        const result = detectUserEmotion('El cielo es azul');
        expect(result.emotion).toBe('neutral');
    });

    it('detecta pregunta y marca mood como question', () => {
        const result = detectUserEmotion('¿Qué es eso?');
        expect(result.mood).toBe('question');
    });

    it('detecta pregunta en inglés', () => {
        const result = detectUserEmotion('What is that?');
        expect(result.mood).toBe('question');
    });

    it('boostea confianza con múltiples coincidencias', () => {
        const result = detectUserEmotion('Estoy feliz y contento y alegre');
        expect(result.emotion).toBe('feliz');
        // Multiple matches should boost confidence
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('respeta minConfidence configurable', () => {
        const result = detectUserEmotion('ok', { minConfidence: 0.9 });
        expect(result.emotion).toBe('neutral');
        expect(result.matchedPatterns).toContain('low_confidence');
    });
});

describe('userEmotionDetector — detectUserPraise', () => {
    it('detecta elogio en español', () => {
        const result = detectUserPraise('Bien hecho FLU');
        expect(result.isPraise).toBe(true);
        expect(result.confidence).toBeGreaterThan(0);
    });

    it('detecta elogio en inglés', () => {
        const result = detectUserPraise('Good job FLU');
        expect(result.isPraise).toBe(true);
    });

    it('detecta agradecimiento como elogio', () => {
        const result = detectUserPraise('Gracias FLU, excelente respuesta');
        expect(result.isPraise).toBe(true);
    });

    it('no detecta elogio en texto neutral', () => {
        const result = detectUserPraise('El clima está nublado');
        expect(result.isPraise).toBe(false);
    });
});

describe('userEmotionDetector — detectUserCriticism', () => {
    it('detecta crítica en español', () => {
        const result = detectUserCriticism('No sirves para nada');
        expect(result.isCriticism).toBe(true);
        expect(result.confidence).toBeGreaterThan(0);
    });

    it('detecta crítica en inglés', () => {
        const result = detectUserCriticism('You are useless');
        expect(result.isCriticism).toBe(true);
    });

    it('detecta orden de callarse', () => {
        const result = detectUserCriticism('Cállate');
        expect(result.isCriticism).toBe(true);
    });

    it('no detecta crítica en texto neutral', () => {
        const result = detectUserCriticism('Me gusta tu respuesta');
        expect(result.isCriticism).toBe(false);
    });
});

describe('userEmotionDetector — detectTopicChange', () => {
    it('detecta cambio explícito de tema en español', () => {
        const result = detectTopicChange('Cambiando de tema, ¿qué opinas?', 'antes hablábamos de clima');
        expect(result.isTopicChange).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('detecta cambio explícito de tema en inglés', () => {
        const result = detectTopicChange('By the way, have you seen...', 'we were talking about weather');
        expect(result.isTopicChange).toBe(true);
    });

    it('retorna false si no hay texto previo', () => {
        const result = detectTopicChange('Hola', null);
        expect(result.isTopicChange).toBe(false);
    });

    it('detecta cambio por bajo solapamiento de palabras', () => {
        const result = detectTopicChange(
            'programación inteligencia artificial algoritmos',
            'recetas cocina pasta italiana ingredientes',
        );
        expect(result.isTopicChange).toBe(true);
    });

    it('no detecta cambio cuando hay solapamiento de palabras', () => {
        const result = detectTopicChange(
            'me gusta la programación en Python',
            'Python es un lenguaje de programación',
        );
        expect(result.isTopicChange).toBe(false);
    });
});

describe('userEmotionDetector — detectInterruption', () => {
    it('detecta interrupción cuando FLU está hablando', () => {
        const result = detectInterruption('Espera un momento', true);
        expect(result.isInterruption).toBe(true);
        expect(result.confidence).toBeGreaterThan(0);
    });

    it('no detecta interrupción cuando FLU no está hablando', () => {
        const result = detectInterruption('Espera un momento', false);
        expect(result.isInterruption).toBe(false);
    });

    it('detecta interrupción corta mientras FLU habla', () => {
        const result = detectInterruption('No', true);
        expect(result.isInterruption).toBe(true);
    });

    it('detecta "déjame decir" como interrupción', () => {
        const result = detectInterruption('Déjame decir algo', true);
        expect(result.isInterruption).toBe(true);
    });
});
