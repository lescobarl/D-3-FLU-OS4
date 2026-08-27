// ============================================================
// VALIDACIÓN REAL del fix conversationOnly (participación en escucha pasiva)
// ============================================================
// Responde a: "quiero que valides 100% que tus soluciones funcionan completas!"
//
// Esto NO es un test con mocks del modelo: usa el hook de PRODUCCIÓN
// (src/hooks/useFluParticipant.ts), la config REAL (getFluParticipantConfig),
// la API key REAL del .env y RED REAL (fetch directo a OpenRouter → Gemini).
//
// Reproduce EXACTAMENTE el escenario del usuario:
//   - conversationActiveRef.current = false  (escucha pasiva, sin «Iniciar conversación»)
//   - turnos de audio ambiente ("Hablante 1")
//   - 3 commits → onTurnCommitted → debe disparar la evaluación REAL
//
// Dos pruebas:
//   A) CONTROL: conversationOnly=true + pasivo → NO debe disparar evaluación
//      (prueba que el toggle sigue bloqueando cuando corresponde).
//   B) EL FIX: conversationOnly=false (default real) + pasivo → debe disparar
//      UNA evaluación REAL a OpenRouter con la llave real y HTTP 200.
//      Si el modelo decide intervenir (y pasa umbrales), la mano queda alzada.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { RefObject } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { useFluParticipant } from '../src/hooks/useFluParticipant';
import type { ParticipantConfig } from '../src/lib/fluParticipant';
import {
    getFluParticipantConfig,
    FLU_PARTICIPANT_STORAGE_KEY,
} from '../src/voice/lib/fluParticipantConfig';

// ── API key REAL desde .env (nunca se hardcodea) ────────────────────────────────
const envRaw = readFileSync(join(process.cwd(), '.env'), 'utf8');
const keyMatch = envRaw.match(/^VITE_OPENROUTER_API_KEY=(.+)$/m);
const REAL_KEY = keyMatch ? keyMatch[1].trim() : '';
if (!REAL_KEY) {
    throw new Error('VITE_OPENROUTER_API_KEY no encontrada en .env — la validación REAL requiere la clave.');
}
const KEY_MASK = `${REAL_KEY.slice(0, 8)}…${REAL_KEY.slice(-4)}`;

// Stub SpeechSynthesis (el hook lee window.speechSynthesis?.speaking en floor grants)
Object.defineProperty(window, 'speechSynthesis', {
    value: { speaking: false, pending: false, getVoices: () => [] },
    writable: true,
    configurable: true,
});

interface RealEvalCall {
    url: string;
    apiKey: string;
    ok: boolean;
    status: number;
    elapsedMs: number;
    isParticipantEval: boolean;
    intervenir?: boolean;
    motivo_corto?: string;
    borrador?: string;
    confianza?: number;
}

