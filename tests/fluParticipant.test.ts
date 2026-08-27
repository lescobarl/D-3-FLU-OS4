// ============================================================
// Unit Tests — fluParticipant.ts (machine de estado de participación)
// Dominio: intervención y participación de FLU (que decida participar)
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    createFluParticipantState,
    DEFAULT_PARTICIPANT_CONFIG,
    shouldEvaluateParticipantOnTurn,
    advanceParticipantTurnCounter,
    canScheduleParticipantEvaluation,
    normalizeParticipantEvaluation,
    applyParticipantEvaluation,
    dismissRaisedHand,
    consumeRaisedDraft,
    recordParticipantIntervention,
    shouldAutoDismissRaisedHand,
    canGrantParticipantFloor,
    shouldIgnoreParticipantFloorGrant,
    buildParticipantLogWindow,
    formatParticipantLogForPrompt,
    resolveFluParticipantLabel,
} from '../src/lib/fluParticipant';

const NOW = 1_800_000_000_000;

describe('fluParticipant — estado inicial', () => {
    it('createFluParticipantState arranca idle sin deudas', () => {
        const s = createFluParticipantState();
        expect(s.phase).toBe('idle');
        expect(s.turnsSinceLastEval).toBe(0);
        expect(s.interventionTimestamps).toEqual([]);
        expect(s.cooldownUntil).toBe(0);
        expect(s.raisedAt).toBe(0);
    });
});

describe('fluParticipant — turnos para evaluar', () => {
    it('shouldEvaluateParticipantOnTurn se cumple al llegar a evaluateEveryNTurns', () => {
        const s = { ...createFluParticipantState(), turnsSinceLastEval: 2 };
        expect(shouldEvaluateParticipantOnTurn(s, DEFAULT_PARTICIPANT_CONFIG)).toBe(true);
    });

    it('shouldEvaluateParticipantOnTurn es false antes del umbral', () => {
        const s = { ...createFluParticipantState(), turnsSinceLastEval: 1 };
        expect(shouldEvaluateParticipantOnTurn(s, DEFAULT_PARTICIPANT_CONFIG)).toBe(false);
    });

    it('advanceParticipantTurnCounter incrementa y resetea al umbral', () => {
        const s = { ...createFluParticipantState(), turnsSinceLastEval: 1 };
        expect(advanceParticipantTurnCounter(s, DEFAULT_PARTICIPANT_CONFIG).turnsSinceLastEval).toBe(2);
        const near = { ...createFluParticipantState(), turnsSinceLastEval: 2 };
        expect(advanceParticipantTurnCounter(near, DEFAULT_PARTICIPANT_CONFIG).turnsSinceLastEval).toBe(0);
    });
});

