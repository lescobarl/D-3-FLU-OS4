// ============================================================
// animationConsistency — alineación EXPRESSION_MAP (avatar) ↔
// EXPRESSION_REGISTRY (fuente de verdad) y las 17 animaciones
// canónicas del modelo Bunny.
// Cubre: subset canónico, paridad de grupos toggle, Pensando,
// unión-subset de claves compartidas y la regresión del FIX #2
// ('feliz' ya no usa 'Dance').
// ============================================================
import { describe, it, expect } from 'vitest';
import { EXPRESSION_MAP } from '../src/avatar/index';
import {
    EXPRESSION_REGISTRY,
    getValidAnimations,
    getGroupExpressions,
} from '../src/core/anim/expressionRegistry';
import { readFileSync } from 'fs';

// Nombres exactos de Animations.zip (src/avatar/types/bunny.ts).
const CANONICAL_ANIMATIONS = [
    'Bind-pose',
    'Cap_back',
    'Cap_front',
    'Dance',
    'Emo_blink',
    'Emo_mouth_open',
    'Emo_neutral',
    'Idle_1',
    'Idle_2',
    'Idle_3',
    'Jump_in_place',
    'Jump_while_run',
    'MouthMove',
    'Palabra',
    'Run',
    'Walk',
    'Walk_sneaky',
] as const;

const CANONICAL_SET = new Set<string>(CANONICAL_ANIMATIONS);

const GROUPS: Array<'listening' | 'speaking' | 'participant'> = [
    'listening',
    'speaking',
    'participant',
];

// Claves del EXPRESSION_MAP que pertenecen a cada grupo toggle.
const GROUP_MAP_KEYS: Record<'listening' | 'speaking' | 'participant', string[]> = {
    listening: ['atencion', 'atencion2'],
    speaking: ['hablando', 'hablando2'],
    participant: ['palabra', 'Palabra2'],
};

const mapAnimations = (): Set<string> => {
    return new Set(Object.values(EXPRESSION_MAP).flat());
};

describe('animationConsistency — canon 17 (modelo Bunny)', () => {
    it('todas las animaciones del EXPRESSION_MAP pertenecen al canon', () => {
        for (const anim of mapAnimations()) {
            expect(CANONICAL_SET.has(anim), `animación fuera de canon: ${anim}`).toBe(true);
        }
    });

    it('todas las animaciones del registro pertenecen al canon', () => {
        const valid = getValidAnimations();
        expect(valid.length).toBeGreaterThan(0);
        for (const anim of valid) {
            expect(CANONICAL_SET.has(anim), `animación fuera de canon: ${anim}`).toBe(true);
        }
    });

    it('cada definición del registro declara animaciones válidas no vacías', () => {
        expect(EXPRESSION_REGISTRY.length).toBeGreaterThan(0);
        for (const def of EXPRESSION_REGISTRY) {
            expect(def.anims.length, `def sin anims: ${def.expression}`).toBeGreaterThan(0);
            for (const anim of def.anims) {
                expect(CANONICAL_SET.has(anim), `def ${def.expression} usa ${anim}`).toBe(true);
            }
        }
    });
});

describe('animationConsistency — EXPRESSION_MAP ⊆ getValidAnimations()', () => {
    it('ninguna animación del mapa está ausente del registro', () => {
        const validSet = new Set(getValidAnimations());
        for (const anim of mapAnimations()) {
            expect(validSet.has(anim), `animación no registrada: ${anim}`).toBe(true);
        }
    });
});

describe('animationConsistency — paridad de grupos toggle', () => {
    it.each(GROUPS)('grupo %s: mapa ∪ ≡ registry ∪', (group) => {
        const mapUnion = new Set(GROUP_MAP_KEYS[group].flatMap((k) => EXPRESSION_MAP[k] ?? []));
        const registryUnion = new Set(
            getGroupExpressions(group).flatMap((def) => def.anims),
        );
        expect(mapUnion).toEqual(registryUnion);
    });
});

describe('animationConsistency — Pensando y claves compartidas', () => {
    it('Pensando → Idle_1 (THINKING)', () => {
        expect(EXPRESSION_MAP['Pensando']).toEqual(['Idle_1']);
    });

    it('claves compartidas: mapa ⊆ unión del registry (sin parches fuera de fuente)', () => {
        const registryByExpression = new Map<string, string[]>();
        for (const def of EXPRESSION_REGISTRY) {
            const current = registryByExpression.get(def.expression) ?? [];
            registryByExpression.set(def.expression, [...current, ...def.anims]);
        }
        for (const [key, anims] of Object.entries(EXPRESSION_MAP)) {
            const registryAnims = registryByExpression.get(key);
            if (!registryAnims) continue; // claves OS3-parity ausentes del registry se omiten
            for (const anim of anims) {
                expect(
                    registryAnims.includes(anim),
                    `EXPRESSION_MAP['${key}'] usa ${anim} ausente del registry`,
                ).toBe(true);
            }
        }
    });

    it('FIX #2: «feliz» = Jump_while_run + Idle_2 (sin Dance)', () => {
        expect(EXPRESSION_MAP['feliz']).toEqual(['Jump_while_run', 'Idle_2']);
    });
});

describe('animationConsistency — BunnyModel capa única anti-congelamiento (preload gate)', () => {
    const source = readFileSync('./src/avatar/model/BunnyModel.tsx', 'utf-8');

    it('declara el estado preloaded (se activa al terminar preloadAll)', () => {
        expect(source).toContain('const [preloaded, setPreloaded] = useState(false);');
    });

    it('setPreloaded(true) junto a setLoading(false) en preloadAll().then()', () => {
        expect(source).toContain('setLoading(false);');
        expect(source).toContain('setPreloaded(true); // habilita la reproducción');
    });

    it('el efecto de animación está bloqueado por el gate preloaded', () => {
        expect(source).toContain('if (!animator || !preloaded) return;');
    });

    it('el efecto de animación depende de preloaded (re-ejecuta al terminar la precarga)', () => {
        expect(source).toContain('}, [currentAnimation, blendQueue, isPlaying, preloaded]);');
    });
});
