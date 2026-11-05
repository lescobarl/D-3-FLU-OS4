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
import { readFileSync } from 'node:fs';
import { renderHook, act } from '@testing-library/react';
import type { RefObject } from 'react';
import { useFluParticipant } from '../src/hooks/useFluParticipant';
import { STORAGE_KEYS } from '../src/core/config/appConfig';
import { hasUsableTextBackend } from '../src/services/deepseek';

const { generateParticipantEvaluationMock } = vi.hoisted(() => ({
    generateParticipantEvaluationMock: vi.fn(),
}));

vi.mock('../src/services/aiServiceFactory', () => ({
    aiService: {
        generateParticipantEvaluation: generateParticipantEvaluationMock,
        // La capacidad NO se stubea: delega en la implementacion real para que este
        // test siga midiendo que sin clave/endpoint de texto el hook no evalua.
        canUseTextBackend: () => hasUsableTextBackend(),
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
        // El hook solo agenda la evaluación si el servicio declara su capacidad de texto
        // (canUseTextBackend; sin API key
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

    it('dedupe: el MISMO turnId reportado por motor y pasivo cuenta UNA vez', async () => {
        const conversationActiveRef: RefObject<boolean> = { current: true };
        const getLogSnapshot = () => ({ texts: ['turno'], speakers: ['Hablante 1'] });

        const { result } = renderHook(() =>
            useFluParticipant({
                conversationActiveRef,
                getLogSnapshot,
                config: { evaluateEveryNTurns: 3 },
            }),
        );

        // El motor activo y el escritor pasivo reportan el MISMO turno; una revision
        // ASR lo repite. Tres avisos del mismo `turnId` son UN turno, no tres.
        act(() => {
            result.current.onTurnCommitted('t1');
            result.current.onTurnCommitted('t1');
            result.current.onTurnCommitted('t1');
        });

        await act(async () => {
            await Promise.resolve();
        });

        expect(generateParticipantEvaluationMock).not.toHaveBeenCalled();

        act(() => result.current.onTurnCommitted('t2'));
        act(() => result.current.onTurnCommitted('t3'));

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(generateParticipantEvaluationMock).toHaveBeenCalledTimes(1);
    });

    it('resetParticipant limpia la identidad de turno (sesion nueva reusa ids)', async () => {
        const conversationActiveRef: RefObject<boolean> = { current: true };
        const getLogSnapshot = () => ({ texts: ['turno'], speakers: ['Hablante 1'] });

        const { result } = renderHook(() =>
            useFluParticipant({
                conversationActiveRef,
                getLogSnapshot,
                config: { evaluateEveryNTurns: 2 },
            }),
        );

        act(() => result.current.onTurnCommitted('t1'));
        act(() => result.current.resetParticipant());
        // Tras reiniciar, los ids vuelven a empezar: t1 es un turno NUEVO.
        act(() => result.current.onTurnCommitted('t1'));
        act(() => result.current.onTurnCommitted('t2'));

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(generateParticipantEvaluationMock).toHaveBeenCalledTimes(1);
    });

    it('GUARD: un solo dueño del aviso (el hook); el reportante pasivo de App se retiró', () => {
        const hookSrc = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8');
        const appSrc = readFileSync('src/App.tsx', 'utf8');
        // Corte 2026-10-30 (problema 6, ruta doble): la fila la commitea el MÓDULO en
        // AMBOS modos y el aviso de turno tiene UN dueño — el hook, sobre
        // `row.committed`. El reportante pasivo de App se retiró con el escritor.
        expect(hookSrc).toContain('fluParticipantRef.current?.onTurnCommitted?.(fila?.turnId)');
        const llamadas = (src: string) => (src.match(/\.onTurnCommitted\?\.\(/g) || []).length;
        expect(llamadas(hookSrc), 'el aviso vive SOLO en el hook').toBe(1);
        expect(llamadas(appSrc), 'App ya no reporta turnos: ruta única').toBe(0);
    });
});


describe('PRUEBA DE DETECTOR (el detector no es decorativo): el hook CONSUME el predicado, no lee la clave', () => {
    it('una sola lectura de evaluateOnTurnCommit (la del dueno)', () => {
        const src = readFileSync('src/hooks/useFluParticipant.ts', 'utf8');
        expect(src).toContain('evaluatesOnTurnCommit(cfg)');
        expect(src, 'el hook no puede re-leer la clave').not.toContain('cfg.evaluateOnTurnCommit === false');
    });
});