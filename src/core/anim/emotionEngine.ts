// ============================================================
// emotionEngine.ts — Centralized Emotion & Expression Engine
// ============================================================
// DATA-driven engine that replaces hardcoded STATE_TO_AVATAR
// and EMOTION_TO_GESTURE mappings with registry lookups.
//
// Design principles:
//   1. NO hardcoded IFs per state/emotion — all data in registry
//   2. Personality-aware expression selection via affinity scoring
//   3. Toggle alternation for groups (listening, speaking, participant)
//   4. Reactivity scaling via intensity modifiers
//   5. Micro-expressions for idle behavior
//   6. Contextual awareness (sentiment → emotion → expression)
// ============================================================

import type { AvatarState, AvatarExpression, BunnyAnimation } from '../../avatar';
import type { ConversationState, EmotionalState } from '../../types/bridge';
import {
    EXPRESSION_REGISTRY,
    getStateExpressions,
    getEmotionExpressions,
    getGroupExpressions,
    getTriggerExpressions,
    getMicroExpressions,
    pickBestExpressionForPersonality,
    type ExpressionDef,
} from './expressionRegistry';

// ── Types ──

export interface ResolvedExpression {
    expression: AvatarExpression | null;
    anims: BunnyAnimation[];
    avatarState: AvatarState;
    /** Whether this is a micro-expression (subtle, brief) */
    micro?: boolean;
    /** Intensity of the resolved expression (0-1) */
    intensity: number;
    /** The EmotionalState that was resolved (for chaining/callers that need it) */
    emotionalState?: EmotionalState;
}

export interface EmotionEngineOptions {
    /** Personality traits for affinity-based expression selection */
    traits?: string[];
    /** Emotional reactivity multiplier (0-2) */
    reactivity?: number;
    /** Whether debug logging is enabled */
    debug?: boolean;
}

// ── AvatarState mapping (one-to-one with ConversationState) ──

const STATE_TO_AVATAR_STATE: Record<ConversationState, AvatarState> = {
    IDLE: 'IDLE',
    LISTENING: 'LISTENING',
    THINKING: 'THINKING',
    SPEAKING: 'SPEAKING',
    SLEEPING: 'SLEEPING',
    ERROR: 'ERROR',
    CELEBRATING: 'CELEBRATING',
};

// ── Core Engine ──

/**
 * Resolve the expression and animations for a given ConversationState.
 *
 * Replaces the old hardcoded `STATE_TO_AVATAR` mapping.
 * Uses the registry's `state` field to look up candidates,
 * then applies personality-based scoring to pick the best match.
 *
 * @param state - The current ConversationState
 * @param options - Engine options (traits, reactivity, debug)
 * @returns ResolvedExpression with expression, anims, and avatarState
 */
export function resolveStateExpression(
    state: ConversationState,
    options: EmotionEngineOptions = {}
): ResolvedExpression {
    const { traits = [], reactivity = 1.0, debug = false } = options;
    const avatarState = STATE_TO_AVATAR_STATE[state];

    // Get all expressions mapped to this state
    const candidates = getStateExpressions(state);

    if (candidates.length === 0) {
        // Fallback: no expression defined for this state
        if (debug) {
            console.log(`[EmotionEngine] No registry entries for state=${state}, using fallback`);
        }
        return {
            expression: null,
            anims: [],
            avatarState,
            intensity: 0.5,
        };
    }

    // Pick the best expression based on personality traits
    const best = pickBestExpressionForPersonality(candidates, traits);

    if (!best) {
        return {
            expression: null,
            anims: [],
            avatarState,
            intensity: 0.5,
        };
    }

    // Apply reactivity scaling to animations
    const scaledAnims = applyReactivityToAnims(best.anims, reactivity, best.intensity ?? 0.5);

    if (debug) {
        console.log(
            `[EmotionEngine] State=${state} → expression=${best.expression}, ` +
            `anims=[${scaledAnims.join(', ')}], traits=[${traits.join(', ')}]`
        );
    }

    return {
        expression: best.expression as AvatarExpression,
        anims: scaledAnims,
        avatarState,
        micro: best.micro,
        intensity: best.intensity ?? 0.5,
    };
}