describe('fluParticipant — canScheduleParticipantEvaluation', () => {
    const base = { conversationActive: true, turnCount: 5, now: NOW };

    it('es false si la feature está deshabilitada', () => {
        const cfg = { ...DEFAULT_PARTICIPANT_CONFIG, enabled: false };
        expect(canScheduleParticipantEvaluation(createFluParticipantState(), cfg, base)).toBe(false);
    });

    it('es false sin conversación activa cuando conversationOnly=true', () => {
        const cfg = { ...DEFAULT_PARTICIPANT_CONFIG, conversationOnly: true };
        expect(
            canScheduleParticipantEvaluation(createFluParticipantState(), cfg, {
                ...base,
                conversationActive: false,
            }),
        ).toBe(false);
    });

    it('es true sin conversación activa cuando conversationOnly=false (escucha pasiva, OS3 parity)', () => {
        const cfg = { ...DEFAULT_PARTICIPANT_CONFIG, conversationOnly: false };
        expect(
            canScheduleParticipantEvaluation(createFluParticipantState(), cfg, {
                ...base,
                conversationActive: false,
            }),
        ).toBe(true);
    });

    it('es false durante evaluating o raised', () => {
        const evaluating = { ...createFluParticipantState(), phase: 'evaluating' as const };
        const raised = { ...createFluParticipantState(), phase: 'raised' as const };
        expect(canScheduleParticipantEvaluation(evaluating, DEFAULT_PARTICIPANT_CONFIG, base)).toBe(false);
        expect(canScheduleParticipantEvaluation(raised, DEFAULT_PARTICIPANT_CONFIG, base)).toBe(false);
    });

    it('es false durante cooldown activo', () => {
        const s = {
            ...createFluParticipantState(),
            phase: 'cooldown' as const,
            cooldownUntil: NOW + 5_000,
        };
        expect(canScheduleParticipantEvaluation(s, DEFAULT_PARTICIPANT_CONFIG, base)).toBe(false);
    });

    it('es false si turnCount es menor a evaluateEveryNTurns (auto)', () => {
        expect(
            canScheduleParticipantEvaluation(createFluParticipantState(), DEFAULT_PARTICIPANT_CONFIG, {
                ...base,
                turnCount: 2,
            }),
        ).toBe(false);
    });

    it('es true en auto con turnos suficientes', () => {
        expect(
            canScheduleParticipantEvaluation(createFluParticipantState(), DEFAULT_PARTICIPANT_CONFIG, base),
        ).toBe(true);
    });

    it('es false sin backend de texto utilizable (textBackendUsable=false)', () => {
        expect(
            canScheduleParticipantEvaluation(createFluParticipantState(), DEFAULT_PARTICIPANT_CONFIG, {
                ...base,
                textBackendUsable: false,
            }),
        ).toBe(false);
    });

    it('es true con textBackendUsable=true (no altera el gate por defecto)', () => {
        expect(
            canScheduleParticipantEvaluation(createFluParticipantState(), DEFAULT_PARTICIPANT_CONFIG, {
                ...base,
                textBackendUsable: true,
            }),
        ).toBe(true);
    });

    it('es false al alcanzar maxInterventionsPerSession', () => {
        const s = {
            ...createFluParticipantState(),
            interventionTimestamps: Array(10).fill(NOW - 1_000),
        };
        expect(canScheduleParticipantEvaluation(s, DEFAULT_PARTICIPANT_CONFIG, base)).toBe(false);
    });

    it('es false al alcanzar maxInterventionsPerHour', () => {
        const s = {
            ...createFluParticipantState(),
            interventionTimestamps: Array(20).fill(NOW - 30_000),
        };
        expect(canScheduleParticipantEvaluation(s, DEFAULT_PARTICIPANT_CONFIG, base)).toBe(false);
    });

    it('force=true exige al menos 1 turno y respeta evaluateOnManualGrant', () => {
        expect(
            canScheduleParticipantEvaluation(createFluParticipantState(), DEFAULT_PARTICIPANT_CONFIG, {
                ...base,
                force: true,
            }),
        ).toBe(true);
        const noManual = { ...DEFAULT_PARTICIPANT_CONFIG, evaluateOnManualGrant: false };
        expect(
            canScheduleParticipantEvaluation(createFluParticipantState(), noManual, {
                ...base,
                force: true,
            }),
        ).toBe(false);
        expect(
            canScheduleParticipantEvaluation(createFluParticipantState(), DEFAULT_PARTICIPANT_CONFIG, {
                ...base,
                force: true,
                turnCount: 0,
            }),
        ).toBe(false);
    });
});

describe('fluParticipant — normalizeParticipantEvaluation', () => {
    it('acepta cuando cumplen intervenir + confianza + borrador + razón', () => {
        const raw = {
            intervenir: true,
            confianza: 0.8,
            borrador_aportacion: 'Creo que deberíamos avanzar con el siguiente tema',
            motivo_corto: 'Hay consenso',
        };
        const ev = normalizeParticipantEvaluation(raw, DEFAULT_PARTICIPANT_CONFIG);
        expect(ev.accepted).toBe(true);
        expect(ev.draftContribution.length).toBeGreaterThanOrEqual(20);
    });

    it('rechaza por confianza baja', () => {
        const ev = normalizeParticipantEvaluation(
            {
                should_intervene: true,
                confidence: 0.3,
                draft_contribution: 'Creo que deberíamos avanzar con el siguiente tema',
                short_reason: 'Hay consenso',
            },
            DEFAULT_PARTICIPANT_CONFIG,
        );
        expect(ev.accepted).toBe(false);
    });

    it('rechaza por borrador corto', () => {
        const ev = normalizeParticipantEvaluation(
            {
                intervenir: true,
                confianza: 0.9,
                borrador_aportacion: 'Sí',
                motivo_corto: 'Hay consenso',
            },
            DEFAULT_PARTICIPANT_CONFIG,
        );
        expect(ev.accepted).toBe(false);
    });

    it('rechaza por razón corta', () => {
        const ev = normalizeParticipantEvaluation(
            {
                intervenir: true,
                confianza: 0.9,
                borrador_aportacion: 'Creo que deberíamos avanzar con el siguiente tema',
                motivo_corto: 'x',
            },
            DEFAULT_PARTICIPANT_CONFIG,
        );
        expect(ev.accepted).toBe(false);
    });

    it('trunca el borrador a maxDraftChars', () => {
        const longDraft = 'a'.repeat(600);
        const ev = normalizeParticipantEvaluation(
            {
                intervenir: true,
                confianza: 0.9,
                borrador_aportacion: longDraft,
                motivo_corto: 'Hay consenso',
            },
            DEFAULT_PARTICIPANT_CONFIG,
        );
        expect(ev.draftContribution.length).toBeLessThanOrEqual(420);
    });
});

