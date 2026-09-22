// ============================================================
// useFluParticipant.ts — OS3 React Hook for FLU Participation
// ============================================================
// Port of OS2's useFluParticipant.js to TypeScript.
// Manages the participant lifecycle: idle → evaluating → raised → cooldown.
// Integrates with Gemini for evaluation and manages hand-raise timeouts.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { aiService } from '../services/aiServiceFactory';
import { hasUsableTextBackend } from '../services/deepseek';
import { isSpeechBusy } from '../voice/lib/fluSpeech';
import { logCaughtError } from '../lib/caughtError';
import {
    applyParticipantEvaluation,
    advanceParticipantTurnCounter,
    buildParticipantLogWindow,
    canScheduleParticipantEvaluation,
    consumeRaisedDraft,
    createFluParticipantState,
    dismissRaisedHand,
    formatParticipantLogForPrompt,
    normalizeParticipantEvaluation,
    recordParticipantIntervention,
    resolveParticipantUiPresentation,
    shouldAutoDismissRaisedHand,
    shouldEvaluateParticipantOnTurn,
    canGrantParticipantFloor,
    shouldIgnoreParticipantFloorGrant,
    DEFAULT_PARTICIPANT_CONFIG,
    type ParticipantConfig,
    type ParticipantState,
    type ParticipantUiPresentation,
} from '../lib/fluParticipant';

export interface UseFluParticipantOptions {
    apiKey?: string;
    language?: string;
    conversationActiveRef?: React.RefObject<boolean>;
    session?: { role?: string; theme?: string };
    getLogSnapshot?: () => { texts: string[]; speakers: string[] };
    config?: Partial<ParticipantConfig>;
    /**
     * Callback for avatar emotional reactions to participant events.
     * event: 'granted' | 'ignored' | 'rejected' | 'raised' | 'dismissed'
     * Used by useAvatarVoiceSync.triggerParticipantEmotion
     */
    onEmotion?: (event: 'granted' | 'ignored' | 'rejected' | 'raised' | 'dismissed') => void;
}

export interface UseFluParticipantReturn {
    presentation: ParticipantUiPresentation;
    evaluateOnDemand: () => Promise<boolean>;
    onTurnCommitted: () => void;
    resetParticipant: () => void;
    dismissRaisedHand: () => void;
    consumeRaisedDraft: () => string;
    recordInterventionDelivered: () => void;
    hasRaisedHand: () => boolean;
    canAcceptFloorGrant: () => boolean;
    shouldIgnoreDuplicateFloorGrant: () => boolean;
    beginFloorDelivery: () => void;
    endFloorDelivery: () => void;
}

