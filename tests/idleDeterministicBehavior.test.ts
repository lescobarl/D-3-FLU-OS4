// ============================================================
// idleDeterministicBehavior — valida el comportamiento
// DETERMINISTICO de FLU frente al "flujo random" de Idle.
//
// Definición productiva:
//   1. LISTENING (escuchando)  → alternar atencion/Idle_2 ↔
//      atencion2/Idle_3 (alternación por oportunidad de cambio).
//   2. THINKING (pensando: minuta, petición a la IA, aprendiendo)
//      → Pensando / Idle_1.
//
// Reglas validadas aquí:
//   - resolveStateExpression mapea LISTENING/THINKING de forma
//     determinista (nunca Pensando en LISTENING).
//   - El micro-ciclo ALEATORIO de IDLE NUNCA filtra expresiones
//     semánticas (atencion/atencion2/Pensando/hablando/…), de modo
//     que el flujo random es consistente con la definición.
//   - El micro "forceVisible" post-SPEAKING→IDLE sigue produciendo
//     un cambio VISIBLE (anti-congelamiento), nunca solo Idle_*/Bind-pose.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    resolveStateExpression,
    resolveIdleMicroExpression,
} from '../src/core/anim/emotionEngine';

// Expresiones semánticas que pertenecen a estados determinísticos
// (LISTENING/THINKING/SPEAKING) y jamás deben aparecer en el flujo
// aleatorio de Idle. Espejo del filtro de SEMANTIC_EXPRESSIONS en
// resolveIdleMicroExpression (emotionEngine.ts).
const SEMANTIC_EXPRESSIONS = new Set([
    'atencion',
    'atencion2',
    'Pensando',
    'hablando',
    'hablando2',
    'palabra',
    'Palabra2',
]);

const NOOP_ANIMS = new Set(['Idle_1', 'Idle_2', 'Idle_3', 'Bind-pose']);

describe('idleDeterministicBehavior — LISTENING → atencion/atencion2', () => {
    it('resuelve LISTENING a atencion o atencion2 (Idle_2/Idle_3), nunca Pensando', () => {
        for (let i = 0; i < 500; i++) {
            const r = resolveStateExpression('LISTENING');
            expect(['atencion', 'atencion2']).toContain(r.expression);
            expect(r.anims.some((a) => a === 'Idle_2' || a === 'Idle_3')).toBe(true);
            expect(r.expression).not.toBe('Pensando');
        }
    });
});

describe('idleDeterministicBehavior — THINKING → Pensando/Idle_1', () => {
    it('resuelve THINKING a Pensando con Idle_1 (definición: minuta/IA/aprendizaje)', () => {
        for (let i = 0; i < 100; i++) {
            const r = resolveStateExpression('THINKING');
            expect(r.expression).toBe('Pensando');
            expect(r.anims).toContain('Idle_1');
        }
    });
});

describe('idleDeterministicBehavior — flujo random de Idle sin fuga semántica', () => {
    it('ninguna iteración devuelve expresiones de LISTENING/THINKING/SPEAKING', () => {
        for (let i = 0; i < 5000; i++) {
            const r = resolveIdleMicroExpression({});
            if (r && r.expression) {
                expect(SEMANTIC_EXPRESSIONS.has(r.expression as string)).toBe(false);
            }
        }
    });

    it('el pool idle sigue teniendo micros vivos (al menos un micro válido)', () => {
        let sawMicro = false;
        for (let i = 0; i < 5000; i++) {
            const r = resolveIdleMicroExpression({});
            if (r) {
                sawMicro = true;
                expect(r.anims.length).toBeGreaterThan(0);
                expect(r.micro).toBe(true);
            }
        }
        expect(sawMicro).toBe(true);
    });
});

describe('idleDeterministicBehavior — anti-congelamiento tras SPEAKING→IDLE', () => {
    it('el micro forceVisible post-hablar siempre es visible (no solo Idle_*/Bind-pose)', () => {
        for (let i = 0; i < 2000; i++) {
            const r = resolveIdleMicroExpression({}, { forceVisible: true });
            expect(r).not.toBeNull();
            expect(r!.anims.some((a) => !NOOP_ANIMS.has(a))).toBe(true);
        }
    });
});