/**
 * Resolve the expression and animations for a given EmotionalState.
 *
 * Replaces the old hardcoded `EMOTION_TO_GESTURE` mapping.
 * Uses the registry's `emotion` field to look up candidates,
 * then applies personality-based scoring and reactivity scaling.
 *
 * @param emotion - The detected EmotionalState
 * @param options - Engine options (traits, reactivity, debug)
 * @returns ResolvedExpression with expression and anims
 */
export function resolveEmotionExpression(
    emotion: EmotionalState,
    options: EmotionEngineOptions = {}
): ResolvedExpression {
    const { traits = [], reactivity = 1.0, debug = false } = options;

    // Get all expressions mapped to this emotion
    const candidates = getEmotionExpressions(emotion);

    if (candidates.length === 0) {
        if (debug) {
            console.log(`[EmotionEngine] No registry entries for emotion=${emotion}, using fallback`);
        }
        return {
            expression: null,
            anims: [],
            avatarState: 'IDLE',
            intensity: 0.5,
        };
    }

    // Pick the best expression based on personality traits
    const best = pickBestExpressionForPersonality(candidates, traits);

    if (!best) {
        return {
            expression: null,
            anims: [],
            avatarState: 'IDLE',
            intensity: 0.5,
        };
    }

    // Apply reactivity scaling to animations
    const scaledAnims = applyReactivityToAnims(best.anims, reactivity, best.intensity ?? 0.5);

    if (debug) {
        console.log(
            `[EmotionEngine] Emotion=${emotion} → expression=${best.expression}, ` +
            `anims=[${scaledAnims.join(', ')}], reactivity=${reactivity.toFixed(2)}`
        );
    }

    return {
        expression: best.expression as AvatarExpression,
        anims: scaledAnims,
        avatarState: 'IDLE',
        micro: best.micro,
        intensity: best.intensity ?? 0.5,
    };
}

/**
 * Resolve a toggle group expression with alternation.
 *
 * Replaces the old IF-based toggle logic for LISTENING, SPEAKING, and PARTICIPANT.
 * Each call advances the toggle counter and returns the next expression in the group.
 *
 * @param group - The toggle group name
 * @param toggleRef - Mutable ref to the current toggle counter (incremented each call)
 * @param options - Engine options (traits, reactivity, debug)
 * @returns ResolvedExpression with the next expression in the toggle sequence
 */
export function resolveToggleExpression(
    group: 'listening' | 'speaking' | 'participant',
    toggleRef: { current: number },
    options: EmotionEngineOptions = {}
): ResolvedExpression {
    const { traits = [], reactivity = 1.0, debug = false } = options;

    // Get all expressions in this toggle group
    const groupExpressions = getGroupExpressions(group);

    if (groupExpressions.length === 0) {
        if (debug) {
            console.log(`[EmotionEngine] No registry entries for group=${group}`);
        }
        return {
            expression: null,
            anims: [],
            avatarState: 'IDLE',
            intensity: 0.5,
        };
    }

    // Sort by affinity to personality for consistent ordering
    // Then pick based on toggle counter
    const sorted = [...groupExpressions].sort((a, b) => {
        const scoreA = traits.length > 0
            ? (pickBestExpressionForPersonality([a], traits) === a ? 1 : 0)
            : 0;
        const scoreB = traits.length > 0
            ? (pickBestExpressionForPersonality([b], traits) === b ? 1 : 0)
            : 0;
        return scoreB - scoreA;
    });

    const index = toggleRef.current % sorted.length;
    toggleRef.current++;

    const def = sorted[index];

    // Apply reactivity scaling
    const scaledAnims = applyReactivityToAnims(def.anims, reactivity, def.intensity ?? 0.5);

    if (debug) {
        console.log(
            `[EmotionEngine] Toggle group=${group} → expression=${def.expression}, ` +
            `anims=[${scaledAnims.join(', ')}], index=${index}`
        );
    }

    return {
        expression: def.expression as AvatarExpression,
        anims: scaledAnims,
        avatarState: 'IDLE',
        intensity: def.intensity ?? 0.5,
    };
}

