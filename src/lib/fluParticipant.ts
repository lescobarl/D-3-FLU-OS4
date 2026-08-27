// ============================================================
// fluParticipant.ts — OS3 Pure Logic: Participant State Machine
// ============================================================
// Port of OS2's fluParticipant.js to TypeScript.
// Handles: idle → evaluating → raised → cooldown cycle,
// evaluation scheduling, hand-raise timeout, cooldown,
// rate limiting, and UI presentation.
// ============================================================

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export type ParticipantPhase = 'idle' | 'evaluating' | 'raised' | 'cooldown';

export const FLU_PARTICIPANT_PHASES: readonly ParticipantPhase[] = Object.freeze([
    'idle',
    'evaluating',
    'raised',
    'cooldown',
]);

export interface ParticipantState {
    phase: ParticipantPhase;
    reason: string;
    draftContribution: string;
    confidence: number;
    raisedAt: number;
    cooldownUntil: number;
    lastEvalAt: number;
    turnsSinceLastEval: number;
    interventionTimestamps: number[];
    evalGeneration: number;
}

export interface ParticipantConfig {
    enabled: boolean;
    evaluateOnTurnCommit: boolean;
    evaluateOnManualGrant: boolean;
    evaluateEveryNTurns: number;
    evaluationWindowTurns: number;
    minConfidence: number;
    minDraftChars: number;
    maxDraftChars: number;
    minReasonChars: number;
    handRaisedTimeoutMs: number;
    cooldownAfterInterventionMs: number;
    maxInterventionsPerSession: number;
    maxInterventionsPerHour: number;
    floorGrantDedupMs: number;
    conversationOnly: boolean;
}

export interface ParticipantEvaluation {
    accepted: boolean;
    intervenir: boolean;
    confidence: number;
    reason: string;
    draftContribution: string;
}

export interface ParticipantUiPresentation {
    show: boolean;
    tone: 'raised' | 'evaluating' | 'idle';
    label: string;
    reason: string;
    phase: ParticipantPhase;
}

export interface FloorGrantContext {
    speechActive?: boolean;
    lastGrantAt?: number;
    delivering?: boolean;
    now?: number;
}

// -----------------------------------------------------------
// Defaults
// -----------------------------------------------------------

export const DEFAULT_PARTICIPANT_CONFIG: ParticipantConfig = {
    enabled: true,
    evaluateOnTurnCommit: true,
    evaluateOnManualGrant: true,
    evaluateEveryNTurns: 3,
    evaluationWindowTurns: 8,
    minConfidence: 0.5,
    minDraftChars: 20,
    maxDraftChars: 420,
    minReasonChars: 10,
    handRaisedTimeoutMs: 15000,
    cooldownAfterInterventionMs: 10000,
    maxInterventionsPerSession: 10,
    maxInterventionsPerHour: 20,
    floorGrantDedupMs: 3000,
    // OS3 parity: con conversationOnly=false FLU evalúa también en escucha pasiva
    // (sin «Iniciar conversación»). canScheduleParticipantEvaluation y el hook lo respetan.
    conversationOnly: false,
};

// -----------------------------------------------------------
// Labels (OS2 parity: resolveFluParticipantLabel)
// -----------------------------------------------------------

const UI_LABELS: Record<string, { es: string; en: string }> = {
    handRaisedLabel: { es: 'Flu pide la palabra', en: 'Flu wants to speak' },
    evaluatingLabel: { es: 'Flu aprendiendo…', en: 'Flu is learning…' },
    idleLabel: { es: 'Flu participante', en: 'Flu participant' },
    idleHint: { es: 'Flu escucha y evalua cuando intervenir', en: 'Flu listens and evaluates when to intervene' },
};

export function resolveFluParticipantLabel(key: string, language: string): string {
    const entry = UI_LABELS[key];
    if (!entry) return '';
    const lang = language === 'en' ? 'en' : 'es';
    return entry[lang] || entry.es || '';
}

// -----------------------------------------------------------
// State factory
// -----------------------------------------------------------

export function createFluParticipantState(): ParticipantState {
    return {
        phase: 'idle',
        reason: '',
        draftContribution: '',
        confidence: 0,
        raisedAt: 0,
        cooldownUntil: 0,
        lastEvalAt: 0,
        turnsSinceLastEval: 0,
        interventionTimestamps: [],
        evalGeneration: 0,
    };
}

// -----------------------------------------------------------
// Log window builder
// -----------------------------------------------------------

export interface LogRow {
    speaker: string;
    text: string;
}