describe('fluParticipant — applyParticipantEvaluation / ciclo raised→cooldown', () => {
    it('evaluación aceptada → phase raised con borrador y razones', () => {
        const from = { ...createFluParticipantState(), phase: 'evaluating' as const };
        const ev = {
            accepted: true,
            intervenir: true,
            confidence: 0.9,
            reason: 'Hay consenso',
            draftContribution: 'Creo que deberíamos avanzar con el siguiente tema',
        };
        const next = applyParticipantEvaluation(from, ev, NOW);
        expect(next.phase).toBe('raised');
        expect(next.draftContribution).toBe(ev.draftContribution);
        expect(next.raisedAt).toBe(NOW);
        expect(next.lastEvalAt).toBe(NOW);
        expect(next.turnsSinceLastEval).toBe(0);
    });

    it('evaluación rechazada vuelve a idle desde evaluating', () => {
        const from = { ...createFluParticipantState(), phase: 'evaluating' as const };
        const next = applyParticipantEvaluation(from, null, NOW);
        expect(next.phase).toBe('idle');
        expect(next.lastEvalAt).toBe(NOW);
    });

    it('consumeRaisedDraft entrega el borrador y pasa a cooldown', () => {
        const raised = {
            ...createFluParticipantState(),
            phase: 'raised' as const,
            draftContribution: 'Quiero aportar algo',
            confidence: 0.8,
            raisedAt: NOW,
        };
        // La implementación usa Date.now() real (no raisedAt/NOW) para el cooldown.
        const before = Date.now();
        const { state, draft } = consumeRaisedDraft(raised, DEFAULT_PARTICIPANT_CONFIG);
        const after = Date.now();
        expect(draft).toBe('Quiero aportar algo');
        expect(state.phase).toBe('cooldown');
        expect(state.draftContribution).toBe('');
        expect(state.cooldownUntil).toBeGreaterThanOrEqual(before);
        expect(state.cooldownUntil).toBeLessThanOrEqual(
            after + DEFAULT_PARTICIPANT_CONFIG.cooldownAfterInterventionMs,
        );
    });

    it('consumeRaisedDraft es no-op sin phase raised', () => {
        const idle = createFluParticipantState();
        const { state, draft } = consumeRaisedDraft(idle, DEFAULT_PARTICIPANT_CONFIG);
        expect(draft).toBe('');
        expect(state.phase).toBe('idle');
    });

    it('recordParticipantIntervention acumula timestamps', () => {
        const next = recordParticipantIntervention(createFluParticipantState(), NOW);
        expect(next.interventionTimestamps).toEqual([NOW]);
    });

    it('dismissRaisedHand limpia y vuelve a idle', () => {
        const raised = {
            ...createFluParticipantState(),
            phase: 'raised' as const,
            draftContribution: 'texto',
            raisedAt: NOW,
            confidence: 0.7,
        };
        const next = dismissRaisedHand(raised, NOW);
        expect(next.phase).toBe('idle');
        expect(next.draftContribution).toBe('');
        expect(next.raisedAt).toBe(0);
    });

    it('shouldAutoDismissRaisedHand respeta handRaisedTimeoutMs', () => {
        const raised = { ...createFluParticipantState(), phase: 'raised' as const, raisedAt: NOW };
        expect(shouldAutoDismissRaisedHand(raised, DEFAULT_PARTICIPANT_CONFIG, NOW + 14_999)).toBe(false);
        expect(shouldAutoDismissRaisedHand(raised, DEFAULT_PARTICIPANT_CONFIG, NOW + 15_000)).toBe(true);
    });
});