describe('useFluParticipant — VALIDACIÓN REAL del fix conversationOnly (escucha pasiva)', () => {
    const realCalls: RealEvalCall[] = [];
    const origFetch = globalThis.fetch;

    beforeEach(() => {
        // Config limpia → defaults REALES de fluConfig.fluParticipant (conversationOnly: false)
        localStorage.removeItem(FLU_PARTICIPANT_STORAGE_KEY);
        localStorage.removeItem('flu-participant-enabled');
        localStorage.removeItem('flu-text-api-key');
        localStorage.removeItem('flu-text-api-url');
        localStorage.removeItem('flu-ai-provider');
        realCalls.length = 0;

        // Wrap de fetch: registra las llamadas REALES a OpenRouter y pasa a la red real.
        const wrapper = async (input: any, init?: any): Promise<Response> => {
            const url = String(typeof input === 'string' ? input : input?.url || '');
            const isChat = url.includes('/chat/completions');
            const isEvalUrl = url.includes('/api/gemini/participant-eval');
            const post = init?.body ? JSON.parse(String(init.body)) : null;
            const sysText = Array.isArray(post?.messages)
                ? post.messages.map((m: any) => String(m?.content || '')).join(' ')
                : '';
            const isEval = isEvalUrl || /debe intervenir|should FLU intervene/i.test(sysText);
            const auth = String(
                (init?.headers as any)?.Authorization ||
                (init?.headers as any)?.authorization ||
                '',
            );
            const apiKey = auth.replace(/^Bearer\s+/i, '').trim() || String(post?.apiKey || '');

            const started = Date.now();
            // fetchTextEngine inyecta un AbortSignal (timeout) creado en el realm de
            // jsdom/vitest; undici real lo rechaza ("Expected signal to be an instance
            // of AbortSignal"). Este test valida el round-trip REAL a OpenRouter, no el
            // timeout, así que se omite la señal al delegar a la red real.
            const { signal: _signal, ...initWithoutSignal } = (init as any) || {};
            const res = await origFetch(input as any, initWithoutSignal as any);
            const elapsedMs = Date.now() - started;

            if (isChat || isEvalUrl) {
                const record: RealEvalCall = { url, apiKey, ok: res.ok, status: res.status, elapsedMs, isParticipantEval: isEval };
                if (isEval) {
                    try {
                        const body: any = await res.clone().json();
                        const content = body?.choices?.[0]?.message?.content;
                        if (typeof content === 'string' && content.trim()) {
                            try {
                                const parsed = JSON.parse(content);
                                if (parsed && typeof parsed === 'object' && 'intervenir' in parsed) {
                                    record.intervenir = Boolean(parsed.intervenir);
                                    record.motivo_corto = String(parsed.motivo_corto || '');
                                    record.borrador = String(parsed.borrador_aportacion || '');
                                    record.confianza = Number(parsed.confianza ?? 0);
                                }
                            } catch {
                                /* ignore */
                            }
                        }
                    } catch {
                        /* ignore */
                    }
                }
                realCalls.push(record);
            }
            return res;
        };

        (globalThis as any).fetch = wrapper;
        (window as any).fetch = wrapper;
    });

    afterEach(() => {
        (globalThis as any).fetch = origFetch;
        (window as any).fetch = origFetch;
    });

    const passiveTurns = () => ({
        texts: [
            'buenos dias maestra hoy voy a exponer sobre la revolucion mexicana',
            'emiliano zapata lidero el ejercito libertador del sur en morelos',
            'no estoy muy seguro pero creo que la revolucion empezo en mil novecientos ocho',
        ],
        speakers: ['Hablante 1', 'Hablante 1', 'Hablante 1'],
    });

    it('A) CONTROL: conversationOnly=true + pasivo → NO dispara evaluación (toggle sigue bloqueando)', async () => {
        const conversationActiveRef: RefObject<boolean> = { current: false };
        const { result } = renderHook(() =>
            useFluParticipant({
                apiKey: REAL_KEY,
                language: 'es',
                conversationActiveRef,
                session: { role: 'Profesora de historia de Mexico' },
                getLogSnapshot: passiveTurns,
                config: { ...getFluParticipantConfig(), conversationOnly: true },
            }),
        );

        act(() => result.current.onTurnCommitted()); // turno 1
        act(() => result.current.onTurnCommitted()); // turno 2
        act(() => result.current.onTurnCommitted()); // turno 3

        // Espera suficiente: si hubiera evaluación real ya habría disparado el fetch.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 2500));
        });

        expect(realCalls.filter((c) => c.isParticipantEval).length).toBe(0);
        expect(result.current.hasRaisedHand()).toBe(false);
    });

    it('B) EL FIX: conversationOnly=false + pasivo → evaluación REAL a OpenRouter (llave real)', async () => {
        const conversationActiveRef: RefObject<boolean> = { current: false }; // escenario del usuario
        const cfg = getFluParticipantConfig() as Partial<ParticipantConfig>;

        // Sanidad: el default REAL ahora es conversación pasiva habilitada
        expect(cfg.conversationOnly).toBe(false);
        expect(cfg.enabled).toBe(true);
        expect(cfg.evaluateOnTurnCommit).toBe(true);

        const { result } = renderHook(() =>
            useFluParticipant({
                apiKey: REAL_KEY,
                language: 'es',
                conversationActiveRef,
                session: { role: 'Profesora de historia de Mexico' },
                getLogSnapshot: passiveTurns,
                config: cfg,
            }),
        );

        act(() => result.current.onTurnCommitted()); // turno 1
        act(() => result.current.onTurnCommitted()); // turno 2
        act(() => result.current.onTurnCommitted()); // turno 3 → DEBE evaluar en modo pasivo

        // Esperar la evaluación REAL (fetch a OpenRouter con red real)
        let evalCall: RealEvalCall | undefined;
        await act(async () => {
            await vi.waitFor(
                () => {
                    evalCall = realCalls.find((c) => c.isParticipantEval);
                    expect(evalCall).toBeDefined();
                },
                { timeout: 90_000, interval: 1_000 },
            );
            // Dar tiempo a que runEvaluation aplique el estado tras resolver el fetch
            await new Promise((resolve) => setTimeout(resolve, 800));
        });

        if (!evalCall) throw new Error('No se registró la evaluación real');

        console.info(
            `[REAL-EVAL] modo pasivo → OpenRouter ${evalCall.status} en ${evalCall.elapsedMs}ms | ` +
            `key=${KEY_MASK} | intervenir=${String(evalCall.intervenir)} | confianza=${evalCall.confianza} | ` +
            `motivo="${evalCall.motivo_corto || ''}" | borrador="${(evalCall.borrador || '').slice(0, 60)}"`,
        );

        expect(evalCall.ok).toBe(true);
        expect(evalCall.status).toBe(200);
        expect(evalCall.apiKey).toBe(REAL_KEY);
        expect(evalCall.url).toContain('openrouter.ai');

        // Si el modelo interviene y pasa umbrales → mano alzada; si no, vuelve a idle.
        const shouldRaise =
            Boolean(evalCall.intervenir) &&
            (evalCall.confianza ?? 0) >= Number(cfg.minConfidence) &&
            (evalCall.borrador?.length ?? 0) >= Number(cfg.minDraftChars) &&
            (evalCall.motivo_corto?.length ?? 0) >= Number(cfg.minReasonChars);

        if (shouldRaise) {
            expect(result.current.hasRaisedHand()).toBe(true);
        } else {
            expect(result.current.hasRaisedHand()).toBe(false);
        }
    });
});
