// ============================================================
// src/core/games/gameSessionStore.ts
// Almacén compartido de la partida activa (single source of truth).
// Lo comparten el fast-path del hook (arbitraje determinista) y
// App (ejecución del motor + habla). Sesión serializable y plana.
// ============================================================
import type { GameSession } from './types';

let activeSession: GameSession | null = null;

export function getActiveGameSession(): GameSession | null {
    return activeSession;
}

export function setActiveGameSession(session: GameSession | null): void {
    activeSession = session;
}

export function clearActiveGameSession(): void {
    activeSession = null;
}

/**
 * Ciclo de vida por TURNO (dueño único, TODOS los juegos): una partida ACTIVA que
 * NO consume el turno queda SUSPENDIDA (en pausa). El turno es de su dueño real
 * —otro dominio (imagen, cita, nota, compras, ambiente…) o la IA— y la partida no
 * responde por encima de él; además deja de consumir las respuestas abiertas
 * siguientes (si no, el motor seguiría "batiendo la conversación": cualquier frase
 * suelta volvería a entrarle como jugada) hasta que el usuario la retome con una
 * orden de juego (cualquiera: ver applyGameAction).
 *
 * Vive aquí, y no en cada llamador, para que la regla sea UNA y valga igual para
 * todos los juegos: el hook la aplica UNA vez por turno, tras clasificarlo.
 */
export function noteGameTurn(consumedByGame: boolean): void {
    if (activeSession && !consumedByGame) activeSession.suspended = true;
}

/** ¿La partida activa está en pausa? (sin partida activa: false) */
export function isGameSuspended(): boolean {
    return Boolean(activeSession?.suspended);
}

/** Marca la partida activa en pausa (la deja viva: conserva su estado). */
export function suspendActiveGameSession(): void {
    if (activeSession) activeSession.suspended = true;
}

/** Retoma la partida activa (la pausa no borra nada: se sigue donde estaba). */
export function resumeActiveGameSession(): void {
    if (activeSession) activeSession.suspended = false;
}
