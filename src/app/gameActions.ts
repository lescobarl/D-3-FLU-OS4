/**
 * P6.6 - applyGameAction (extraido de App.tsx).
 *
 * Fast-path determinista de juegos por voz: recibe el contrato ya
 * normalizado y ejecuta el motor local. Gemini NUNCA arbitra el estado de
 * la partida. ApplyGameContext se queda privado (solo lo usa esta funcion).
 */

import { EXPRESSION_MAP } from '../avatar';
import { getGameEngine, gameMenuNames, isAudioGame } from '../core/games/gameCatalog';
import { clearActiveGameSession, getActiveGameSession, setActiveGameSession } from '../core/games/gameSessionStore';
import type { GameSpeechOptions } from '../core/games/gameSpeech';
import { resolveGameSpeechOptions } from '../core/games/gameSpeech';
import type { GameId, GameSession } from '../core/games/types';
import { logCaughtError } from '../lib/caughtError';
import { relayLog } from '../lib/clientLogRelay';
import { resolveEmotionAnims } from '../lib/transcriptProcessor';
import { isMusicPlaying, playSong, stopMusic } from '../services/musicPlayer';
import { useIntegrationStore } from '../store/integrationStore';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { setAudioPlayingProbe } from '../voice/lib/gameCommands';
import type React from 'react';
// ============================================================
// Juegos por voz (fast-path determinista) — plan-juegos §7
// ============================================================
// Cada motor vive en src/core/games/* y es 100% local y
// determinista: Gemini NUNCA arbitra el estado de la partida.
// applyGameAction recibe el contrato ya normalizado por
// normalizeJuego desde onContractResolved (ruta única) y ejecuta
// el motor, aplica la emoción resultante al avatar (source='game')
// y habla el prompt con el mismo mecanismo de la ruta de Gemini.
// ============================================================
interface ApplyGameContext {
    languageRef: React.MutableRefObject<string>;
    conversationActiveRef: React.MutableRefObject<boolean>;
    speakFluRef: React.MutableRefObject<(text: string, lang: string, opts?: GameSpeechOptions) => Promise<void>>;
    /** Reanuda la escucha tras hablar (useNavigationCommands, estable). */
    scheduleResumeListening: (textLength?: number) => void;
    /** Participante activo (dueño del turno, mismo scope que horario/notas). */
    participantIdRef: React.MutableRefObject<string | undefined>;
}

/** Aplica la emoción/animación de un resultado de motor al avatar. */
function applyGameEmotion(result: { animation?: string; emotion?: string }): void {
    const emotionLabel = result.animation || result.emotion || '';
    const resolvedEmotionAnims: string[] = emotionLabel
        ? (resolveEmotionAnims(emotionLabel, EXPRESSION_MAP) ?? [])
        : [];
    if (resolvedEmotionAnims.length > 0) {
        useIntegrationStore.getState().setPendingEmotionAnims(resolvedEmotionAnims, 'game', null);
        relayLog('LOG', 'App', `[Juego] pendingEmotionAnims ← [${resolvedEmotionAnims.join(', ')}] (emotionLabel="${emotionLabel}" source='game')`);
    }
}

/**
 * Habla el prompt del motor replicando el mecanismo de habla de
 * onContractResolved (SPEAKING → habla → LISTENING/IDLE + resume).
 */
async function speakGameText(text: string, ctx: ApplyGameContext, opts?: GameSpeechOptions): Promise<void> {
    if (!text) return;

    const currentSpeakFlu = ctx.speakFluRef.current;
    const speakPromise = currentSpeakFlu(text, ctx.languageRef.current, opts).catch((speechErr: unknown) => {
        console.warn('[Juego] speakFlu failed:', speechErr);
    });

    useIntegrationStore.getState().setConversationState('SPEAKING');
    useIntegrationStore.getState().setFluSpeaking(true);
    useIntegrationStore.getState().incrementInteractionCount();
    useIntegrationStore.getState().pushBridgeEvent({ type: 'speaking:start', timestamp: Date.now() });

    if (speakPromise) {
        try {
            await speakPromise;
        } catch (speechErr) {
            logCaughtError('[Juego] speakFlu failed', speechErr);
        }
    }
    const nextResumeState = ctx.conversationActiveRef.current ? 'LISTENING' : 'IDLE';
    useIntegrationStore.getState().setConversationState(nextResumeState);
    useIntegrationStore.getState().setFluSpeaking(false);
    ctx.scheduleResumeListening(text.length);
}

/** Configuración de motor data-driven desde FLU_CONFIG.games. */
function buildGameConfig(gameId: string): Record<string, unknown> {
    const games = FLU_CONFIG.games || {};
    const base: Record<string, unknown> = { rounds: games.defaultRounds };
    if (gameId === 'simon_dice') {
        const simon = games.simonDice || {};
        return { ...base, verbos: [...(simon.verbos || [])], longMax: simon.longMax };
    }
    if (gameId === 'adivina_numero') {
        const cfg = games.adivinaNumero || {};
        return { ...base, min: cfg.min, max: cfg.max, pistasMax: cfg.pistasMax };
    }
    if (gameId === 'calculo_mental') {
        const cfg = games.calculoMental || {};
        return { ...base, maxSuma: cfg.maxSuma, operaciones: [...(cfg.operaciones || [])] };
    }
    if (gameId === 'ahorcado') {
        const cfg = games.ahorcado || {};
        return { ...base, intentos: cfg.intentos };
    }
    if (gameId === 'memoria_secuencias') {
        const cfg = games.memoriaSecuencias || {};
        return { ...base, longMax: cfg.longMax };
    }
    if (gameId === 'cuento_colaborativo') {
        const cfg = games.cuentoColaborativo || {};
        return { ...base, turnos: cfg.turnos };
    }
    if (gameId === 'cuenta_conmigo') {
        const cfg = games.cuentaConmigo || {};
        return { ...base, hasta: cfg.hasta };
    }
    if (gameId === 'respiracion') {
        const cfg = games.respiracion || {};
        return { ...base, rondas: cfg.rondas };
    }
    if (gameId === 'loteria') {
        const cfg = games.loteria || {};
        return { ...base, tablaSize: cfg.tablaSize };
    }
    if (gameId === 'cuentacuentos') {
        const cfg = games.cuentacuentos || {};
        return { ...base, escenasMax: cfg.escenasMax };
    }
    return base;
}