/**
 * Resolve a trigger-based expression (participant events, errors, etc.).
 *
 * Replaces the old `triggerParticipantEmotion` logic.
 * Looks up expressions by trigger type in the registry.
 *
 * @param trigger - The trigger event type
 * @param options - Engine options (traits, reactivity, debug)
 * @returns ResolvedExpression or null if no matching trigger expression
 */
export function resolveTriggerExpression(
    trigger: 'granted' | 'ignored' | 'rejected' | 'error' | 'success' | 'thinking' | 'celebrate',
    options: EmotionEngineOptions = {}
): ResolvedExpression | null {
    const { traits = [], reactivity = 1.0, debug = false } = options;

    const candidates = getTriggerExpressions(trigger);

    if (candidates.length === 0) {
        if (debug) {
            console.log(`[EmotionEngine] No registry entries for trigger=${trigger}`);
        }
        return null;
    }

    const best = pickBestExpressionForPersonality(candidates, traits);

    if (!best) return null;

    const scaledAnims = applyReactivityToAnims(best.anims, reactivity, best.intensity ?? 0.5);

    if (debug) {
        console.log(
            `[EmotionEngine] Trigger=${trigger} → expression=${best.expression}, ` +
            `anims=[${scaledAnims.join(', ')}]`
        );
    }

    return {
        expression: best.expression as AvatarExpression,
        anims: scaledAnims,
        avatarState: 'IDLE',
        intensity: best.intensity ?? 0.5,
    };
}

/**
 * Get a random micro-expression for idle behavior.
 *
 * Makes FLU feel alive by showing subtle expressions while waiting.
 * Only returns expressions marked as `micro: true` in the registry.
 *
 * @param options - Engine options (traits, debug)
 * @returns A random micro-expression, or null if none available
 */
