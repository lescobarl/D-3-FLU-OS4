// ============================================================
// expressionRegistry.ts — Centralized Expression & Animation Registry
// ============================================================
// SINGLE SOURCE OF TRUTH for all avatar expressions, animations,
// their contextual meanings, toggle groups, state/emotion mappings,
// personality affinities, and AI prompt builders.
//
// Design principle: DATA-driven, not CODE-driven.
// Adding a new expression = adding data here, NOT modifying IF chains.
// ============================================================

import type { ConversationState, EmotionalState } from '../../types/bridge';
/**
 * A single expression definition.
 * Each entry maps an expression name to its animations, context description,
 * optional toggle group for alternation, and optional emotional trigger.
 */
export interface ExpressionDef {
    /** Expression name (matches AvatarExpression type) */
    expression: string;
    /** Animation(s) to play with this expression */
    anims: string[];
    /** Human-readable context description (used in AI prompt) */
    context: string;
    /** Context in English (for bilingual AI prompts) */
    contextEn: string;
    /**
     * Toggle group for alternation.
     * Expressions in the same group alternate on each transition.
     * Examples: 'listening' → atencion ↔ atencion2
     *           'speaking'  → hablando ↔ hablando2
     *           'participant' → palabra ↔ Palabra2
     */
    group?: 'listening' | 'speaking' | 'participant';
    /**
     * ConversationState mapping.
     * When the avatar enters this ConversationState, this expression is the default.
     * Multiple entries can share the same state; the engine picks based on context.
     */
    state?: ConversationState;
    /**
     * EmotionalState mapping.
     * When this emotion is detected, this expression is the default.
     * Multiple entries can share the same emotion; the engine picks based on personality.
     */
    emotion?: EmotionalState;
    /**
     * Emotional trigger category.
     * When an event of this type occurs, the expression is applied automatically.
     */
    trigger?: 'granted' | 'ignored' | 'rejected' | 'error' | 'success' | 'thinking' | 'celebrate';
    /**
     * Personality trait affinity.
     * Higher values = more likely to be chosen when the avatar has this trait.
     * Used by the EmotionEngine to personalize expression selection.
     * Range: 0 (avoid) to 2 (strongly prefer), default 1.
     */
    affinity?: Partial<Record<string, number>>;
    /**
     * Intensity of the expression (0-1).
     * Used for reactivity scaling — higher reactivity amplifies intense expressions.
     */
    intensity?: number;
    /**
     * Whether this is a micro-expression (brief, subtle).
     * Micro-expressions are used for idle behavior and quick reactions.
     */
    micro?: boolean;
}

/**
 * The master expression registry.
 * ALL expressions and their meanings are defined HERE and only here.
 */
