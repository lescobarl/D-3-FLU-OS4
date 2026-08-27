// ============================================================
// src/core/games/gameEngine.ts
// Interfaz genérica de motores de juego (plan-juegos §2).
// Funciones puras sin I/O (estilo de audioMath.js).
//
// Diseño finalizado: los motores MUTAN la sesión in-place y
// devuelven GameTurnResult. La sesión es un objeto plano y
// serializable para poder persistirla en sessionState.
// ============================================================
import type { GameId, GameSession, GameTurnResult } from './types';

export interface GameEngine {
    id: GameId;
    /** Crea una sesión nueva con configuración opcional. */
    createSession(options?: Record<string, unknown>): GameSession;
    /** Primer prompt del juego (ej. "Simón dice: salta"). Muta session. */
    start(session: GameSession, options?: Record<string, unknown>): GameTurnResult;
    /** Valida la respuesta del jugador, avanza estado, devuelve siguiente prompt. */
    turn(session: GameSession, text: string): GameTurnResult;
    /** Detecta "sigo jugando", "salir del juego", etc. */
    isGameCommand(text: string): boolean;
}