describe('fluParticipant — floor grant', () => {
    it('canGrantParticipantFloor solo en raised con borrador', () => {
        const raised = {
            ...createFluParticipantState(),
            phase: 'raised' as const,
            draftContribution: 'Quiero hablar',
        };
        expect(canGrantParticipantFloor(raised, DEFAULT_PARTICIPANT_CONFIG)).toBe(true);
        expect(canGrantParticipantFloor(createFluParticipantState(), DEFAULT_PARTICIPANT_CONFIG)).toBe(false);
        const disabled = { ...DEFAULT_PARTICIPANT_CONFIG, enabled: false };
        expect(canGrantParticipantFloor(raised, disabled)).toBe(false);
    });

    it('shouldIgnoreParticipantFloorGrant por entrega/voz activa/cooldown/dedup', () => {
        const raised = {
            ...createFluParticipantState(),
            phase: 'raised' as const,
            draftContribution: 'x',
        };
        expect(shouldIgnoreParticipantFloorGrant(raised, { delivering: true, cfg: DEFAULT_PARTICIPANT_CONFIG })).toBe(true);
        expect(shouldIgnoreParticipantFloorGrant(raised, { speechActive: true, cfg: DEFAULT_PARTICIPANT_CONFIG })).toBe(true);

        const cooldown = {
            ...createFluParticipantState(),
            phase: 'cooldown' as const,
            cooldownUntil: NOW + 5_000,
        };
        expect(
            shouldIgnoreParticipantFloorGrant(cooldown, { cfg: DEFAULT_PARTICIPANT_CONFIG, now: NOW }),
        ).toBe(true);

        expect(
            shouldIgnoreParticipantFloorGrant(raised, {
                cfg: DEFAULT_PARTICIPANT_CONFIG,
                lastGrantAt: NOW - 1_000,
                now: NOW,
            }),
        ).toBe(true);
        expect(
            shouldIgnoreParticipantFloorGrant(raised, {
                cfg: DEFAULT_PARTICIPANT_CONFIG,
                lastGrantAt: NOW - 10_000,
                now: NOW,
            }),
        ).toBe(false);
    });
});

describe('fluParticipant — log y labels', () => {
    it('buildParticipantLogWindow toma la ventana de maxTurns al final', () => {
        const rows = buildParticipantLogWindow(
            ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'],
            ['H1', 'H1', 'H1', 'H1', 'H1', 'H1', 'H1', 'H1', 'H1'],
        );
        // 9 entradas no vacías → ventana de 8 (se descarta la más antigua 'uno')
        expect(rows.length).toBe(8);
        expect(rows[0].text).toBe('dos');
        expect(rows[rows.length - 1].text).toBe('nueve');
    });

    it('buildParticipantLogWindow salta entradas vacías dentro de la ventana', () => {
        const rows = buildParticipantLogWindow(
            ['uno', '', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'],
            ['H1', 'H1', 'H1', 'H1', 'H1', 'H1', 'H1', 'H1', 'H1'],
        );
        // 9 entradas (una vacía en índice 1) → start=1, se recorre 1..8 saltando el vacío → 7 filas
        expect(rows.length).toBe(7);
        expect(rows[0].text).toBe('tres');
        expect(rows[rows.length - 1].text).toBe('nueve');
        expect(rows.every((r) => r.text.length > 0)).toBe(true);
    });

    it('formatParticipantLogForPrompt enumera con speaker', () => {
        const text = formatParticipantLogForPrompt(
            [{ speaker: 'Hablante 1', text: 'hola' }],
            'es',
        );
        expect(text).toContain('1. Hablante 1: hola');
    });

    it('resolveFluParticipantLabel bilingüe', () => {
        expect(resolveFluParticipantLabel('handRaisedLabel', 'es')).toBe('Flu pide la palabra');
        expect(resolveFluParticipantLabel('handRaisedLabel', 'en')).toBe('Flu wants to speak');
    });
});