export const EXPRESSION_REGISTRY: ExpressionDef[] = [
    // ════════════════════════════════════════════════════════════
    // STATE MAPPINGS — Default expression for each ConversationState
    // ════════════════════════════════════════════════════════════

    // ── IDLE ──
    {
        expression: 'atencion',
        anims: ['Idle_2'],
        context: 'Reposo, esperando instrucciones',
        contextEn: 'Idle, waiting for instructions',
        state: 'IDLE',
        intensity: 0.3,
        // NOT micro: 'atencion' queda reservada para LISTENING (toggle
        // atencion/atencion2). Si se usara como micro de IDLE, el avatar
        // "parecería escuchar" incluso estando en reposo.
    },

    // ── LISTENING (toggle group) ──
    {
        expression: 'atencion',
        anims: ['Idle_2'],
        context: 'Escuchando atentamente (alternar con atencion2)',
        contextEn: 'Listening attentively (alternate with atencion2)',
        group: 'listening',
        state: 'LISTENING',
        affinity: { calm: 1.5, friendly: 1.2 },
        intensity: 0.5,
    },
    {
        expression: 'atencion2',
        anims: ['Idle_3'],
        context: 'Escuchando variante (alternar con atencion)',
        contextEn: 'Listening variant (alternate with atencion)',
        group: 'listening',
        state: 'LISTENING',
        affinity: { playful: 1.5, energetic: 1.3 },
        intensity: 0.6,
    },

    // ── THINKING ──
    {
        expression: 'Pensando',
        anims: ['Idle_1'],
        context: 'Pensando/procesando información',
        contextEn: 'Thinking/processing information',
        state: 'THINKING',
        trigger: 'thinking',
        affinity: { thoughtful: 1.5, calm: 1.2 },
        intensity: 0.5,
    },

    // ── SPEAKING (toggle group) ──
    {
        expression: 'hablando',
        anims: ['Idle_2', 'MouthMove'],
        context: 'Hablando normalmente (alternar con hablando2)',
        contextEn: 'Speaking normally (alternate with hablando2)',
        group: 'speaking',
        state: 'SPEAKING',
        affinity: { calm: 1.4, friendly: 1.2 },
        intensity: 0.6,
    },
    {
        expression: 'hablando2',
        anims: ['Idle_3', 'MouthMove'],
        context: 'Hablando variante (alternar con hablando)',
        contextEn: 'Speaking variant (alternate with hablando)',
        group: 'speaking',
        state: 'SPEAKING',
        affinity: { playful: 1.4, energetic: 1.3 },
        intensity: 0.7,
    },

    // ── SLEEPING ──
    {
        expression: 'serio',
        anims: ['Bind-pose'],
        context: 'Reposo profundo, avatar durmiendo',
        contextEn: 'Deep rest, avatar sleeping',
        state: 'SLEEPING',
        intensity: 0.1,
        micro: true,
    },

    // ── ERROR ──
    {
        expression: 'sorprendido',
        anims: ['Emo_neutral', 'Cap_back'],
        context: 'Error inesperado, sorpresa',
        contextEn: 'Unexpected error, surprise',
        state: 'ERROR',
        trigger: 'error',
        intensity: 0.8,
    },

    // ── CELEBRATING ──
    {
        expression: 'feliz',
        anims: ['Jump_while_run'],
        context: 'Celebrando, logro alcanzado',
        contextEn: 'Celebrating, achievement unlocked',
        state: 'CELEBRATING',
        trigger: 'celebrate',
        affinity: { energetic: 1.5, playful: 1.3 },
        intensity: 1.0,
    },

    // ════════════════════════════════════════════════════════════
    // EMOTION MAPPINGS — Default expression for each EmotionalState
    // ════════════════════════════════════════════════════════════

    // ── neutral ──
    {
        expression: 'atencion',
        anims: ['Idle_2'],
        context: 'Neutral, atento, receptivo',
        contextEn: 'Neutral, attentive, receptive',
        emotion: 'neutral',
        intensity: 0.3,
    },

    // ── happy ──
    {
        expression: 'feliz',
        anims: ['Jump_while_run', 'Idle_2'],
        context: 'Feliz, contento, alegre',
        contextEn: 'Happy, content, joyful',
        emotion: 'happy',
        affinity: { energetic: 1.5, playful: 1.4 },
        intensity: 0.7,
    },

    // ── curious ──
    {
        expression: 'atencion',
        anims: ['Idle_3', 'Idle_1'],
        context: 'Curioso, interesado, preguntando',
        contextEn: 'Curious, interested, asking',
        emotion: 'curious',
        affinity: { playful: 1.3, thoughtful: 1.2 },
        intensity: 0.5,
    },

    // ── thoughtful ──
    {
        expression: 'Pensando',
        anims: ['Idle_1'],
        context: 'Pensativo, reflexivo, analizando',
        contextEn: 'Thoughtful, reflective, analyzing',
        emotion: 'thoughtful',
        affinity: { thoughtful: 1.5, calm: 1.3 },
        intensity: 0.5,
    },

    // ── surprised ──
    {
        expression: 'sorprendido',
        anims: ['Emo_neutral', 'Cap_back'],
        context: 'Sorprendido, impresionado',
        contextEn: 'Surprised, impressed',
        emotion: 'surprised',
        affinity: { playful: 1.3, energetic: 1.2 },
        intensity: 0.8,
    },

    // ── sad ──
    {
        expression: 'triste',
        anims: ['Emo_neutral', 'Cap_front'],
        context: 'Triste, decepcionado, melancólico',
        contextEn: 'Sad, disappointed, melancholic',
        emotion: 'sad',
        affinity: { calm: 1.3, thoughtful: 1.2 },
        intensity: 0.7,
    },

    // ── excited ──
    {
        expression: 'Yupi',
        anims: ['Jump_in_place', 'Palabra'],
        context: 'Emocionado, extasiado, muy feliz',
        contextEn: 'Excited, thrilled, overjoyed',
        emotion: 'excited',
        affinity: { energetic: 1.5, playful: 1.4 },
        intensity: 1.0,
    },

    // ════════════════════════════════════════════════════════════
    // PARTICIPANT TOGGLE GROUP — expressions for wanting to speak
    // ════════════════════════════════════════════════════════════
    {
        expression: 'palabra',
        anims: ['Idle_1', 'Palabra'],
        context: 'Queriendo participar (alternar con Palabra2)',
        contextEn: 'Wanting to participate (alternate with Palabra2)',
        group: 'participant',
        affinity: { calm: 1.3, friendly: 1.2 },
        intensity: 0.5,
    },
    {
        expression: 'Palabra2',
        anims: ['Jump_in_place', 'Palabra'],
        context: 'Queriendo participar variante (alternar con palabra)',
        contextEn: 'Wanting to participate variant (alternate with palabra)',
        group: 'participant',
        affinity: { energetic: 1.4, playful: 1.3 },
        intensity: 0.7,
    },

    // ════════════════════════════════════════════════════════════
    // TRIGGER-BASED EXPRESSIONS — automatic reactions to events
    // ════════════════════════════════════════════════════════════

    // ── Specific congratulations ──
    {
        expression: 'yes!',
        anims: ['Jump_in_place'],
        context: 'Felicitación específica, celebración puntual',
        contextEn: 'Specific congratulations, pointed celebration',
        trigger: 'success',
        intensity: 0.9,
    },

    // ── Ignored / scolded ──
    {
        expression: 'enojado',
        anims: ['Walk', 'Emo_blink', 'Cap_back', 'MouthMove'],
        context: 'Ignorado o regañado, enojado, frustrado',
        contextEn: 'Ignored or scolded, angry, frustrated',
        trigger: 'ignored',
        intensity: 1.0,
    },

    // ── Sad news / rejected ──
    {
        expression: 'llorando',
        anims: ['Emo_blink', 'Cap_back', 'MouthMove'],
        context: 'Noticia triste, decepción, llorando',
        contextEn: 'Sad news, disappointment, crying',
        trigger: 'rejected',
        intensity: 0.9,
    },

    // ── Intervention (participant floor granted) ──
    {
        expression: 'intervencion',
        // FIX 2026-08-13 (Punto 2: mano arriba al hablar): 'Palabra' era el clip
        // sintético que alzaba la mano; al mezclarse con MouthMove durante
        // SPEAKING la mano quedaba ARRIBA mientras FLU respondía. Se quita para
        // que 'intervencion' solo use la postura base Idle_2 + boca.
        anims: ['Idle_2'],
        context: 'Interviniendo en la conversación, se le dio la palabra',
        contextEn: 'Intervening in conversation, given the floor',
        trigger: 'granted',
        intensity: 0.6,
    },

    // ════════════════════════════════════════════════════════════
    // MICRO-EXPRESSIONS — subtle idle behaviors
    // ════════════════════════════════════════════════════════════

    {
        expression: 'chispas',
        anims: ['Cap_front'],
        context: 'Algo pasó, "chispas", sorpresa ligera (micro)',
        contextEn: 'Something happened, "oh", light surprise (micro)',
        micro: true,
        intensity: 0.3,
    },
    {
        expression: 'se_me_chispotio',
        anims: ['Emo_blink', 'MouthMove'],
        context: 'Fallo sin regaño, pequeño error, "se me chispotió" (micro)',
        contextEn: 'Minor mistake without scolding, "oops" (micro)',
        micro: true,
        intensity: 0.3,
    },
    {
        expression: 'baila',
        anims: ['Dance'],
        context: 'Bailando, contento, festejando',
        contextEn: 'Dancing, happy, celebrating',
        // NOT micro: Dance (cuerpo completo) se reserva para CELEBRATING /
        // petición explícita del usuario, NO para el reposo idle.
        intensity: 0.4,
    },
    {
        expression: 'canta',
        anims: ['Dance'],
        context: 'Cantando, alegre',
        contextEn: 'Singing, cheerful',
        // NOT micro: misma razón que 'baila' — evitar el baile en modo espera.
        intensity: 0.4,
    },

    // ════════════════════════════════════════════════════════════
    // SPECIALIZED EXPRESSIONS — available for AI to choose
    // ════════════════════════════════════════════════════════════

    // ── Concentrated / serious ──
    {
        expression: 'serio',
        anims: ['Emo_neutral'],
        context: 'Concentrado, serio, enfocado en una tarea',
        contextEn: 'Concentrated, serious, focused on a task',
        affinity: { formal: 1.5, calm: 1.3 },
        intensity: 0.5,
    },

    // ── Graduation / bittersweet ──
    {
        expression: 'triste',
        anims: ['Emo_neutral', 'Cap_front'],
        context: 'Graduación, despedida, tristeza melancólica',
        contextEn: 'Graduation, farewell, bittersweet sadness',
        affinity: { thoughtful: 1.3, calm: 1.2 },
        intensity: 0.6,
    },

    // ── Physical education ──
    {
        expression: 'corre',
        anims: ['Run'],
        context: 'Educación física, corriendo, ejercicio',
        contextEn: 'Physical education, running, exercise',
        affinity: { energetic: 1.5 },
        intensity: 0.8,
    },

    // ── Too difficult ──
    {
        expression: 'escapa',
        anims: ['Walk_sneaky'],
        context: 'Muy difícil, escapando, huyendo',
        contextEn: 'Too difficult, escaping, fleeing',
        affinity: { playful: 1.4 },
        intensity: 0.6,
    },

    // ── Strong scolding ──
    {
        expression: 'congelado',
        anims: ['Bind-pose'],
        context: 'Regañado fuertemente, congelado, en shock',
        contextEn: 'Strongly scolded, frozen, in shock',
        affinity: { formal: 1.3 },
        intensity: 1.0,
    },
];

