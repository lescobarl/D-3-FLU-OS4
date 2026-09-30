/**
 * P6.6 - applyGameAction (extraido de App.tsx).
 *
 * Fast-path determinista de juegos por voz: recibe el contrato ya
 * normalizado y ejecuta el motor local. Gemini NUNCA arbitra el estado de
 * la partida. ApplyGameContext se queda privado (solo lo usa esta funcion).
 */

import { EXPRESSION_MAP } from '../avatar';
import { getGameEngine, gameMenuNames, isAudioGame } from '../core/games/gameCatalog';
import { clearActiveGameSession, getActiveGameSession, resumeActiveGameSession, setActiveGameSession, suspendActiveGameSession } from '../core/games/gameSessionStore';
import type { GameSpeechOptions } from '../core/games/gameSpeech';
import { resolveGameSpeechOptions } from '../core/games/gameSpeech';
import type { GameId, GameSession } from '../core/games/types';
import { logCaughtError } from '../lib/caughtError';
import { relayLog } from '../lib/clientLogRelay';
import { resolveEmotionAnims } from '../lib/transcriptProcessor';
import { isMusicPlaying, playSong, stopMusic } from '../services/musicPlayer';
import { useIntegrationStore } from '../store/integrationStore';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { setAudioPlayingProbe, isClaimedByOtherDomain } from '../voice/lib/gameCommands';
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
    /**
     * Texto del TURNO que originó la orden (frase canónica). Es la entrada del
     * dueño único del tipo de turno (`isClaimedByOtherDomain`): con él, una orden
     * de juego que la IA pidió para un turno AJENO no se ejecuta. Sin texto (rutas
     * sin turno: E2E/integración que ejecutan el motor a propósito) no hay nada que
     * clasificar y la orden se aplica tal cual.
     */
    turnText?: string;
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
        logCaughtError('[Juego] speakFlu', speechErr);
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

/**
 * FORMA de la configuracion de cada motor (FUENTE UNICA). El id del juego y la
 * clave en FLU_CONFIG.games estaban cableados en una cadena de 10 if (gameId ===
 * ...), asi que un juego nuevo obligaba a tocar la cadena y una errata en la clave
 * dejaba al motor sin su config en silencio. Aqui es DATO: clave en FLU_CONFIG.games
 * y campos que se copian al motor. Los campos de tipo lista se COPIAN (no se comparte
 * la referencia) para que el motor no mute la config global.
 */
/** Clave real de la config en FLU_CONFIG.games (una errata = error de compilacion). */
type GameConfigKey = keyof typeof FLU_CONFIG.games;

interface GameConfigField {
    readonly name: string;
    readonly list?: boolean;
}

const GAME_CONFIG_SHAPE: Readonly<Record<string, { key: GameConfigKey; fields: readonly GameConfigField[] }>> =
    Object.freeze({
        simon_dice: { key: 'simonDice', fields: [{ name: 'verbos', list: true }, { name: 'longMax' }] },
        adivina_numero: { key: 'adivinaNumero', fields: [{ name: 'min' }, { name: 'max' }, { name: 'pistasMax' }] },
        calculo_mental: { key: 'calculoMental', fields: [{ name: 'maxSuma' }, { name: 'operaciones', list: true }] },
        ahorcado: { key: 'ahorcado', fields: [{ name: 'intentos' }] },
        memoria_secuencias: { key: 'memoriaSecuencias', fields: [{ name: 'longMax' }] },
        cuento_colaborativo: { key: 'cuentoColaborativo', fields: [{ name: 'turnos' }] },
        cuenta_conmigo: { key: 'cuentaConmigo', fields: [{ name: 'hasta' }] },
        respiracion: { key: 'respiracion', fields: [{ name: 'rondas' }] },
        loteria: { key: 'loteria', fields: [{ name: 'tablaSize' }] },
        cuentacuentos: { key: 'cuentacuentos', fields: [{ name: 'escenasMax' }] },
    });