// Mientras un juego de audio reproduce su pista, la voz ambiente no interviene
// (dueño único: la sonda se conecta a `isMusicPlaying`; el flag de juego de audio
// vive en el catálogo). El usuario siempre puede salir/parar con comandos explícitos.
setAudioPlayingProbe(isMusicPlaying);

/** Detiene la música si el juego activo la está usando. */
function stopMusicForGame(gameId: string): void {
    if (isAudioGame(gameId as GameId)) {
        stopMusic();
    }
}

/** Reproduce la pista que el motor eligió (songId) para juegos musicales. */
function playSongForGame(session: GameSession, gameId: string): void {
    if (!isAudioGame(gameId as GameId)) return;
    const songId = (session.state as { songId?: string } | null)?.songId;
    if (songId) {
        void playSong(songId);
    }
}

interface NormalizedGameAction {
    gameId: string;
    action: string;
    playerText?: string;
    playerId?: string;
    /** Nombre legible del jugador (ganador de lotería sin exponer el id). */
    playerName?: string;
    narrative?: { scenes: Array<{ texto: string; animacion?: string; emocion?: string }> };
}

/**
 * Ejecuta una acción de juego (start/turn/end/narrate) con el motor
 * local del catálogo. No relanza excepciones: cualquier error se
 * registra y se responde de forma amigable.
 */
export async function applyGameAction(juegoAction: NormalizedGameAction, ctx: ApplyGameContext): Promise<void> {
    if (juegoAction.action === 'narrate') {
        const engine = getGameEngine(juegoAction.gameId as GameId);
        const scenes = juegoAction.narrative?.scenes;
        if (!engine?.narrate || !scenes || scenes.length === 0) {
            await speakGameText('No puedo narrar esa historia ahora mismo. ¿Probamos otra cosa?', ctx);
            return;
        }
        const config = buildGameConfig(juegoAction.gameId);
        const session = getActiveGameSession() ?? engine.createSession(config);
        if (!getActiveGameSession()) setActiveGameSession(session);
        const result = engine.narrate(session, scenes, config);
        applyGameEmotion(result);
        await speakGameText(result.prompt, ctx);
        return;
    }

    const engine = getGameEngine(juegoAction.gameId as GameId);
    if (!engine) {
        await speakGameText('Ese juego todavía no está disponible. Prueba con Simón dice o adivinanzas.', ctx);
        return;
    }

    if (juegoAction.action === 'end') {
        clearActiveGameSession();
        stopMusicForGame(juegoAction.gameId);
        await speakGameText('¡Hasta la próxima partida! ¿Qué más hacemos?', ctx);
        return;
    }

    // Menú de juegos con partida activa: cierra la partida y ofrece el catálogo
    // (antes se enrutaba al motor activo y quedaba en ciclo).
    if (juegoAction.action === 'menu') {
        clearActiveGameSession();
        stopMusicForGame(juegoAction.gameId);
        await speakGameText(
            `Claro, salimos de la partida. Podemos jugar: ${gameMenuNames().join(', ')}. ¿Cuál eliges?`,
            ctx,
        );
        return;
    }

    // Cambio de juego: cierra el actual y arranca el nuevo por la MISMA ruta.
    if (juegoAction.action === 'switch') {
        clearActiveGameSession();
        stopMusic();
    }

    if (juegoAction.action === 'start' || juegoAction.action === 'switch') {
        const config = buildGameConfig(juegoAction.gameId);
        const session = engine.createSession(config);
        const result = engine.start(session, config);
        setActiveGameSession(session);
        applyGameEmotion(result);
        playSongForGame(session, juegoAction.gameId);
        await speakGameText(result.prompt, ctx);
        return;
    }

    const activeSession = getActiveGameSession();
    if (!activeSession) {
        await speakGameText('No hay una partida activa. Dime a qué juego quieres jugar.', ctx);
        return;
    }
    const songBefore = (activeSession.state as { songId?: string } | null)?.songId;
    const playerId = juegoAction.playerId || ctx.participantIdRef?.current;
    const playerName = (juegoAction as { playerName?: string }).playerName;
    const result = engine.turn(activeSession, juegoAction.playerText || '', { playerId, playerName });
    // Juegos musicales: si el turno cambió de canción (ronda nueva), hay que
    // reproducir la del turno. Antes solo se reproducía en `start`, así que a
    // partir de la ronda 2 sonaba la melodía de la primera canción.
    const songAfter = (activeSession.state as { songId?: string } | null)?.songId;
    if (songAfter && songAfter !== songBefore) {
        playSongForGame(activeSession, juegoAction.gameId);
    }
    if (result.gameOver) {
        clearActiveGameSession();
        stopMusicForGame(juegoAction.gameId);
    }
    applyGameEmotion(result);
    const speechOpts = resolveGameSpeechOptions(result);
    await speakGameText(result.prompt, ctx, speechOpts);
}