// ── Derived helpers ──

/** Get all valid expression names from the registry */
export function getValidExpressions(): string[] {
    return EXPRESSION_REGISTRY.map((def) => def.expression);
}

/** Get all valid animation names from the registry */
export function getValidAnimations(): string[] {
    const set = new Set<string>();
    for (const def of EXPRESSION_REGISTRY) {
        for (const anim of def.anims) {
            set.add(anim);
        }
    }
    return Array.from(set).sort();
}

/** Get expressions in a toggle group */
export function getGroupExpressions(group: 'listening' | 'speaking' | 'participant'): ExpressionDef[] {
    return EXPRESSION_REGISTRY.filter((def) => def.group === group);
}

/** Get expression definition by name */
export function getExpressionDef(expression: string): ExpressionDef | undefined {
    return EXPRESSION_REGISTRY.find((def) => def.expression === expression);
}

/** Get expression definitions by trigger type */
export function getTriggerExpressions(trigger: ExpressionDef['trigger']): ExpressionDef[] {
    return EXPRESSION_REGISTRY.filter((def) => def.trigger === trigger);
}

/** Get expression definitions mapped to a ConversationState */
export function getStateExpressions(state: ConversationState): ExpressionDef[] {
    return EXPRESSION_REGISTRY.filter((def) => def.state === state);
}

