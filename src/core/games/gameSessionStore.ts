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
