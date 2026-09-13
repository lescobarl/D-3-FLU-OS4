// ============================================================
// useAvatarVoiceSync — Hook de Sincronización Avatar ↔ Voz
// ============================================================
// Este hook es el CORAZÓN de la integración OS3.
// Escucha el estado de los servicios de voz (OS2) y
// actualiza automáticamente el estado del avatar (OS1).
//
// Flujo completo (full-duplex):
//   1. IDLE → LISTENING: Usuario activa micrófono
//   2. LISTENING → THINKING: Usuario deja de hablar, FLU procesa
//   3. THINKING → SPEAKING: FLU responde con TTS
//   4. SPEAKING → IDLE/LISTENING: FLU termina de hablar, auto-ciclo
//
// Reactividad emocional + gestual:
//   - El avatar cambia su expresión Y reproduce animaciones corporales
//     según el sentimiento detectado en el mensaje del usuario
//   - Mapeo DATA-driven desde el EmotionEngine + expressionRegistry
//   - Personalidad influye en la selección de expresiones (affinity scoring)
//   - Micro-expresiones para comportamiento idle (dar vida)
//
// NOTA: El ciclo de vida SPEAKING (incluyendo monitoreo de fin de habla)
// es manejado por FluAvatarVoiceBridge.tsx a través de onContractResolved,
// que hace await speakResponse() directamente.
// Este hook SOLO sincroniza el estado del avatar (expresión + animación).
// ============================================================

import { useEffect, useRef, useCallback } from 'react';
import { useBunnyStore, EXPRESSION_MAP } from '../avatar';
import type { BunnyStore, BunnyAnimation, BunnyComponent, AvatarExpression } from '../avatar';
import { useIntegrationStore } from '../store/integrationStore';
import { relayLog } from '../lib/clientLogRelay';
import { isMusicPlaying } from '../services/musicPlayer';
import type { ConversationState, EmotionalState } from '../types/bridge';
import {
    getGroupExpressions,
    getTriggerExpressions,
    ACTION_ANIMS,
} from '../core/anim/expressionRegistry';
import {
    resolveStateExpression,
    resolveEmotionExpression,
    resolveTriggerExpression,
    resolveIdleMicroExpression,
    resolveContextualExpression,
    type ResolvedExpression,
} from '../core/anim/emotionEngine';

/**
 * DATA-DRIVEN: Alternativas para LISTENING desde el expressionRegistry.
 * Se turnan en cada transición a LISTENING.
 */
const LISTENING_ALTERNATIVES: { expression: AvatarExpression; anims: BunnyAnimation[] }[] =
    getGroupExpressions('listening').map((def) => ({
        expression: def.expression as AvatarExpression,
        anims: def.anims as BunnyAnimation[],
    }));

/**
 * DATA-DRIVEN: Alternativas para SPEAKING desde el expressionRegistry.
 * Se turnan en cada transición a SPEAKING.
 */
const SPEAKING_ALTERNATIVES: { expression: AvatarExpression; anims: BunnyAnimation[] }[] =
    getGroupExpressions('speaking').map((def) => ({
        expression: def.expression as AvatarExpression,
        anims: def.anims as BunnyAnimation[],
    }));

/**
 * DATA-DRIVEN: Alternativas para PARTICIPANT (queriendo participar) desde el expressionRegistry.
 * Se turnan mientras el participante tiene la mano levantada.
 */
const PARTICIPANT_ALTERNATIVES: { expression: AvatarExpression; anims: BunnyAnimation[] }[] =
    getGroupExpressions('participant').map((def) => ({
        expression: def.expression as AvatarExpression,
        anims: def.anims as BunnyAnimation[],
    }));

/**
 * Duración de la acción de cuerpo completo ordenada por el USUARIO
 * (baila/corre/canta → Dance/Run/etc.).
 * Hoy la animación del comando moría a los ~2s porque SPEAKING→LISTENING la
 * reemplazaba por la expresión de escucha. Esta ventana mantiene la acción viva
 * 8s incluso tras pasar a LISTENING.
 * NOTA: NO afecta al reset de 7s de la emoción del retorno de la IA — ese sigue
 * igual (solo aplica a emociones de POSE estática mientras SPEAKING dura).
 */
const SUSTAINED_ACTION_MS = 8000;
/** Tope de seguridad del sostenimiento tipo 'song' (Regla 3): nunca más de 15 min. */
const SONG_SUSTAIN_MAX_MS = 15 * 60 * 1000;
/**
 * Ventana de arranque del modo 'song': playSong() es async (App.tsx:773) y tarda
 * unos segundos en arrancar la música (sonda catálogo / búsqueda Deezer online).
 * Durante este lapso el poller NO cancela aunque isMusicPlaying() aún sea false,
 * para que el baile no muera (bug real "canta 8s → idle") antes de que suene la
 * canción. Después de la ventana, si la música no arrancó, se cancela (canción
 * not_found / fallo de arranque).
 */
const SONG_START_GRACE_MS = 15 * 1000;

/**
 * Hook que sincroniza el avatar 3D con el estado de la voz.
 * Debe usarse en el componente FluAvatarVoiceBridge.
 */
