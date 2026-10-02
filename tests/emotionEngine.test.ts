// ============================================================
// emotionEngine - motor de expresiones y animaciones (0%).
// ------------------------------------------------------------
// Modulo PURO: resuelve la expresion/animaciones del avatar a partir
// del estado de conversacion, la emocion, un trigger o el sentimiento.
// Se usa el registro REAL (no se mockea nada) y se comprueba el
// contrato: mapeo estado -> avatarState, seleccion con/sin rasgos,
// escalado por reactividad, alternancia de toggles, triggers validos e
// invalidos y los helpers de validacion/fallback.
// ============================================================
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getDefaultExpression,
    isValidAnimation,
    isValidExpression,
    resolveContextualExpression,
    resolveEmotionExpression,
    resolveIdleMicroExpression,
    resolveSpeakingExpression,
    resolveStateExpression,
    resolveToggleExpression,
    resolveTriggerExpression,
} from '../src/core/anim/emotionEngine';
import type { ConversationState, EmotionalState } from '../src/types/bridge';

const UNKNOWN_STATE = 'NOPE' as unknown as ConversationState;
const UNKNOWN_EMOTION = 'nope' as unknown as EmotionalState;
const UNKNOWN_TRIGGER = 'nope' as unknown as Parameters<typeof resolveTriggerExpression>[0];

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
// Bloque: resolveStateExpression (estado de conversacion)
// ------------------------------------------------------------
describe('resolveStateExpression', () => {
    it('IDLE elige la expresion por defecto del registro', () => {
        const r = resolveStateExpression('IDLE');

        expect(r.avatarState).toBe('IDLE');
        expect(r.expression).toBe('atencion');
        expect(r.anims).toEqual(['Idle_2']);
        expect(r.intensity).toBe(0.3);
    });

    it.each<[ConversationState, string]>([
        ['LISTENING', 'LISTENING'],
        ['THINKING', 'THINKING'],
        ['SPEAKING', 'SPEAKING'],
        ['SLEEPING', 'SLEEPING'],
        ['ERROR', 'ERROR'],
        ['CELEBRATING', 'CELEBRATING'],
    ])('mapea el estado %s a avatarState %s', (state, expected) => {
        expect(resolveStateExpression(state).avatarState).toBe(expected);
    });

    it('un estado desconocido no tiene candidatos: null y sin animaciones', () => {
        const r = resolveStateExpression(UNKNOWN_STATE);

        expect(r.expression).toBeNull();
        expect(r.anims).toEqual([]);
        expect(r.avatarState).toBeUndefined();
        expect(r.intensity).toBe(0.5);
    });
});

// ------------------------------------------------------------
// Bloque: escalado por reactividad
// ------------------------------------------------------------
describe('reactividad', () => {
    it('reactividad alta duplica las animaciones', () => {
        const base = resolveStateExpression('IDLE');

        expect(resolveStateExpression('IDLE', { reactivity: 5 }).anims).toHaveLength(base.anims.length * 2);
    });

    it('reactividad muy baja deja solo la primera animacion', () => {
        const r = resolveStateExpression('IDLE', { reactivity: 0.01 });

        expect(r.anims).toHaveLength(1);
        expect(r.anims[0]).toBe('Idle_2');
    });
});

// ------------------------------------------------------------
// Bloque: resolveEmotionExpression
// ------------------------------------------------------------
describe('resolveEmotionExpression', () => {
    it('una emocion valida devuelve expresion y animaciones', () => {
        const r = resolveEmotionExpression('happy');

        expect(r.expression).not.toBeNull();
        expect(r.anims.length).toBeGreaterThan(0);
        expect(r.avatarState).toBe('IDLE');
    });

    it('una emocion desconocida cae al fallback silencioso', () => {
        const r = resolveEmotionExpression(UNKNOWN_EMOTION);

        expect(r.expression).toBeNull();
        expect(r.anims).toEqual([]);
    });
});

// ------------------------------------------------------------
// Bloque: resolveToggleExpression (alternancia)
// ------------------------------------------------------------
describe('resolveToggleExpression', () => {
    it('alterna entre las expresiones del grupo y avanza el contador', () => {
        const ref = { current: 0 };
        const first = resolveToggleExpression('listening', ref);
        const second = resolveToggleExpression('listening', ref);

        expect(first.expression).not.toBe(second.expression);
        expect(ref.current).toBe(2);
    });

    it('un grupo desconocido devuelve null sin tocar el contador', () => {
        const ref = { current: 3 };
        const r = resolveToggleExpression('nope' as unknown as 'listening', ref);

        expect(r.expression).toBeNull();
        expect(ref.current).toBe(3);
    });
});

// ------------------------------------------------------------
// Bloque: resolveTriggerExpression
// ------------------------------------------------------------
describe('resolveTriggerExpression', () => {
    it('un trigger valido devuelve la expresion registrada', () => {
        const r = resolveTriggerExpression('thinking');

        expect(r).not.toBeNull();
        expect(r?.expression).toBe('Pensando');
    });

    it('un trigger desconocido devuelve null', () => {
        expect(resolveTriggerExpression(UNKNOWN_TRIGGER)).toBeNull();
    });
});

// ------------------------------------------------------------
// Bloque: micro-expresiones de reposo
// ------------------------------------------------------------
describe('resolveIdleMicroExpression', () => {
    it('elige una micro y SIEMPRE conserva Idle_2 como base', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const r = resolveIdleMicroExpression();

        expect(r).not.toBeNull();
        expect(r?.micro).toBe(true);
        expect(r?.anims[0]).toBe('Idle_2');
        expect((r?.intensity ?? 1) <= 0.5).toBe(true);
    });

    it('forceVisible mantiene Idle_2 delante del gesto visible', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const r = resolveIdleMicroExpression({}, { forceVisible: true });

        expect(r?.anims[0]).toBe('Idle_2');
        expect(r?.anims.length).toBeLessThanOrEqual(2);
    });
});

// ------------------------------------------------------------
// Bloque: sentimiento, validacion y fallbacks
// ------------------------------------------------------------
describe('resolveContextualExpression / helpers', () => {
    it.each<[Parameters<typeof resolveContextualExpression>[0], EmotionalState]>([
        ['positive', 'happy'],
        ['negative', 'sad'],
        ['question', 'curious'],
        [undefined, 'neutral'],
    ])('sentimiento %s -> emocion %s', (sentiment, expected) => {
        expect(resolveContextualExpression(sentiment).emotionalState).toBe(expected);
    });

    it('valida expresiones y animaciones contra el registro real', () => {
        expect(isValidExpression('atencion')).toBe(true);
        expect(isValidExpression('no_existe')).toBe(false);
        expect(isValidAnimation('Idle_2')).toBe(true);
        expect(isValidAnimation('no_existe')).toBe(false);
    });

    it('getDefaultExpression es el fallback estable', () => {
        expect(getDefaultExpression()).toMatchObject({
            expression: 'atencion',
            anims: ['Idle_2'],
            avatarState: 'IDLE',
            intensity: 0.3,
        });
    });

    it('resolveSpeakingExpression usa la sugerencia valida o el fallback', () => {
        const valid = resolveSpeakingExpression('Dance', 'feliz');
        expect(valid.expression).toBe('feliz');
        expect(valid.anims).toEqual(['Dance', 'MouthMove']);
        expect(valid.avatarState).toBe('SPEAKING');

        const fallback = resolveSpeakingExpression('no_existe', 'no_existe');
        expect(fallback.expression).toBe('atencion');
        expect(fallback.anims).toEqual(['Idle_2', 'MouthMove']);
    });
});