/** Configuracion de motor data-driven desde FLU_CONFIG.games. */
function buildGameConfig(gameId: string): Record<string, unknown> {
    const games = FLU_CONFIG.games || {};
    const base: Record<string, unknown> = { rounds: games.defaultRounds };
    const shape = GAME_CONFIG_SHAPE[gameId];
    if (!shape) return base;
    const source = (games[shape.key] || {}) as Record<string, unknown>;
    const out: Record<string, unknown> = { ...base };
    for (const field of shape.fields) {
        const value = source[field.name];
        out[field.name] = field.list && Array.isArray(value) ? [...value] : value;
    }
    return out;
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
/**
 * Respuesta HONESTA a "ese juego no lo tengo": ofrece el catalogo real.
 *
 * Fuente unica del texto: `gameMenuNames()` (los alias canonicos del catalogo).
 * No promete nada ni arranca nada: es el muro contra la IA anunciando una partida
 * que no existe (defecto medido 2026-09-28 18:11:56).
 */
export function unavailableGameMessage(): string {
    return `Ese juego no lo tengo todavia. Podemos jugar a: ${gameMenuNames().join(', ')}. Cual eliges?`;
}

export async function applyGameAction(juegoAction: NormalizedGameAction, ctx: ApplyGameContext): Promise<void> {
    // ============================================================
    // EL TURNO LO DECIDE SU DUEÑO (una sola pregunta, todos los juegos)
    // ============================================================
    // La IA también emite `juego` (contract.juego) y con un turno de OTRO dominio
    // el motor cantaba su carta por encima del dueño real: log del dueño 16:24:42 —
    // "Okay flu Crea una cita para mañana a las 3 de la tarde con el doctor" creaba
    // la cita Y FLU respondía "La carta es: La muerte…". Aquí no se pregunta quién
    // pidió la jugada, sino de quién es el TURNO (`isClaimedByOtherDomain`, dueño
    // único): si otro dominio lo reclama, no se ejecuta ninguna orden de juego y la
    // partida queda SUSPENDIDA (sigue viva, pero deja de responder turnos) hasta que
    // el usuario la retome con una orden de juego.
    if (ctx.turnText && isClaimedByOtherDomain(ctx.turnText, { language: ctx.languageRef.current })) {
        suspendActiveGameSession();
        relayLog('LOG', 'App', `[Juego] orden "${juegoAction.action}" IGNORADA: el turno es de otro dominio ("${String(ctx.turnText).slice(0, 60)}") → partida en PAUSA`);
        return;
    }
    // Cualquier orden de juego que SÍ llega al motor RETOMA la partida en pausa: la
    // pausa no borra nada (misma carta, misma ronda, mismo puntaje).
    // `unavailable`: el juego pedido NO esta en el catalogo. Lo responde el
    // DOMINIO DE JUEGOS con la lista real del catalogo (el LLM no puede anunciar una
    // partida inexistente) y la partida activa queda EN PAUSA: no se borra (sigue
    // viva, se retoma con una orden de juego) pero deja de consumir turnos. Va ANTES
    // del resume: si la partida estaba en pausa, el catalogo NO la levanta.
    if (juegoAction.action === 'unavailable') {
        suspendActiveGameSession();
        await speakGameText(unavailableGameMessage(), ctx);
        return;
    }
    resumeActiveGameSession();
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
        // Arranque IDEMPOTENTE: un `start` del juego que YA esta activo NO reinicia
        // la partida. El eco/doble turno reemitia "vamos a jugar loteria" y volvia
        // a cantar la primera carta (el mazo se reseteaba). Cambiar de juego si
        // arranca de cero; repetir el mismo, no.
        const active = getActiveGameSession();
        if (juegoAction.action === 'start' && active && active.id === juegoAction.gameId) {
            await speakGameText('Ya estamos jugando. Sigue cuando quieras.', ctx);
            return;
        }
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