export function buildParticipantLogWindow(
    texts: string[],
    speakers: string[],
    { maxTurns = 8 }: { maxTurns?: number } = {},
): LogRow[] {
    const rows: LogRow[] = [];
    const count = texts.length;
    const start = Math.max(0, count - Math.max(1, maxTurns));

    for (let index = start; index < count; index += 1) {
        const text = String(texts[index] || '').trim();
        if (!text) continue;
        const speaker = String(speakers[index] || speakers[speakers.length - 1] || 'Hablante 1').trim() || 'Hablante 1';
        rows.push({ speaker, text });
    }

    return rows;
}

// -----------------------------------------------------------
// Format for Gemini prompt
// -----------------------------------------------------------

export function formatParticipantLogForPrompt(rows: LogRow[], language: string = 'es'): string {
    if (!rows.length) {
        return language === 'en' ? '(empty conversation)' : '(conversación vacía)';
    }
    return rows.map((row, index) => `${index + 1}. ${row.speaker}: ${row.text}`).join('\n');
}

// -----------------------------------------------------------
// Rate limiting helpers
// -----------------------------------------------------------

function countInterventionsInHour(timestamps: number[], now: number = Date.now()): number {
    const hourAgo = now - 60 * 60 * 1000;
    return timestamps.filter((at) => at >= hourAgo).length;
}

// -----------------------------------------------------------
// Evaluation scheduling
// -----------------------------------------------------------

export function shouldEvaluateParticipantOnTurn(state: ParticipantState, cfg: ParticipantConfig): boolean {
    const every = Number(cfg.evaluateEveryNTurns);
    const nextCount = Number(state.turnsSinceLastEval) + 1;
    return nextCount >= every;
}

export function advanceParticipantTurnCounter(state: ParticipantState, cfg: ParticipantConfig): ParticipantState {
    const every = Number(cfg.evaluateEveryNTurns);
    const nextCount = Number(state.turnsSinceLastEval) + 1;

    if (nextCount >= every) {
        return { ...state, turnsSinceLastEval: 0 };
    }
    return { ...state, turnsSinceLastEval: nextCount };
}

export function canScheduleParticipantEvaluation(
    state: ParticipantState,
    cfg: ParticipantConfig,
    {
        conversationActive = false,
        turnCount = 0,
        now = Date.now(),
        force = false,
        textBackendUsable = true,
    }: {
        conversationActive?: boolean;
        turnCount?: number;
        now?: number;
        force?: boolean;
        textBackendUsable?: boolean;
    } = {},
): boolean {
    // FLU jamás agenda una evaluación si no hay un backend de texto utilizable
    // (sin API key y sin endpoint local): llamar generaría un error inútil en
    // generateParticipantEvaluation y ruido "evaluation failed". El hook pasa
    // textBackendUsable: hasUsableTextBackend(). Por defecto true para no
    // cambiar el comportamiento de los llamadores que no lo informan.
    if (textBackendUsable === false) return false;
    // NOTA: el gate de conversación activa se decide SOLO por cfg.conversationOnly
    // (línea siguiente). Antes, esta línea retornaba false con !conversationActive
    // incondicionalmente, dejando muerta la opción conversationOnly=false.
    if (cfg.enabled === false) return false;
    if (cfg.conversationOnly !== false && !conversationActive) return false;
    if (!force && cfg.evaluateOnTurnCommit === false) return false;
    if (force && cfg.evaluateOnManualGrant === false) return false;
    if (state.phase === 'evaluating' || state.phase === 'raised') return false;
    if (state.phase === 'cooldown' && now < state.cooldownUntil) return false;

    const committedTurns = Number(turnCount);
    if (!Number.isFinite(committedTurns)) return false;

    if (force) {
        if (committedTurns < 1) return false;
    } else if (committedTurns < Number(cfg.evaluateEveryNTurns)) {
        return false;
    }

    if (state.interventionTimestamps.length >= Number(cfg.maxInterventionsPerSession)) {
        return false;
    }

    if (countInterventionsInHour(state.interventionTimestamps, now) >= Number(cfg.maxInterventionsPerHour)) {
        return false;
    }

    return true;
}

// -----------------------------------------------------------
// Normalize Gemini evaluation response
// -----------------------------------------------------------