export function useAvatarVoiceSync() {
    // ---- Stable selectors: subscribe to individual store slices instead of the full store ----
    // This prevents effects from re-running when unrelated store properties change.
    const conversationState = useIntegrationStore((s) => s.conversationState);
    const imageConfig = useIntegrationStore((s) => s.imageConfig);
    const animationSpeed = useIntegrationStore((s) => s.advancedConfig?.animationSpeed ?? 1.0);
    const debugMode = useIntegrationStore((s) => s.config.debug);
    // Store actions (stable references, don't change between renders)
    const setFluSpeaking = useIntegrationStore((s) => s.setFluSpeaking);
    const setMicActive = useIntegrationStore((s) => s.setMicActive);
    const pushBridgeEvent = useIntegrationStore((s) => s.pushBridgeEvent);
    const pendingEmotionAnims = useIntegrationStore((s) => s.uiState.pendingEmotionAnims);
    const pendingEmotionSource = useIntegrationStore((s) => s.uiState.pendingEmotionSource);
    const pendingEmotionSustainMode = useIntegrationStore((s) => s.uiState.pendingEmotionSustainMode);
    const setPendingEmotionAnimsAction = useIntegrationStore((s) => s.setPendingEmotionAnims);
    /**
     * Ref para recibir animaciones de emoción vía callback directo (Fase 7).
     * Reemplaza el mecanismo anterior basado en integrationStore.uiState.pendingEmotionAnims.
     * App.tsx escribe aquí ANTES de setConversationState('SPEAKING').
     * El efecto de SPEAKING lee y consume este ref.
     */
    const pendingEmotionAnimsRef = useRef<string[]>([]);
    // Engine options (stable selectors)
    const personality = useIntegrationStore((s) => s.config.personality);
    const emotionalReactivity = useIntegrationStore((s) => s.advancedConfig?.emotionalReactivity ?? 1.0);

    const prevStateRef = useRef<ConversationState>('IDLE');
    const autoCycleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Contador para alternar entre alternativas de LISTENING en cada transición */
    const listeningToggleRef = useRef<number>(0);
    /** Contador para alternar entre alternativas de SPEAKING en cada transición */
    const speakingToggleRef = useRef<number>(0);
    /** Contador para alternar entre alternativas de PARTICIPANT en cada transición */
    const participantToggleRef = useRef<number>(0);
    /** Timer para micro-expresiones idle */
    const idleMicroTimerRef = useRef<number | null>(null);
    /** Expresión a restaurar cuando termine el reset de 7s (estado previo a la emoción de la IA) */
    const emotionRestoreRef = useRef<AvatarExpression>('hablando');
    /** Handle del timer del reset de 7s — permite cancelarlo (era no-cancelable: defecto) */
    const emotionResetTimerRef = useRef<number | null>(null);
    /**
     * Acción de cuerpo completo ordenada por el USUARIO que se mantiene viva 8s
     * incluso después de SPEAKING→LISTENING (antes moría a los ~2s).
     * null = no hay acción sostenida activa.
     */
    const sustainedActionRef = useRef<{ anims: BunnyAnimation[]; until: number; sustainUntilSong?: boolean } | null>(null);
    /** Handle del timer que expira la acción sostenida a los 8s */
    const sustainedActionTimerRef = useRef<number | null>(null);

    /**
     * Cancela el timer de reset de 7s pendiente (si existe).
     * Se llama en CADA cambio de estado, en cada nueva expresión aplicada y al
     * desmontar: garantiza que el reset SOLO ocurra en el retorno de la IA y
     * nunca durante un flujo posterior (p.ej. participante hablando con Walk).
     */
    const clearEmotionReset = useCallback(() => {
        if (emotionResetTimerRef.current !== null) {
            window.clearTimeout(emotionResetTimerRef.current);
            emotionResetTimerRef.current = null;
        }
    }, []);

    // CRITICAL: Use getState() + ref to access bunnyStore actions WITHOUT subscribing
    // to bunnyStore state changes. Using useBunnyStore() directly as a hook causes
    // the returned `store` object to get a new reference on every bunnyStore update.
    // If `store` is a useEffect dependency, calling store.setComponentVisibility()
    // updates the bunnyStore → new `store` reference → effect re-runs → infinite loop.
    const bunnyActionsRef = useRef(useBunnyStore.getState() as BunnyStore);

    /**
     * Apply a resolved expression to the avatar store.
     * Shared helper used by all sync functions.
     */
    const applyResolved = useCallback((resolved: ResolvedExpression) => {
        const store = bunnyActionsRef.current;
        // Cualquier expresión nueva reemplaza el reset de 7s pendiente: no debe
        // dispararse más tarde en un flujo que ya cambió (participante, etc.).
        clearEmotionReset();
        if (resolved.expression) {
            store.setExpression(resolved.expression);
        } else {
            store.clearExpression();
        }
        if (resolved.anims.length > 0) {
            store.blendAnimation(resolved.anims);
        }
    }, [clearEmotionReset]);

    /**
     * Reset de emoción a los 7s SOLO para la emoción que vino del RETORNO DE LA IA
     * (App.tsx escribe con source='ai'). Restaura el estado que había ANTES de la
     * emoción (emotionRestoreRef), NO un hardcode hablando2 — eso era lo que hacía
     * que se viera "robotizado" y causaba la intermitencia "camina/deja de caminar"
     * con el enojado del participante.
     * Las emociones del participante (enojado por mano ignorada) NO tienen límite
     * de 7s: persisten hasta que cambie el flujo.
     */
    const scheduleEmotionReset = useCallback(() => {
        // FIX 2026-08-13 (Punto 3b: Walk se detiene recurrente): el timer era
        // no-cancelable y un reset STALE del retorno de la IA podía dispararse
        // durante un SPEAKING posterior del participante, pisando el enojado/Walk.
        // Ahora: se cancela el pendiente antes de programar el nuevo y se guarda
        // el handle para poder cancelarlo desde clearEmotionReset().
        clearEmotionReset();
        emotionResetTimerRef.current = window.setTimeout(() => {
            // El timer se autolimpia al dispararse.
            emotionResetTimerRef.current = null;
            if (useIntegrationStore.getState().conversationState !== 'SPEAKING') return;
            const bunny = useBunnyStore.getState();
            // Restaurar el estado PREVIO a la emoción (el que tenía antes de que la
            // IA la pisara), no un hardcode hablando2.
            const restoreExpression = emotionRestoreRef.current;
            // 🚀 GUARD: blendAnimation NO actualiza currentExpression (queda stale
            // durante la emoción). Si currentExpression ya coincide con el restore,
            // setExpression() es no-op por su guard y el blendQueue de la emoción
            // quedaría colgado (avatar "atascado" en Dance/Walk). clearExpression()
            // fuerza currentExpression=null para que el restore SIEMPRE se ejecute.
            bunny.clearExpression();
            bunny.setExpression(restoreExpression);
        }, 7000);
    }, [clearEmotionReset]);

    /**
     * Get the current engine options (traits + reactivity) from the store.
     * Uses stable selectors above — only recreates when personality, reactivity, or debug changes.
     */
    const getEngineOptions = useCallback(() => {
        return {
            traits: personality?.traits ?? [],
            reactivity: emotionalReactivity,
            debug: debugMode,
        };
    }, [personality, emotionalReactivity, debugMode]);

    /**
     * Actualiza el avatar según el estado de conversación.
     * DATA-DRIVEN: usa el EmotionEngine en lugar de STATE_TO_AVATAR hardcodeado.
     *
     * CRITICAL: Todos los estados que usan toggle (LISTENING, SPEAKING) y THINKING
     * llaman DIRECTAMENTE a store.setExpression() para EVITAR el reactivity engine
     * (applyReactivityToAnims -> REACTIVITY_RANGES) que FILTRA animaciones cuando
     * effectiveReactivity = reactivity * intensity es bajo.
     *
     * Con emotionalReactivity: 0.5 (default) y hablando intensity: 0.6,
     * effectiveReactivity = 0.3 -> cae en 'very-low' (0-0.3) -> [anims[0]]
     * -> solo Idle_2, SIN MouthMove -> avatar no gesticula.
     *
     * Solución: usar setExpression() directo del store, que va al
     * EXPRESSION_MAP y aplica TODAS las animaciones sin filtrar.
     */
    const syncAvatarToState = useCallback((state: ConversationState, emotionAnims?: BunnyAnimation[]) => {
        const store = bunnyActionsRef.current;
        const options = getEngineOptions();

        const emotionAnimsStr = emotionAnims ? `[${emotionAnims.join(', ')}]` : 'undefined';
        relayLog('LOG', 'AvatarVoiceSync', `syncAvatarToState(state=${state}, emotionAnims=${emotionAnimsStr})`);

        // Use EmotionEngine to resolve state expression (for avatarState only)
        const resolved = resolveStateExpression(state, options);
        store.setState(resolved.avatarState);

        if (state === 'LISTENING') {
            // ACCIÓN SOSTENIDA (2026-08-15): si el usuario ordenó una acción de cuerpo
            // completo (baila/corre/canta → Dance/Run) y sigue dentro de su ventana de
            // 8s, mantenerla en lugar de reemplazarla por la expresión de escucha.
            // Antes esto mataba la animación del comando a los ~2s (SPEAKING→LISTENING).
            const sustained = sustainedActionRef.current;
            if (sustained && (Date.now() < sustained.until || sustained.sustainUntilSong)) {
                store.blendAnimation(sustained.anims);
                const remain = sustained.sustainUntilSong
                    ? '∞ (canción sonando)'
                    : `${Math.round((sustained.until - Date.now()) / 1000)}s`;
                relayLog('LOG', 'AvatarVoiceSync', `LISTENING → sustained action [${sustained.anims.join(', ')}] (+${remain})`);
                return;
            }
            // DATA-DRIVEN: use LISTENING_ALTERNATIVES from expressionRegistry
            const toggleIndex = listeningToggleRef.current % LISTENING_ALTERNATIVES.length;
            listeningToggleRef.current++;
            const alt = LISTENING_ALTERNATIVES[toggleIndex];
            // FIX (2026-08-17): la PRIMERA micro-animación de escucha salía estática
            // porque el toggle 0 es 'atencion' y el avatar YA estaba en 'atencion'
            // (el IDLE resuelve a atencion → Idle_2 y además es el valor inicial del
            // store). El GUARD de setExpression (misma expresión → no-op) anulaba el
            // cambio → cero movimiento visible; la segunda ('atencion2') sí se
            // aplicaba → "la primera estática, la segunda se mueve". Solución
            // data-driven (misma lista LISTENING_ALTERNATIVES, sin hardcode):
            // clearExpression() antes de setExpression para forzar el re-aplicado,
            // igual que el restore de acciones sostenidas (2026-08-16).
            store.clearExpression();
            store.setExpression(alt.expression);
            if (options.debug) {
            }
            return;
        }

        if (state === 'SPEAKING') {
            // EMOTION DURING SPEAKING (OS3 parity): si hay animaciones de emoción
            // pendientes (ya resueltas desde EXPRESSION_MAP por App.tsx), mezclar
            // esas animaciones (Dance, Jump, Cap_front…) JUNTO CON MouthMove para
            // que FLU gesticule MIENTRAS la voz suena en paralelo (~5s aprox.).
            // Usamos SOLO blendAnimation — NUNCA blend + setExpression en el mismo
            // sync: dos actualizaciones síncronas del store disparan el efecto
            // blend de BunnyViewer DOS VECES → ACTIONS huérfanas duplicadas que
            // compiten por los mismos huesos → boca congelada/errática.
            if (emotionAnims && emotionAnims.length > 0) {
                // FIX (2026-08-12): el cuerpo se congelaba ("como palo") porque esta
                // rama mezclaba SOLO las animaciones de emoción + MouthMove, SIN el
                // Idle base de habla. Las emociones (Emo_neutral, Cap_back, Emo_blink…)
                // son clips de POSE estática, así que el cuerpo no tenía movimiento y
                // solo la boca se movía.
                // Ahora SIEMPRE incluimos el Idle base de habla (Idle_2/Idle_3,
                // alternado con el mismo speakingToggleRef) para que el cuerpo tenga
                // movimiento real mientras la voz suena, tal como define el usuario
                // (hablando → Idle_2 + MouthMove; hablando2 → Idle_3 + MouthMove).
                // Se sigue usando SOLO blendAnimation (nunca blend + setExpression en
                // el mismo sync, para no disparar el efecto de BunnyViewer dos veces).
                const toggleIndex = speakingToggleRef.current % SPEAKING_ALTERNATIVES.length;
                speakingToggleRef.current++;
                const alt = SPEAKING_ALTERNATIVES[toggleIndex];
                // Fix (intermitencia "arrastra/camina"): las ACCIONES de cuerpo completo
                // (Walk/Run/Dance…) NO se diluyen con el Idle base de habla — THREE.js
                // promedia poses 50/50 → "shuffle" en vez de caminar limpio. Enojado=Walk
                // se mantiene como acción principal. Las emociones de POSE estática
                // (Emo_neutral, Cap_back…) SÍ usan el Idle base de habla para dar
                // movimiento al cuerpo.
                const hasFullBodyAction = (emotionAnims ?? []).some((a) => ACTION_ANIMS.has(a));
                const blended = hasFullBodyAction
                    ? [...new Set([...emotionAnims, 'MouthMove' as BunnyAnimation])]
                    : [...new Set([alt?.anims?.[0] ?? ('Idle_2' as BunnyAnimation), ...emotionAnims, 'MouthMove' as BunnyAnimation])];
                store.blendAnimation(blended);
                // Guardar el estado previo para que el reset de 7s (solo IA) lo restaure.
                emotionRestoreRef.current = alt?.expression ?? 'hablando';
                relayLog('LOG', 'AvatarVoiceSync', `SPEAKING EMOTION → blendAnimation([${blended.join(', ')}])`);
                if (options.debug) {
                }
                return;
            }

            // DATA-DRIVEN: use SPEAKING_ALTERNATIVES from expressionRegistry
            const toggleIndex = speakingToggleRef.current % SPEAKING_ALTERNATIVES.length;
            speakingToggleRef.current++;
            const alt = SPEAKING_ALTERNATIVES[toggleIndex];

            // NOTA: El parámetro emotionAnims ya no se usa. Anteriormente se usaba
            // para mezclar animaciones de emoción (Dance, Jump) con MouthMove, pero
            // eso causaba DOBLE recarga de BunnyViewer (emotion → speaking) que
            // corrompía Three.js → WebGL context loss → pantalla negra.
            // Ahora vamos directo a SPEAKING con setExpression() que da
            // ['Idle_2', 'MouthMove'] — una sola recarga, boca siempre visible.
            //
            // USAR SOLO setExpression, que YA popula blendQueue con TODAS las
            // animaciones del EXPRESSION_MAP (Idle_2 + MouthMove para 'hablando').
            // NO llamar blendAnimation ANTES de setExpression, porque eso causaría
            // DOS actualizaciones síncronas del store zustand, disparando el efecto
            // blend de BunnyViewer DOS VECES y creando ACTIONS huérfanas duplicadas
            // que compiten por los mismos huesos → boca congelada/errática.
            if (alt) {
                store.setExpression(alt.expression);
                const altAnimsStr = alt.anims.join(', ');
                relayLog('LOG', 'AvatarVoiceSync', `SPEAKING → setExpression(${alt.expression}) → anims=[${altAnimsStr}]`);
                if (options.debug) {
                }
            } else {
                // Fallback defensivo: setExpression ya resuelve 'hablando' → ['Idle_2','MouthMove']
                store.setExpression('hablando');
                relayLog('WARN', 'AvatarVoiceSync', `SPEAKING FALLBACK → setExpression(hablando) — alt era null`);
                if (options.debug) {
                }
            }
            return;
        }

        if (state === 'THINKING') {
            // DIRECT: bypass reactivity engine
            store.setExpression('Pensando');
            if (options.debug) {
            }
            return;
        }

        // For non-toggle states (IDLE, ERROR, CELEBRATING, SLEEPING), use applyResolved
        // which also bypasses reactivity for these simple states
        if (resolved.expression) {
            store.setExpression(resolved.expression);
        } else {
            store.clearExpression();
        }
        if (resolved.anims.length > 0) {
            store.blendAnimation(resolved.anims);
        }

        if (options.debug) {
        }
    }, [getEngineOptions]);

    /**
     * Cancela la acción sostenida (comando del usuario) y su timer.
     * Se llama al entrar a THINKING (nueva instrucción), al hacer SPEAKING sin
     * acción de cuerpo completo, y al desmontar.
     */
    const clearSustainedAction = useCallback(() => {
        if (sustainedActionTimerRef.current !== null) {
            window.clearTimeout(sustainedActionTimerRef.current);
            sustainedActionTimerRef.current = null;
        }
        sustainedActionRef.current = null;
    }, []);

    /**
     * Programa la acción de cuerpo completo del comando del usuario para que dure
     * 8s (SUSTAINED_ACTION_MS) incluso tras SPEAKING→LISTENING. Al expirar restaura
     * el blend normal del estado actual (escucha). Una nueva llamada reemplaza a la
     * anterior (nueva instrucción cancela la acción previa).
     *
     * Modo 'song' (Regla 3): el sostenimiento dura MIENTRAS suene la canción
     * (isMusicPlaying() === true) con un tope de seguridad de SONG_SUSTAIN_MAX_MS.
     * Un poller recursivo de 1s revisa la música; al terminar (o por tope) restaura
     * el blend normal del estado actual.
     */
    const scheduleSustainedAction = useCallback((anims: BunnyAnimation[], mode: 'fixed' | 'song' = 'fixed') => {
        clearSustainedAction();
        if (mode === 'song') {
            sustainedActionRef.current = { anims, until: Infinity, sustainUntilSong: true };
            const startedAt = Date.now();
            const checkSong = () => {
                sustainedActionTimerRef.current = null;
                const overCap = Date.now() - startedAt >= SONG_SUSTAIN_MAX_MS;
                if (overCap) {
                    sustainedActionRef.current = null;
                    const currentState = useIntegrationStore.getState().conversationState;
                    if (currentState === 'LISTENING') {
                        // FIX 2026-08-16: clearExpression() fuerza currentExpression=null
                        // para que el guard de setExpression (si ya coincide con la
                        // expresión de escucha) NO haga no-op y el blendQueue sí se
                        // actualice a las animaciones de escucha (antes el avatar
                        // seguía bailando al terminar la canción).
                        bunnyActionsRef.current.clearExpression();
                        syncAvatarToState(currentState);
                    }
                    return;
                }
                const songOver = !isMusicPlaying();
                // FIX 2026-08-17 (bug real "canta 8s → idle"): playSong() es async
                // (App.tsx:773) y tarda ~4.5s en arrancar la música (sonda catálogo
                // / búsqueda Deezer). Durante SONG_START_GRACE_MS NO cancelamos
                // aunque la música aún no suene: el primer checkSong de +1s ya no
                // mata el baile antes de que arranque la canción.
                const withinStartupGrace = Date.now() - startedAt < SONG_START_GRACE_MS;
                if (songOver && !withinStartupGrace) {
                    sustainedActionRef.current = null;
                    const currentState = useIntegrationStore.getState().conversationState;
                    if (currentState === 'LISTENING') {
                        bunnyActionsRef.current.clearExpression();
                        syncAvatarToState(currentState);
                    }
                    return;
                }
                // La canción sigue sonando (o aún está arrancando) → seguir
                // sosteniendo y re-chequear en 1s.
                sustainedActionTimerRef.current = window.setTimeout(checkSong, 1000);
            };
            sustainedActionTimerRef.current = window.setTimeout(checkSong, 1000);
            return;
        }
        sustainedActionRef.current = { anims, until: Date.now() + SUSTAINED_ACTION_MS };
        sustainedActionTimerRef.current = window.setTimeout(() => {
            sustainedActionTimerRef.current = null;
            sustainedActionRef.current = null;
            const currentState = useIntegrationStore.getState().conversationState;
            if (currentState === 'LISTENING') {
                // FIX 2026-08-16: igual que en modo 'song', clearExpression() antes
                // del restore para que el guard de setExpression no deje colgado el
                // blend de la acción (avatar seguía en Dance/Run tras los 8s).
                bunnyActionsRef.current.clearExpression();
                syncAvatarToState(currentState);
            }
        }, SUSTAINED_ACTION_MS);
    }, [clearSustainedAction, syncAvatarToState]);

    /**
     * Aplica una emoción al avatar con gestos corporales.
     * DATA-DRIVEN: usa el EmotionEngine en lugar de EMOTION_TO_GESTURE hardcodeado.
     * NO tiene IFs de reactividad — el engine escala según intensity + reactivity.
     */
    const applyEmotion = useCallback((emotion: EmotionalState) => {
        const store = bunnyActionsRef.current;
        const options = getEngineOptions();

        // Don't override expression during SPEAKING (mouth movement is critical)
        if (conversationState === 'SPEAKING') return;

        const resolved = resolveEmotionExpression(emotion, options);

        if (resolved.expression) {
            applyResolved(resolved);
            if (options.debug) {
            }
        }
    }, [conversationState, getEngineOptions, applyResolved]);

    /**
     * Aplica una expresión contextual basada en el sentimiento del mensaje del usuario.
     * Crea un arco emocional natural: usuario dice algo positivo → FLU reacciona feliz.
     */
    const applyContextualEmotion = useCallback((sentiment: 'positive' | 'negative' | 'neutral' | 'question' | undefined) => {
        // Don't override expression during SPEAKING (mouth movement is critical)
        // Same guard as applyEmotion — previene que la expresión contextual
        // sobreescriba la expresión de speaking (que incluye MouthMove)
        if (conversationState === 'SPEAKING') return;

        const options = getEngineOptions();
        const resolved = resolveContextualExpression(sentiment, options);
        if (resolved.expression) {
            applyResolved(resolved);
            if (options.debug) {
            }
        }
    }, [conversationState, getEngineOptions, applyResolved]);

    /**
     * Participant emotion trigger — DATA-DRIVEN desde el expressionRegistry.
     * Aplica una expresión+animación del registro según el tipo de evento del participante.
     * No depende de IFs en código — busca en el registro por trigger.
     */
    const triggerParticipantEmotion = useCallback((event: 'granted' | 'ignored' | 'rejected' | 'raised' | 'dismissed') => {
        const store = bunnyActionsRef.current;
        const options = getEngineOptions();

        if (event === 'raised') {
            // DATA-DRIVEN: use PARTICIPANT_ALTERNATIVES from expressionRegistry
            const toggleIndex = participantToggleRef.current % PARTICIPANT_ALTERNATIVES.length;
            participantToggleRef.current++;
            const alt = PARTICIPANT_ALTERNATIVES[toggleIndex];
            store.setExpression(alt.expression);
            if (options.debug) {
            }
            return;
        }

        if (event === 'dismissed') {
            // FIX 2026-08-12 (mano congelada): el dismiss manual ("flu espera") o
            // resetParticipant no disparaban emoción → la expresión sticky 'raised'
            // (palabra/Palabra2 → anim 'Palabra') quedaba ARRIBA para siempre.
            // Aplicar la expresión neutral de escucha ('atencion' → Idle_2, sin
            // 'Palabra') → la mano baja al instante SIN enojarse (dismiss deliberado
            // del usuario, no "no le hicieron caso").
            store.setExpression('atencion');
            if (options.debug) {
            }
            return;
        }

        const resolved = resolveTriggerExpression(event, options);
        if (!resolved) return;

        // ============================================================
        // S1: UNIFICAR la ruta participante en el canal ÚNICO
        // pendingEmotionAnims (eliminar la ruta doble).
        //
        // ANTES: applyResolved directo → store.setExpression('enojado') +
        // blendAnimation([Walk, ...]) FUERA de la máquina de estados. El
        // siguiente syncAvatarToState (THINKING→Pensando / SPEAKING→hablando)
        // pisaba la emoción al instante → enojado+Walk nunca se veía.
        //
        // AHORA: escribir en pendingEmotionAnims para que el branch SPEAKING
        // (abajo) la mezcle con MouthMove durante la respuesta (~7s).
        //   - Si ya estamos SPEAKING: no habrá nueva transición que consuma el
        //     canal; mezclar AHORA (una sola actualización del store).
        //   - Si NO: el canal se consume en la próxima transición a SPEAKING.
        // ============================================================
        if (conversationState === 'SPEAKING') {
            // Fix (intermitencia "camina/deja de caminar"): la emoción del participante
            // (enojado por mano ignorada) NO tiene reset de 7s — persiste hasta que el
            // flujo cambie. El reset de 7s SOLO aplica al retorno de la IA (source='ai').
            store.blendAnimation([...new Set([...resolved.anims, 'MouthMove' as BunnyAnimation])]);
        } else {
            // FIX 2026-08-12 (mano alzada que NUNCA bajaba en reunión pasiva):
            // la expresión de mano alzada (palabra/Palabra2 → anim 'Palabra') es
            // STICKY: 'raised' la aplica con setExpression() y RETORNA sin reset.
            // Al descartarse la fase (3 min, 'ignored'), la reacción ('enojado')
            // solo se guardaba en pendingEmotionAnims — canal que se consume
            // ÚNICAMENTE en la próxima transición a SPEAKING. Si FLU solo escucha
            // y nunca habla, el canal jamás se consume → la mano quedaba ARRIBA
            // PARA SIEMPRE (y cada nueva evaluación la volvía a alzar).
            // AHORA: aplicar la expresión INMEDIATAMENTE en el store. setExpression
            // carga TODAS las anims vía EXPRESSION_MAP; enojado/llorando/intervencion
            // NO incluyen 'Palabra' → la mano se baja al instante. Se conserva el
            // guardado en el canal para que, si FLU llega a hablar, la emoción se
            // mezcle con MouthMove como antes (S1).
            if (resolved.expression) {
                store.setExpression(resolved.expression);
            } else {
                store.clearExpression();
            }
            setPendingEmotionAnimsAction(resolved.anims, 'participant');
        }

        if (options.debug) {
        }
    }, [getEngineOptions, conversationState, setPendingEmotionAnimsAction, scheduleEmotionReset]);

    /**
     * Muestra una micro-expresión aleatoria para dar vida al avatar en estado idle.
     */
    const showIdleMicroExpression = useCallback((forceVisible = false) => {
        const options = getEngineOptions();
        const resolved = resolveIdleMicroExpression(options, { forceVisible });
        if (!resolved) return;

        applyResolved(resolved);

        if (options.debug) {
        }
    }, [getEngineOptions, applyResolved]);

    /**
     * Limpia el timeout de auto-ciclo.
     */
    const clearAutoCycle = useCallback(() => {
        if (autoCycleTimeoutRef.current) {
            clearTimeout(autoCycleTimeoutRef.current);
            autoCycleTimeoutRef.current = null;
        }
    }, []);

    /**
     * Inicia/detiene el timer de micro-expresiones idle.
     */
    const startIdleMicroExpressions = useCallback((firstDelay?: number, firstVisible = false) => {
        // Clear existing timer
        if (idleMicroTimerRef.current) {
            clearTimeout(idleMicroTimerRef.current);
            idleMicroTimerRef.current = null;
        }
        // Start new timer — show micro-expression every 8-15 seconds.
        // (Cadencia OS3. Antes 4-8s: el avatar cambiaba de animación cada
        // pocos segundos sin descanso → ciclo "canta baila chispas" y
        // percepción de lentitud. Con 8-15s y un pool de micros sutiles
        // (chispas/se_me_chispotio) el avatar se percibe vivo pero con
        // reposo natural.)
        const scheduleNext = () => {
            const delay = 8000 + Math.random() * 7000; // 8-15 seconds
            idleMicroTimerRef.current = window.setTimeout(() => {
                showIdleMicroExpression();
                scheduleNext(); // Schedule next one
            }, delay);
        };
        if (firstDelay !== undefined) {
            // Primera micro-expresión adelantada (p.ej. justo tras dejar de
            // hablar) para que el cese de la boca no se lea como "congelado".
            idleMicroTimerRef.current = window.setTimeout(() => {
                showIdleMicroExpression(firstVisible);
                scheduleNext();
            }, firstDelay);
        } else {
            scheduleNext();
        }
    }, [showIdleMicroExpression]);

    const stopIdleMicroExpressions = useCallback(() => {
        if (idleMicroTimerRef.current) {
            clearTimeout(idleMicroTimerRef.current);
            idleMicroTimerRef.current = null;
        }
    }, []);


    // -------------------------------------------------------
    // Efecto principal: reaccionar a cambios de ConversationState
    // -------------------------------------------------------
    useEffect(() => {
        const currentState = conversationState;
        const prevState = prevStateRef.current;

        if (currentState === prevState) return;
        prevStateRef.current = currentState;

        // Limpiar auto-cycle timeout al cambiar de estado
        clearAutoCycle();
        // FIX 2026-08-13 (Punto 3b): al CAMBIAR de estado se cancela el timer de
        // reset de 7s pendiente. Antes, un reset del retorno de la IA seguía
        // vivo y podía dispararse en un flujo posterior (participante hablando),
        // matando el Walk del enojado en medio del habla.
        clearEmotionReset();

        // Manage idle micro-expressions
        if (currentState === 'IDLE') {
            // Al salir de SPEAKING → IDLE, disparar una micro-expresión VISIBLE
            // pronto (~1.5s) para que el cese de la boca no se perciba como
            // "congelado". Luego sigue la cadencia normal (8-15s) de micros.
            const justSpoke = prevState === 'SPEAKING' && currentState === 'IDLE';
            startIdleMicroExpressions(justSpoke ? 1500 : undefined, justSpoke);
        } else {
            stopIdleMicroExpressions();
        }

        switch (currentState) {
            case 'IDLE':
                setFluSpeaking(false);
                syncAvatarToState('IDLE');
                break;

            case 'LISTENING':
                setMicActive(true);
                syncAvatarToState('LISTENING');
                pushBridgeEvent({
                    type: 'listening:start',
                    timestamp: Date.now(),
                });
                break;

            case 'THINKING':
                // Nueva instrucción del usuario: cancela cualquier acción sostenida
                // previa (el comando anterior ya no debe seguir activo).
                clearSustainedAction();
                setMicActive(false);
                syncAvatarToState('THINKING');
                pushBridgeEvent({
                    type: 'thinking:start',
                    timestamp: Date.now(),
                });
                break;

            case 'SPEAKING': {
                setMicActive(false);
                // EMOTION DURING SPEAKING (OS3 parity): leer las animaciones de emoción
                // pendientes (ya resueltas por App.tsx desde EXPRESSION_MAP) para mezclarlas
                // con MouthMove durante los primeros ~7s de habla. Se limpian tras consumirse.
                // NOTA: las animaciones de emoción NO se aplican durante THINKING (solo se
                // aplican aquí, en SPEAKING) para evitar la doble recarga de BunnyViewer.
                const hasPendingEmotion = pendingEmotionAnims.length > 0;
                // Fix (intermitencia "camina/deja de caminar"): el reset de 7s SOLO aplica
                // cuando la emoción vino del RETORNO DE LA IA (source='ai'). La emoción del
                // participante (enojado por mano ignorada, source='participant') NO tiene
                // límite: persiste mientras el flujo no cambie.
                const isAiReturnEmotion = pendingEmotionSource === 'ai';
                // ACCIÓN SOSTENIDA (2026-08-15): un comando del usuario con acción de cuerpo
                // completo (baila/corre/canta → Dance/Run, source='ai') se mantiene 8s incluso
                // tras SPEAKING→LISTENING. Un SPEAKING normal (sin emoción) o una respuesta con
                // emoción de POSE estática CANCELAN cualquier acción sostenida previa (nueva
                // instrucción reemplaza a la anterior).
                // REGLA 3 (2026-08-16): con sustainMode='song' ("canta la canción X") el
                // sostenimiento dura MIENTRAS suene la canción y NO aplica el reset de 7s
                // (el canto termina cuando termina la música, no a los 7s).
                const isFullBodyCommand = hasPendingEmotion && isAiReturnEmotion && (pendingEmotionAnims as BunnyAnimation[]).some((a) => ACTION_ANIMS.has(a));
                const isSongSustain = pendingEmotionSustainMode === 'song';
                syncAvatarToState('SPEAKING', hasPendingEmotion ? (pendingEmotionAnims as BunnyAnimation[]) : undefined);
                if (hasPendingEmotion) {
                    setPendingEmotionAnimsAction([], null, null);
                    if (isAiReturnEmotion) {
                        if (!isSongSustain) {
                            scheduleEmotionReset();
                        }
                        if (isFullBodyCommand) {
                            scheduleSustainedAction(pendingEmotionAnims as BunnyAnimation[], isSongSustain ? 'song' : 'fixed');
                        } else {
                            clearSustainedAction();
                        }
                    }
                } else {
                    clearSustainedAction();
                }
                pushBridgeEvent({
                    type: 'speaking:start',
                    timestamp: Date.now(),
                });
                break;
            }

            case 'SLEEPING':
                setFluSpeaking(false);
                setMicActive(false);
                syncAvatarToState('SLEEPING');
                pushBridgeEvent({
                    type: 'sleeping:start',
                    timestamp: Date.now(),
                });
                break;

            case 'ERROR':
                setFluSpeaking(false);
                setMicActive(false);
                syncAvatarToState('ERROR');
                pushBridgeEvent({
                    type: 'error',
                    timestamp: Date.now(),
                });
                break;

            case 'CELEBRATING':
                syncAvatarToState('CELEBRATING');
                break;
        }
    }, [conversationState, pendingEmotionAnims, pendingEmotionSource, pendingEmotionSustainMode, syncAvatarToState, clearAutoCycle, clearEmotionReset, startIdleMicroExpressions, stopIdleMicroExpressions, setFluSpeaking, setMicActive, pushBridgeEvent, setPendingEmotionAnimsAction, scheduleEmotionReset, clearSustainedAction, scheduleSustainedAction]);

    // -------------------------------------------------------
    // Efecto (montaje): arrancar micro-expresiones idle si se inicia en IDLE
    // -------------------------------------------------------
    // El efecto principal retorna temprano en el montaje (IDLE === IDLE) por lo
    // que las micro-expresiones NO arrancan hasta la PRIMERA transición real de
    // estado → en reposo FLU solo mostraba el loop base Idle_2 (percepción de
    // "congelado" antes de abrir escucha). Este efecto las enciende al montar.
    useEffect(() => {
        if (conversationState === 'IDLE') {
            startIdleMicroExpressions();
        }
        // Intencional: solo debe ejecutarse al montar.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // -------------------------------------------------------
    // Efecto: aplicar configuración de imagen (gorra/pelo) al avatar
    // -------------------------------------------------------
    useEffect(() => {
        const { capVisible, hairVisible } = imageConfig;
        const store = bunnyActionsRef.current;

        // OS1 API: setComponentVisibility(component, visible)
        // Bunny_cap = gorra, Bunny_bangs = pelo/fleco
        store.setComponentVisibility('Bunny_cap' as BunnyComponent, capVisible);
        store.setComponentVisibility('Bunny_bangs' as BunnyComponent, hairVisible);

        if (debugMode) {
        }
    }, [imageConfig.capVisible, imageConfig.hairVisible, debugMode]);

    // -------------------------------------------------------
    // Efecto: sincronizar velocidad de animación
    // -------------------------------------------------------
    useEffect(() => {
        const store = bunnyActionsRef.current;
        store.setAnimationSpeed(animationSpeed);

        if (debugMode) {
        }
    }, [animationSpeed, debugMode]);

    // -------------------------------------------------------
    // Cleanup al desmontar
    // -------------------------------------------------------
    useEffect(() => {
        return () => {
            clearAutoCycle();
            clearEmotionReset();
            clearSustainedAction();
            stopIdleMicroExpressions();
        };
    }, [clearAutoCycle, clearEmotionReset, clearSustainedAction, stopIdleMicroExpressions]);

    return {
        syncAvatarToState,
        applyEmotion,
        triggerParticipantEmotion,
        /** New: apply contextual emotion based on conversation sentiment */
        applyContextualEmotion,
        /**
         * Ref para que App.tsx escriba animaciones de emoción resueltas vía callback directo.
         * Reemplaza el mecanismo anterior basado en integrationStore.uiState.pendingEmotionAnims.
         * Uso: pendingEmotionAnimsRef.current = resolvedAnims;
         */
        pendingEmotionAnimsRef,
    };
}