export function useFluParticipant({
    apiKey = '',
    language = 'es',
    conversationActiveRef,
    session = {},
    getLogSnapshot,
    config: configOverrides,
    onEmotion,
}: UseFluParticipantOptions = {}): UseFluParticipantReturn {
    const stateRef = useRef<ParticipantState>(createFluParticipantState());
    const handTimerRef = useRef<number | null>(null);
    const evalGenerationRef = useRef(0);
    const lastFloorGrantAtRef = useRef(0);
    const deliveringSpeechRef = useRef(false);

    /**
     * Contador monotónico de turnos comprometidos (incrementa en onTurnCommitted).
     * Es independiente del store (integrationStore.conversationHistory): el pipeline
     * de voz (conversationStreamCommit) REEMPLAZA la última fila ante revisiones ASR
     * o se salta la escritura cuando refreshNeeded=false, por lo que el conteo de filas
     * diverge del número real de turnos. Como canScheduleParticipantEvaluation exige
     * turnCount>=evaluateEveryNTurns, contar el store hacía que en el 3er commit hubiera
     * <3 filas y FLU nunca evaluara (regresión vs OS3, donde cada turno agregaba una fila).
     */
    const committedTurnsRef = useRef(0);

    // Merge config with overrides
    const cfgRef = useRef<ParticipantConfig>({
        ...DEFAULT_PARTICIPANT_CONFIG,
        ...configOverrides,
    });

    // Sincroniza cfgRef cuando la configuración cambia (panel de ajustes → localStorage).
    // Sin este efecto, los cambios del usuario no llegarían al hook (cfgRef es un useRef
    // inicializado una sola vez) y FLU usaría siempre DEFAULT_PARTICIPANT_CONFIG.
    useEffect(() => {
        cfgRef.current = { ...DEFAULT_PARTICIPANT_CONFIG, ...configOverrides };
    }, [configOverrides]);

    const [uiTick, setUiTick] = useState(0);

    const bumpUi = useCallback(() => {
        setUiTick((value) => value + 1);
    }, []);

    // -----------------------------------------------------------
    // Hand-raise timeout management
    // -----------------------------------------------------------
    const clearHandTimer = useCallback(() => {
        if (handTimerRef.current !== null) {
            window.clearTimeout(handTimerRef.current);
            handTimerRef.current = null;
        }
    }, []);

    const scheduleHandTimeout = useCallback(() => {
        clearHandTimer();
        const timeout = Number(cfgRef.current.handRaisedTimeoutMs);
        if (!timeout) return;

        handTimerRef.current = window.setTimeout(() => {
            handTimerRef.current = null;
            if (shouldAutoDismissRaisedHand(stateRef.current, cfgRef.current)) {
                stateRef.current = dismissRaisedHand(stateRef.current);
                bumpUi();
                // Notificar al avatar que el participante fue ignorado (timeout).
                // FIX 2026-08-12: CADA bajada por timeout dispara onEmotion('ignored')
                // → enojado (definición: "si no le hicieron caso al bajarla se debe
                // enojar"). El antiguo gate ignoredFiredRef dejaba silenciosas las
                // bajadas siguientes (el flag nunca se reseteaba en escucha pasiva)
                // → la mano quedaba congelada ARRIBA sin enojarse. El log de
                // conversación ([FLU recuerda]) ya está deduplicado a nivel App.
                onEmotion?.('ignored');
            }
        }, timeout);
    }, [bumpUi, clearHandTimer, onEmotion]);

    // -----------------------------------------------------------
    // Run evaluation (Gemini call)
    // -----------------------------------------------------------
    const runEvaluation = useCallback(async ({ force = false } = {}): Promise<boolean> => {
        const cfg = cfgRef.current;
        const snapshot = typeof getLogSnapshot === 'function' ? getLogSnapshot() : { texts: [], speakers: [] };
        const texts = Array.isArray(snapshot.texts) ? snapshot.texts : [];
        const speakers = Array.isArray(snapshot.speakers) ? snapshot.speakers : [];
        const storeRows = texts.filter((text) => String(text || '').trim()).length;
        // El conteo de filas del store diverge del contador de commits (las revisiones
        // ASR reemplazan la última fila y algunos turnos no escriben fila). Se usa el
        // máximo entre el contador real de commits y las filas del historial para que la
        // puerta turnCount>=evaluateEveryNTurns no bloquee la evaluación en el 3er turno,
        // preservando el caso de historial precargado (OS3 parity).
        const turnCount = Math.max(committedTurnsRef.current, storeRows);

        if (
            !canScheduleParticipantEvaluation(stateRef.current, cfg, {
                conversationActive: Boolean(conversationActiveRef?.current),
                turnCount,
                force,
                // Sin backend de texto (ni clave ni endpoint local) la llamada a
                // generateParticipantEvaluation lanzaría "API key de texto no
                // configurada"; se bloquea ANTES de disparar la petición inútil.
                textBackendUsable: hasUsableTextBackend(),
            })
        ) {
            if (import.meta.env.DEV) {
                console.warn(
                    `[Flu][participant] runEvaluation: BLOQUEADO por canScheduleParticipantEvaluation ` +
                    `(conversationActive=${Boolean(conversationActiveRef?.current)}, turnCount=${turnCount}, ` +
                    `phase=${stateRef.current.phase}, enabled=${cfg.enabled}, conversationOnly=${cfg.conversationOnly}, ` +
                    `apiKey=${apiKey ? 'set' : 'VACÍA'}, force=${force})`,
                );
            }
            return false;
        }

        const rows = buildParticipantLogWindow(texts, speakers, {
            maxTurns: cfg.evaluationWindowTurns,
        });

        if (!rows.length) {
            return false;
        }

        evalGenerationRef.current += 1;
        const generation = evalGenerationRef.current;
        stateRef.current = { ...stateRef.current, phase: 'evaluating' };
        bumpUi();

        const conversationLog = formatParticipantLogForPrompt(rows, language);

        try {
            const result = await aiService.generateParticipantEvaluation(
                {
                    apiKey,
                    language,
                    role: session.role || '',
                    theme: session.theme || '',
                },
                conversationLog,
                cfg.maxDraftChars,
            );

            if (generation !== evalGenerationRef.current) return false;

            const normalized = normalizeParticipantEvaluation(result, cfg);
            stateRef.current = applyParticipantEvaluation(stateRef.current, normalized);

            if (stateRef.current.phase === 'raised') {
                scheduleHandTimeout();
                // Notificar al avatar que el participante levantó la mano
                onEmotion?.('raised');
            }

            return stateRef.current.phase === 'raised';
        } catch (error) {
            if (generation !== evalGenerationRef.current) return false;
            stateRef.current = { ...stateRef.current, phase: 'idle' };
            if (import.meta.env.DEV) {
                logCaughtError('[Flu][participant] evaluation failed', error);
            }
        } finally {
            bumpUi();
        }

        return false;
    }, [apiKey, bumpUi, conversationActiveRef, getLogSnapshot, language, scheduleHandTimeout, session.role, session.theme]);

    // -----------------------------------------------------------
    // Evaluate on demand (manual "Flu Participa" click)
    // -----------------------------------------------------------
    const evaluateOnDemand = useCallback(async (): Promise<boolean> => {
        const cfg = cfgRef.current;
        if (cfg.evaluateOnManualGrant === false) return false;
        if (canGrantParticipantFloor(stateRef.current, cfg)) return true;
        return runEvaluation({ force: true });
    }, [runEvaluation]);

    // -----------------------------------------------------------
    // On turn committed (called after each conversation turn)
    // -----------------------------------------------------------
    const onTurnCommitted = useCallback(() => {
        const cfg = cfgRef.current;
        if (!cfg.enabled || cfg.evaluateOnTurnCommit === false) {
            if (import.meta.env.DEV) {
                console.warn(`[Flu][participant] onTurnCommitted: BAIL (enabled=${cfg.enabled}, evaluateOnTurnCommit=${cfg.evaluateOnTurnCommit})`);
            }
            return;
        }
        // conversationOnly=true exige sesión «Iniciar conversación» activa; con
        // conversationOnly=false FLU evalúa también en escucha pasiva (OS3 parity).
        // Antes este gate era incondicional y anulaba la config conversationOnly.
        const conversationActive = Boolean(conversationActiveRef?.current);
        if (!conversationActive && cfg.conversationOnly !== false) {
            if (import.meta.env.DEV) {
                console.warn('[Flu][participant] onTurnCommitted: BAIL (conversationActive=false y conversationOnly=true)');
            }
            return;
        }

        // Cada turno comprometido cuenta como turno de conversación real,
        // independientemente de si se escribió/actualizó una fila en el store.
        committedTurnsRef.current += 1;

        if (!shouldEvaluateParticipantOnTurn(stateRef.current, cfg)) {
            stateRef.current = advanceParticipantTurnCounter(stateRef.current, cfg);
            return;
        }

        stateRef.current = advanceParticipantTurnCounter(stateRef.current, cfg);
        void runEvaluation();
    }, [conversationActiveRef, runEvaluation]);

    // -----------------------------------------------------------
    // Reset participant state
    // -----------------------------------------------------------
    const resetParticipant = useCallback(() => {
        clearHandTimer();
        evalGenerationRef.current += 1;
        stateRef.current = createFluParticipantState();
        lastFloorGrantAtRef.current = 0;
        deliveringSpeechRef.current = false;
        bumpUi();
        // FIX 2026-08-12 (mano congelada): resetParticipant (INICIAR_CONVERSACION,
        // reset del sistema) no disparaba emoción → si la mano estaba arriba
        // (expresión sticky 'raised') quedaba congelada. Notificar 'dismissed'
        // para bajar la mano SIN enojarse (no es "le hicieron caso").
        onEmotion?.('dismissed');
    }, [bumpUi, clearHandTimer, onEmotion]);

    // -----------------------------------------------------------
    // Dismiss raised hand (public)
    // -----------------------------------------------------------
    const dismissRaisedHandPublic = useCallback(() => {
        clearHandTimer();
        stateRef.current = dismissRaisedHand(stateRef.current);
        bumpUi();
        // FIX 2026-08-12 (mano congelada): el dismiss manual ("flu espera") no
        // disparaba emoción → la expresión sticky 'raised' quedaba ARRIBA para
        // siempre. Notificar 'dismissed' para bajar la mano SIN enojarse.
        onEmotion?.('dismissed');
    }, [bumpUi, clearHandTimer, onEmotion]);

    // -----------------------------------------------------------
    // Consume raised draft (public)
    // -----------------------------------------------------------
    const consumeRaisedDraftPublic = useCallback((): string => {
        clearHandTimer();
        const { state, draft } = consumeRaisedDraft(stateRef.current, cfgRef.current);
        stateRef.current = state;
        bumpUi();
        // Notificar al avatar que se le concedió la palabra al participante.
        // 'granted' → intervencion (NO enojado): "si le dice ok flu adelante o
        // habla, entonces no se debe enojar".
        if (draft) {
            onEmotion?.('granted');
        }
        return draft;
    }, [bumpUi, clearHandTimer, onEmotion]);

    // -----------------------------------------------------------
    // Record intervention delivered
    // -----------------------------------------------------------
    const recordInterventionDelivered = useCallback(() => {
        stateRef.current = recordParticipantIntervention(stateRef.current);
        bumpUi();
    }, [bumpUi]);

    // -----------------------------------------------------------
    // Floor grant helpers
    // -----------------------------------------------------------
    const canAcceptFloorGrant = useCallback((): boolean => {
        return canGrantParticipantFloor(stateRef.current, cfgRef.current);
    }, []);

    const shouldIgnoreDuplicateFloorGrant = useCallback((): boolean => {
        // Considera `pending` además de `speaking`: speakResponse (fluSpeech.js) ignora
        // silenciosamente la petición si synth.speaking || synth.pending. Si el guard
        // solo mirara `speaking`, el click/la orden cederían la palabra y el borrador se
        // consumiría SIN hablarse (intervención tragada). Bloquear la concesión mientras
        // pending evita ese hueco: el usuario reintenta cuando el TTS esté libre.
        const speechActive = isSpeechBusy();
        return shouldIgnoreParticipantFloorGrant(stateRef.current, {
            speechActive,
            lastGrantAt: lastFloorGrantAtRef.current,
            delivering: deliveringSpeechRef.current,
            cfg: cfgRef.current,
        });
    }, []);

    const beginFloorDelivery = useCallback(() => {
        deliveringSpeechRef.current = true;
        lastFloorGrantAtRef.current = Date.now();
    }, []);

    const endFloorDelivery = useCallback(() => {
        deliveringSpeechRef.current = false;
    }, []);

    // -----------------------------------------------------------
    // Cleanup on unmount
    // -----------------------------------------------------------
    useEffect(() => {
        return () => {
            clearHandTimer();
        };
    }, [clearHandTimer]);

    // -----------------------------------------------------------
    // Compute presentation (re-computes on uiTick changes)
    // -----------------------------------------------------------
    void uiTick; // used to trigger re-render

    const presentation = resolveParticipantUiPresentation(
        stateRef.current,
        language,
        cfgRef.current,
    );

    return {
        presentation,
        evaluateOnDemand,
        onTurnCommitted,
        resetParticipant,
        dismissRaisedHand: dismissRaisedHandPublic,
        consumeRaisedDraft: consumeRaisedDraftPublic,
        recordInterventionDelivered,
        hasRaisedHand: () => stateRef.current.phase === 'raised',
        canAcceptFloorGrant,
        shouldIgnoreDuplicateFloorGrant,
        beginFloorDelivery,
        endFloorDelivery,
    };
}