export function resolveIdleMicroExpression(
    options: EmotionEngineOptions = {},
    extra: { forceVisible?: boolean } = {}
): ResolvedExpression | null {
    const { debug = false } = options;
    const { forceVisible = false } = extra;

    const microExpressions = getMicroExpressions();

    if (microExpressions.length === 0) {
        return null;
    }

    // DATA-DRIVEN pool: only idle-appropriate micros. Exclude entries bound to
    // SLEEPING whose anims are Bind-pose — those produce NO
    // visible change (Idle_2 already loops in idle) or a freeze pose, which is
    // why the avatar looked "frozen" after speaking.
    // Semantic expressions (atencion/atencion2/Pensando/hablando/…) belong to the
    // deterministic LISTENING/THINKING/SPEAKING states driven by syncAvatarToState —
    // they must NEVER surface through the random idle flow, or FLU would show a
    // behavior that contradicts its state machine. Keep only micro-aliveness entries.
    const SEMANTIC_EXPRESSIONS = new Set([
        'atencion', 'atencion2',
        'Pensando',
        'hablando', 'hablando2',
        'palabra', 'Palabra2',
    ]);
    const idleMicros = microExpressions.filter(
        (def) => (!def.state || def.state === 'IDLE') && !SEMANTIC_EXPRESSIONS.has(def.expression)
    );
    const pool = idleMicros.length > 0 ? idleMicros : microExpressions;

    // When forceVisible, restrict to micros with at least one visible behavior
    // (not Idle_*/Bind-pose). Used right after SPEAKING→IDLE so the transition
    // is perceptible instead of looking frozen.
    const NOOP_ANIMS = new Set(['Idle_1', 'Idle_2', 'Idle_3', 'Bind-pose']);
    let candidates = pool;
    if (forceVisible) {
        const visible = pool.filter((def) => !def.anims.every((a) => NOOP_ANIMS.has(a)));
        if (visible.length > 0) candidates = visible;
    }

    // Weighted random selection so visible behaviors actually fire. Full-body
    // animations (Dance…) are rarer treats; subtle-visible ones (blink, cap)
    // are more common. (pickBestExpressionForPersonality is NOT used here:
    // micro entries have no affinity, so it always returns the first one —
    // 'atencion' → Idle_2 — i.e. NO visible change every time.)
    const ACTION_ANIMS = ['Dance', 'Run', 'Walk', 'Walk_sneaky', 'Jump_in_place', 'Jump_while_run'];
    const weights = candidates.map((def) =>
        def.anims.some((a) => ACTION_ANIMS.includes(a)) ? 0.4 : 1.0
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let best = candidates[0];
    for (let i = 0; i < candidates.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
            best = candidates[i];
            break;
        }
    }

    if (!best) return null;

    // Micro-expressions use subtle animations only, PERO siempre superpuestas al
    // loop base Idle_2 del cuerpo: si la micro fuera SOLA (p.ej. ['Emo_blink']),
    // blendAnimation() reemplazaría Idle_2 → el cuerpo deja de respirar y el avatar
    // se ve "congelado" mientras la micro suena. Mezclando Idle_2 + micro el cuerpo
    // sigue en movimiento (respiración) y el gesto (parpadeo/cap) se superpone.
    // Dedupe por seguridad: si alguna micro alguna vez usara Idle_2 como primer anim.
    const subtleAnims = [...new Set(['Idle_2' as BunnyAnimation, ...best.anims.slice(0, 1)])] as BunnyAnimation[];

    if (debug) {
        console.log(
            `[EmotionEngine] Micro-expression → ${best.expression}, ` +
            `anims=[${subtleAnims.join(', ')}]`
        );
    }

    return {
        expression: best.expression as AvatarExpression,
        anims: subtleAnims,
        avatarState: 'IDLE',
        micro: true,
        intensity: (best.intensity ?? 0.5) * 0.5, // Half intensity for micro
    };
}

/**
 * Resolve a contextual expression based on conversation sentiment.
 *
 * Maps sentiment to EmotionalState, then resolves the expression.
 * This creates a natural emotional arc: user says something positive
 * → FLU detects happy sentiment → FLU shows happy expression.
 *
 * @param sentiment - The detected sentiment from conversation
 * @param options - Engine options (traits, reactivity, debug)
 * @returns ResolvedExpression
 */
export function resolveContextualExpression(
    sentiment: 'positive' | 'negative' | 'neutral' | 'question' | undefined,
    options: EmotionEngineOptions = {}
): ResolvedExpression {
    // Map sentiment to emotional state
    let emotion: EmotionalState = 'neutral';
    switch (sentiment) {
        case 'positive':
            emotion = 'happy';
            break;
        case 'negative':
            emotion = 'sad';
            break;
        case 'question':
            emotion = 'curious';
            break;
        default:
            emotion = 'neutral';
    }

    const resolved = resolveEmotionExpression(emotion, options);
    return { ...resolved, emotionalState: emotion };
}

// ── Reactivity Helpers ──

/**
 * Data-driven reactivity range configuration.
 * Each entry defines a range [min, max) and a transform function.
 * To add/modify reactivity behavior: add a new entry to this table — NO code changes.
 */
interface ReactivityRange {
    /** Lower bound (inclusive) */
    min: number;
    /** Upper bound (exclusive) */
    max: number;
    /** Label for debugging */
    label: string;
    /** Transform function: (anims, effectiveReactivity) => scaled animations */
    transform: (anims: string[], effectiveReactivity: number) => BunnyAnimation[];
}