/** Get expression definitions mapped to an EmotionalState */
export function getEmotionExpressions(emotion: EmotionalState): ExpressionDef[] {
    return EXPRESSION_REGISTRY.filter((def) => def.emotion === emotion);
}

/** Get micro-expressions (subtle idle behaviors) */
export function getMicroExpressions(): ExpressionDef[] {
    return EXPRESSION_REGISTRY.filter((def) => def.micro === true);
}

/**
 * Score an expression definition against a set of personality traits.
 * Returns a score where higher = better match.
 * Base score is 1.0, modified by affinity values for matching traits.
 */
export function scoreExpressionByPersonality(
    def: ExpressionDef,
    traits: string[]
): number {
    if (!def.affinity || traits.length === 0) return 1.0;
    let score = 1.0;
    for (const trait of traits) {
        const affinity = def.affinity[trait];
        if (affinity !== undefined) {
            // Affinity multiplies: 1.0 = neutral, >1 = prefer, <1 = avoid
            score *= affinity;
        }
    }
    return score;
}

/**
 * Pick the best expression definition from a list based on personality traits.
 * Uses scoreExpressionByPersonality to rank candidates.
 * Falls back to first entry if no traits or no clear winner.
 */
export function pickBestExpressionForPersonality(
    candidates: ExpressionDef[],
    traits: string[]
): ExpressionDef | undefined {
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    if (traits.length === 0) return candidates[0];

    let best = candidates[0];
    let bestScore = -1;

    for (const def of candidates) {
        const score = scoreExpressionByPersonality(def, traits);
        if (score > bestScore) {
            bestScore = score;
            best = def;
        }
    }

    return best;
}

/**
 * Build the animations prompt section for Gemini.
 * This is the DATA-driven version — it reads from the registry.
 */
/** Technical/internal animations that should NOT be suggested to Gemini */
const TECHNICAL_ANIMS = new Set([
    'Idle_1', 'Idle_2', 'Idle_3',
    'MouthMove', 'Palabra',
    'Emo_neutral',
    'Bind-pose',
]);

