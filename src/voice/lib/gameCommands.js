// ============================================================
// FLU OS4 — Resolución determinista de comandos de juego por voz
// ============================================================
// Complemento 100% local y determinista del flujo `juego` (fast-path):
// cuando el niño dice "ok flu, juguemos a las adivinanzas", este módulo
// deriva el contrato a partir del texto transcrito SIN depender de Gemini.
//
// - Única fuente de verdad: gameCatalog (matchGameIntent + END_GAME_FRAMES) +
//   gameSessionStore.
// - Sin rutas dobles: el resultado se inyecta como `contract.juego` y se
//   despacha por la ÚNICA ruta existente (App.tsx applyGameAction).
// - Guardia estricta: requiere partida activa O intención de inicio resuelta.
//   Sin partida activa, "simón dice que te calles" NO inicia nada.
// ============================================================

import { normalizeForMatch, hasToken } from './configCommands.js'
import {
  matchGameIntent,
  END_GAME_FRAMES,
  GAME_MENU_FRAMES,
  NON_GAME_REQUEST_FRAMES,
  getGameEngine,
} from '../../core/games/gameCatalog'
import { getActiveGameSession } from '../../core/games/gameSessionStore'

// ------------------------------------------------------------
// Resolución determinista texto → evento de juego
// ------------------------------------------------------------

/**
 * Arranques interrogativos: una PREGUNTA general durante una partida no es una
 * respuesta del juego, y debe responderla la IA (no el motor, que entraría en
 * ciclo). Los comandos propios del juego ("pista", "paso"…) tienen prioridad
 * vía `engine.isGameCommand`.
 */
const QUESTION_STARTERS = Object.freeze([
  'que',
  'como',
  'por que',
  'porque',
  'donde',
  'cuando',
  'quien',
  'cuantos',
  'cuanta',
  'cuanto',
  'para que',
  'puedes',
  'me puedes',
  'sabes',
  'estas',
  'estan',
  'hay',
]);

/** ¿El texto limpio (sin puntuación inicial) empieza con alguno de los frames? */
function startsWithFrame(clean, frames) {
  return frames.some((frame) => clean === frame || clean.startsWith(`${frame} `));
}

function isQuestionLike(clean) {
  return startsWithFrame(clean, QUESTION_STARTERS);
}

/**
 * Deriva un contrato `juego` determinista a partir del texto transcrito.
 * Retorna `null` si no hay evento de juego resoluble (guardia estricta).
 *
 * Orden de resolución con partida ACTIVA (evita secuestrar la conversación):
 *   1. Frase de salida            → `end`
 *   2. Pide el menú de juegos     → `menu`
 *   3. Pide OTRO juego concreto   → `switch` (cerrar el actual y abrir el nuevo)
 *   4. Comando propio del juego   → `turn` (señal positiva del motor)
 *   5. Pregunta general           → null (la responde la IA, no el motor)
 *   6. Cualquier otra cosa        → `turn` (respuesta abierta del jugador)
 * Sin partida activa:
 *   1. Intención explícita de iniciar → `start`
 *   2. Nada                           → null
 */
export function resolveGameCommandFromText(text = '') {
  const normalized = normalizeForMatch(text)
  if (!normalized) return null

  const activeSession = getActiveGameSession()

  if (activeSession) {
    // 1. Frase de salida → terminar la partida activa.
    if (END_GAME_FRAMES.some((frame) => hasToken(normalized, frame))) {
      return { gameId: activeSession.id, action: 'end' }
    }
    // 2. Pide el menú de juegos.
    if (GAME_MENU_FRAMES.some((frame) => hasToken(normalized, frame))) {
      return { gameId: activeSession.id, action: 'menu' }
    }
    // 3. Pide OTRO juego concreto → cambiar (cerrar el actual y abrir el nuevo).
    const intent = matchGameIntent(text)
    if (intent && intent.id !== activeSession.id) {
      return { gameId: intent.id, action: 'switch' }
    }
    const engine = getGameEngine(activeSession.id)
    // 4. Comando propio del juego (pista, paso, "la tengo"…): siempre turno,
    //    aunque empiece como pregunta.
    if (engine && engine.isGameCommand(text)) {
      return { gameId: activeSession.id, action: 'turn', playerText: text }
    }
    // 5. Petición general (pregunta o "platícame de…") → la responde la IA.
    //    Genérico: mismo criterio para cualquier juego activo (rompe el ciclo).
    const clean = normalized.replace(/^[^a-z0-9]+/, '')
    if (isQuestionLike(clean) || startsWithFrame(clean, NON_GAME_REQUEST_FRAMES)) {
      return null
    }
    // 6. Respuesta abierta del jugador (el motor decide si es correcta).
    return { gameId: activeSession.id, action: 'turn', playerText: text }
  }

  // Sin partida activa: solo inicia si hay intención explícita y resoluble.
  const intent = matchGameIntent(text)
  if (intent) return { gameId: intent.id, action: 'start' }

  // Nada → no es un juego.
  return null
}
