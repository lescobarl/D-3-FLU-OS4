// @vitest-environment jsdom
// ============================================================
// Tests para useFluParticipant — regresión OS4: participación en el turno N
// ============================================================
// OS3 disparaba onTurnCommitted DESPUÉS de agregar SIEMPRE una fila al store,
// por lo que conteo de filas == conteo de commits y la puerta
// turnCount>=evaluateEveryNTurns pasaba en el 3er turno.
// OS4 desacopló ambos (las revisiones ASR reemplazan la última fila y
// refreshNeeded=false salta la escritura), así que contar filas del store
// rechazaba la evaluación en el 3er commit. El fix usa un contador de commits
// monotónico (committedTurnsRef) independiente del store.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { RefObject } from 'react';
import { useFluParticipant } from '../src/hooks/useFluParticipant';
import { STORAGE_KEYS } from '../src/core/config/appConfig';

const { generateParticipantEvaluationMock } = vi.hoisted(() => ({
    generateParticipantEvaluationMock: vi.fn(),
}));

vi.mock('../src/services/aiServiceFactory', () => ({
    aiService: {
        generateParticipantEvaluation: generateParticipantEvaluationMock,
    },
}));

// Stub SpeechSynthesis (accede window.speechSynthesis?.speaking en floor grants)
Object.defineProperty(window, 'speechSynthesis', {
    value: { speaking: false, getVoices: () => [] },
    writable: true,
    configurable: true,
});

const evaluationResponse = {
    intervenir: true,
    confianza: 0.85,
    borrador_aportacion: 'Quisiera aportar el punto sobre el tema en discusión',
    motivo_corto: 'Tengo información relevante que aportar',
};

describe('useFluParticipant — turno N con historial desacoplado (regresión OS4)', () => {
    beforeEach(() => {
        generateParticipantEvaluationMock.mockReset();
        generateParticipantEvaluationMock.mockResolvedValue(evaluationResponse);
        // El hook solo agenda la evaluación si hasUsableTextBackend() es true (sin API key
        // ni endpoint local no evalúa, por diseño: ver canScheduleParticipantEvaluation).
        // La clave debe venir del test: resolveDeepSeekApiKey() lee primero este storage y
        // luego OPENROUTER_CONFIG.API_KEY, constante de módulo ya evaluada al importar, así
        // que vi.stubEnv no sirve aquí. Sin sembrar el storage, el resultado dependía de si
        // la máquina tenía un .env SIN versionar y estos dos tests no evaluaban en CI.
        localStorage.setItem(STORAGE_KEYS.TEXT_API_KEY, 'test-key');
    });

    afterEach(() => {
        localStorage.removeItem(STORAGE_KEYS.TEXT_API_KEY);
    });

    it('evalúa en el 3er commit aunque el historial tenga <3 filas', async () => {
        const conversationActiveRef: RefObject<boolean> = { current: true };
        // Simula el store de OS4: las revisiones ASR reemplazan la última fila,
        // así que tras 3 commits el historial solo tiene 2 filas.
        const getLogSnapshot = () => ({
            texts: ['primera intervención', 'segunda intervención'],
            speakers: ['Hablante 1', 'Hablante 1'],
        });

        const { result } = renderHook(() =>
            useFluParticipant({
                conversationActiveRef,
                getLogSnapshot,
            }),
        );

        act(() => result.current.onTurnCommitted()); // turno 1
        act(() => result.current.onTurnCommitted()); // turno 2
        act(() => result.current.onTurnCommitted()); // turno 3 → debe evaluar

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(generateParticipantEvaluationMock).toHaveBeenCalledTimes(1);
        expect(result.current.hasRaisedHand()).toBe(true);
    });

    it('aplica configOverrides reales (evaluateEveryNTurns=2) al hook', async () => {
        const conversationActiveRef: RefObject<boolean> = { current: true };
        const getLogSnapshot = () => ({
            texts: ['única fila en el historial'],
            speakers: ['Hablante 1'],
        });

        const { result } = renderHook(() =>
            useFluParticipant({
                conversationActiveRef,
                getLogSnapshot,
                config: { evaluateEveryNTurns: 2 },
            }),
        );

        act(() => result.current.onTurnCommitted()); // turno 1 → aún no
        act(() => result.current.onTurnCommitted()); // turno 2 → debe evaluar

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(generateParticipantEvaluationMock).toHaveBeenCalledTimes(1);
    });

    it('NO evalúa si el número de commits es menor al umbral (conservador)', async () => {
        const conversationActiveRef: RefObject<boolean> = { current: true };
        const getLogSnapshot = () => ({ texts: [], speakers: [] });

        const { result } = renderHook(() =>
            useFluParticipant({
                conversationActiveRef,
                getLogSnapshot,
            }),
        );

        act(() => result.current.onTurnCommitted()); // turno 1
        act(() => result.current.onTurnCommitted()); // turno 2

        await act(async () => {
            await Promise.resolve();
        });

        expect(generateParticipantEvaluationMock).not.toHaveBeenCalled();
    });
});