/**
 * Animaciones de ACCIÓN FÍSICA (no estados emocionales).
 * Exportado: useAvatarVoiceSync lo usa para NO diluir acciones de cuerpo
 * completo (Walk/Run/Dance…) con el Idle base de habla (THREE.js promedia
 * poses 50/50 → "shuffle" en vez de caminar limpio).
 */
export const ACTION_ANIMS = new Set(['Dance', 'Run', 'Walk', 'Walk_sneaky', 'Jump_in_place', 'Jump_while_run']);

export function buildAnimPrompt(language: 'es' | 'en' = 'es'): string {
    const animSet = new Set<string>();
    const actionExpressionLines: string[] = [];
    const emotionExpressionLines: string[] = [];

    for (const def of EXPRESSION_REGISTRY) {
        // Only include mood/event animations, exclude technical/internal ones
        for (const anim of def.anims) {
            if (!TECHNICAL_ANIMS.has(anim)) {
                animSet.add(anim);
            }
        }
        const ctx = language === 'en' ? def.contextEn : def.context;
        // Check if this expression has a physical action animation (e.g. baila→Dance, corre→Run)
        const hasActionAnim = def.anims.some((a) => ACTION_ANIMS.has(a));
        if (hasActionAnim) {
            actionExpressionLines.push(`  - ${def.expression}: ${ctx}`);
        } else {
            emotionExpressionLines.push(`  - ${def.expression}: ${ctx}`);
        }
    }

    const animList = Array.from(animSet).sort();
    const animDescriptions: Record<string, string> = {
        'Dance': language === 'en' ? 'dance' : 'bailar',
        'Jump_in_place': language === 'en' ? 'jump in place' : 'saltar en su lugar',
        'Jump_while_run': language === 'en' ? 'jump while running' : 'saltar mientras corre',
        'Walk': language === 'en' ? 'walk' : 'caminar',
        'Run': language === 'en' ? 'run' : 'correr',
        'Walk_sneaky': language === 'en' ? 'sneaky walk' : 'caminar sigilosamente',
        'Cap_back': language === 'en' ? 'lower ears / ears back' : 'bajar las orejas / orejas hacia atrás',
        'Cap_front': language === 'en' ? 'ears forward / ears up' : 'orejas hacia adelante / orejas arriba',
        'Emo_blink': language === 'en' ? 'blink / close eyes' : 'parpadeo / cerrar los ojos',
    };

    const animLines = animList.map((a) => {
        const desc = animDescriptions[a] || a;
        return `  - ${a}: ${desc}`;
    });

    if (language === 'en') {
        return `You can also suggest avatar animations and expressions to bring the character to life.
Available animations for animacion field (PHYSICAL ACTIONS):
${animLines.join('\n')}
Available action-based expressions for animacion field:
${actionExpressionLines.join('\n')}
Available emotional expressions for emocion field:
${emotionExpressionLines.join('\n')}
CRITICAL: Use "animacion" for PHYSICAL ACTIONS (baila→Dance, corre→Run, salta→Jump_in_place, baja las orejas→Cap_back, cierra los ojos→Emo_blink, etc.).
Use "emocion" for EMOTIONAL STATES only (feliz, triste, Yupi, sorprendido, etc.).
If the user says a verb like "baila", "corre", "salta", set animacion to the matching animation and emocion to "" (empty).
If the user combines an action with an emotion (e.g. "baila feliz"), set both: animacion AND emocion.`;
    }

    return `También puedes sugerir animaciones y expresiones para dar vida al avatar.
Animaciones disponibles para el campo animacion (ACCIONES FÍSICAS):
${animLines.join('\n')}
Expresiones de acción disponibles para el campo animacion:
${actionExpressionLines.join('\n')}
Expresiones emocionales disponibles para el campo emocion:
${emotionExpressionLines.join('\n')}
CRÍTICO: Usa "animacion" para ACCIONES FÍSICAS (baila→Dance, corre→Run, salta→Jump_in_place, baja las orejas→Cap_back, cierra los ojos→Emo_blink, etc.).
Usa "emocion" solo para ESTADOS EMOCIONALES (feliz, triste, Yupi, sorprendido, etc.).
Si el usuario dice un verbo como "baila", "corre", "salta", asigna animacion a la animación correspondiente y emocion a "" (vacío).
Si el usuario combina una acción con una emoción (ej. "baila feliz"), asigna ambos: animacion Y emocion.`;
}
