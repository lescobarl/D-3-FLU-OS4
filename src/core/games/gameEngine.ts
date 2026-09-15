// ============================================================
// src/core/games/gameEngine.ts
// Interfaz genérica de motores de juego (plan-juegos §2).
// Funciones puras sin I/O (estilo de audioMath.js).
//
// Diseño finalizado: los motores MUTAN la sesión in-place y
// devuelven GameTurnResult. La sesión es un objeto plano y
// serializable para poder persistirla en sessionState.
// ============================================================
import type { GameId, GameNarrativeScene, GameSession, GameTurnContext, GameTurnResult } from './types';

export interface GameEngine {
    id: GameId;
    /** Crea una sesión nueva con configuración opcional. */
    createSession(options?: Record<string, unknown>): GameSession;
    /** Primer prompt del juego (ej. "Simón dice: salta"). Muta session. */
    start(session: GameSession, options?: Record<string, unknown>): GameTurnResult;
    /**
     * Valida la respuesta del jugador, avanza estado, devuelve siguiente prompt.
     * `context.playerId` identifica al hablante (multiusuario). Los juegos de
     * un solo jugador lo ignoran; los de fiesta aislan estado por `players`.
     */
    turn(session: GameSession, text: string, context?: GameTurnContext): GameTurnResult;
    /**
     * (Opcional) Ingresa escenas externas (contrato narrate de cuentacuentos)
     * y devuelve el prompt de la primera escena. Los motores que no narran
     * no implementan este método.
     */
    narrate?(session: GameSession, scenes: GameNarrativeScene[], options?: Record<string, unknown>): GameTurnResult;
    /** Detecta "sigo jugando", "salir del juego", etc. */
    isGameCommand(text: string): boolean;
}