export function normalizeParticipantEvaluation(raw: Record<string, unknown>, cfg: ParticipantConfig): ParticipantEvaluation {
    const minConf = Number(cfg.minConfidence);
    const minChars = Number(cfg.minDraftChars);
    const maxChars = Number(cfg.maxDraftChars);
    const minReason = Number(cfg.minReasonChars);

    const intervenir = Boolean(raw.intervenir ?? raw.should_intervene);

    let confidence = Number(raw.confianza);
    if (!Number.isFinite(confidence)) confidence = Number(raw.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;

    let reason = String(raw.motivo_corto ?? raw.short_reason ?? '').trim();
    let draft = String(raw.borrador_aportacion ?? raw.draft_contribution ?? '').trim();

    if (draft.length > maxChars) draft = `${draft.slice(0, maxChars - 1)}…`;

    const accepted = intervenir && confidence >= minConf && draft.length >= minChars && reason.length >= minReason;

    return { accepted, intervenir, confidence, reason, draftContribution: draft };
}

// -----------------------------------------------------------
// Apply evaluation result to state
// -----------------------------------------------------------

export function applyParticipantEvaluation(
    state: ParticipantState,
    evaluation: ParticipantEvaluation | null,
    now: number = Date.now(),
): ParticipantState {
    const next = { ...state, lastEvalAt: now, turnsSinceLastEval: 0 };

    if (!evaluation?.accepted) {
        next.phase = next.phase === 'evaluating' ? 'idle' : next.phase;
        return next;
    }

    next.phase = 'raised';
    next.reason = evaluation.reason;
    next.draftContribution = evaluation.draftContribution;
    next.confidence = evaluation.confidence;
    next.raisedAt = now;
    return next;
}

// -----------------------------------------------------------
// Dismiss raised hand
// -----------------------------------------------------------

export function dismissRaisedHand(state: ParticipantState, now: number = Date.now()): ParticipantState {
    return {
        ...state,
        phase: 'idle',
        reason: '',
        draftContribution: '',
        confidence: 0,
        raisedAt: 0,
    };
}

// -----------------------------------------------------------
// Consume raised draft (transition to cooldown)
// -----------------------------------------------------------

export function consumeRaisedDraft(
    state: ParticipantState,
    cfg: ParticipantConfig,
): { state: ParticipantState; draft: string } {
    if (state.phase !== 'raised' || !state.draftContribution) {
        return { state, draft: '' };
    }

    const draft = state.draftContribution;

    return {
        draft,
        state: {
            ...state,
            phase: 'cooldown',
            reason: '',
            draftContribution: '',
            confidence: 0,
            raisedAt: 0,
            cooldownUntil: Date.now() + Number(cfg.cooldownAfterInterventionMs),
        },
    };
}

// -----------------------------------------------------------
// Record intervention timestamp
// -----------------------------------------------------------

export function recordParticipantIntervention(state: ParticipantState, now: number = Date.now()): ParticipantState {
    return {
        ...state,
        interventionTimestamps: [...(state.interventionTimestamps || []), now],
    };
}

// -----------------------------------------------------------
// Auto-dismiss check
// -----------------------------------------------------------

export function shouldAutoDismissRaisedHand(
    state: ParticipantState,
    cfg: ParticipantConfig,
    now: number = Date.now(),
): boolean {
    if (state.phase !== 'raised') return false;
    const timeout = Number(cfg.handRaisedTimeoutMs);
    if (!timeout || !state.raisedAt) return false;
    return now - state.raisedAt >= timeout;
}

// -----------------------------------------------------------
// UI Presentation
// -----------------------------------------------------------

export function resolveParticipantUiPresentation(
    state: ParticipantState,
    language: string = 'es',
    cfg?: ParticipantConfig,
): ParticipantUiPresentation {
    const config = cfg ?? DEFAULT_PARTICIPANT_CONFIG;

    if (config.enabled === false) {
        return { show: false, tone: 'idle', label: '', reason: '', phase: state.phase };
    }

    if (state.phase === 'raised') {
        return {
            show: true,
            tone: 'raised',
            label: resolveFluParticipantLabel('handRaisedLabel', language),
            reason: state.reason || '',
            phase: state.phase,
        };
    }

    if (state.phase === 'evaluating') {
        return {
            show: true,
            tone: 'evaluating',
            label: resolveFluParticipantLabel('evaluatingLabel', language),
            reason: '',
            phase: state.phase,
        };
    }

    return {
        show: true,
        tone: 'idle',
        label: resolveFluParticipantLabel('idleLabel', language),
        reason: resolveFluParticipantLabel('idleHint', language),
        phase: state.phase,
    };
}

// -----------------------------------------------------------
// Floor grant checks
// -----------------------------------------------------------

export function canGrantParticipantFloor(state: ParticipantState, cfg: ParticipantConfig): boolean {
    if (cfg.enabled === false) return false;
    return state.phase === 'raised' && Boolean(String(state.draftContribution || '').trim());
}

export function shouldIgnoreParticipantFloorGrant(
    state: ParticipantState,
    {
        speechActive = false,
        lastGrantAt = 0,
        delivering = false,
        cfg = DEFAULT_PARTICIPANT_CONFIG,
        now = Date.now(),
    }: FloorGrantContext & { cfg?: ParticipantConfig } = {},
): boolean {
    if (delivering || speechActive) return true;
    if (state.phase === 'cooldown' && now < state.cooldownUntil) return true;
    const dedupMs = Number(cfg.floorGrantDedupMs) || 0;
    if (dedupMs > 0 && lastGrantAt && now - lastGrantAt < dedupMs) return true;
    return false;
}