const REACTIVITY_RANGES: ReactivityRange[] = [
    {
        min: 0,
        max: 0.1,
        label: 'very-low',
        transform: (anims) => [anims[0] as BunnyAnimation],
    },
    {
        min: 0.1,
        max: 0.3,
        label: 'low',
        transform: (anims) => anims as BunnyAnimation[],
    },
    {
        min: 0.3,
        max: 1.5,
        label: 'normal',
        transform: (anims) => anims as BunnyAnimation[],
    },
    {
        min: 1.5,
        max: Infinity,
        label: 'high',
        transform: (anims) => [...anims, ...anims] as BunnyAnimation[],
    },
];

/**
 * Apply reactivity scaling to animation list.
 * DATA-DRIVEN: uses REACTIVITY_RANGES table instead of IF/else chain.
 *
 * @param anims - Original animation list
 * @param reactivity - Reactivity multiplier (0-2)
 * @param intensity - Expression intensity (0-1)
 * @returns Scaled animation list
 */
function applyReactivityToAnims(
    anims: string[],
    reactivity: number,
    intensity: number
): BunnyAnimation[] {
    if (anims.length === 0) return [];

    const effectiveReactivity = reactivity * intensity;

    // Find the matching range from the data table
    const range = REACTIVITY_RANGES.find(
        (r) => effectiveReactivity >= r.min && effectiveReactivity < r.max
    );

    if (!range) {
        // Fallback: keep as-is (shouldn't happen since last range has max: Infinity)
        return anims as BunnyAnimation[];
    }

    return range.transform(anims, effectiveReactivity);
}

// ── Utility ──

/**
 * Check if a given expression name exists in the registry.
 */
export function isValidExpression(expression: string): boolean {
    return EXPRESSION_REGISTRY.some((def) => def.expression === expression);
}

/**
 * Check if a given animation name exists in the registry.
 */
export function isValidAnimation(animation: string): boolean {
    return EXPRESSION_REGISTRY.some((def) => def.anims.includes(animation));
}

/**
 * Get the default (fallback) expression for when nothing else matches.
 */
export function getDefaultExpression(): ResolvedExpression {
    return {
        expression: 'atencion' as AvatarExpression,
        anims: ['Idle_2'] as BunnyAnimation[],
        avatarState: 'IDLE',
        intensity: 0.3,
    };
}

/**
 * Resolve a speaking expression from Gemini-suggested animation/emotion.
 * DATA-DRIVEN: validates against the registry, falls back to getDefaultExpression().
 * NO hardcoded strings — all values come from the registry or the caller.
 *
 * @param suggestedAnim - Animation suggested by Gemini (optional)
 * @param suggestedEmotion - Emotion suggested by Gemini (optional)
 * @returns ResolvedExpression suitable for applyResolved()
 */
export function resolveSpeakingExpression(
    suggestedAnim?: string,
    suggestedEmotion?: string,
): ResolvedExpression {
    const defaultExpr = getDefaultExpression();

    // If Gemini suggested a valid emotion, use it
    if (suggestedEmotion && isValidExpression(suggestedEmotion)) {
        const anims: BunnyAnimation[] = suggestedAnim && isValidAnimation(suggestedAnim)
            ? [suggestedAnim as BunnyAnimation, 'MouthMove' as BunnyAnimation]
            : [...defaultExpr.anims, 'MouthMove' as BunnyAnimation];

        return {
            expression: suggestedEmotion as AvatarExpression,
            anims,
            avatarState: 'SPEAKING',
            intensity: defaultExpr.intensity,
        };
    }

    // Fallback: use default expression with MouthMove for speaking
    const anims: BunnyAnimation[] = suggestedAnim && isValidAnimation(suggestedAnim)
        ? [suggestedAnim as BunnyAnimation, 'MouthMove' as BunnyAnimation]
        : [...defaultExpr.anims, 'MouthMove' as BunnyAnimation];

    return {
        expression: defaultExpr.expression,
        anims,
        avatarState: 'SPEAKING',
        intensity: defaultExpr.intensity,
    };
}
