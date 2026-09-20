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
import { parseAgendaCommand } from '../../core/agenda/agendaCommandParser'
import { parseNoteIntentText } from './noteIntentParser'
import {
  matchGameIntent,
  END_GAME_FRAMES,
  GAME_MENU_FRAMES,
  NON_GAME_REQUEST_FRAMES,
  getGameEngine,
  suppressesAmbient,
} from '../../core/games/gameCatalog'
import { getActiveGameSession } from '../../core/games/gameSessionStore'

// ------------------------------------------------------------
// Sonda de audio en reproducción (dueño único: la capa de App la conecta a
// `isMusicPlaying`). Mientras un juego de audio (karaoke/adivina canción)
// reproduce su pista, la voz ambiente NO debe intervenir ni cambiar la partida.
// ------------------------------------------------------------
let audioPlayingProbe = () => false

/** Conecta la sonda de reproducción de audio (una sola vez, desde App). */
export function setAudioPlayingProbe(probe) {
  audioPlayingProbe = typeof probe === 'function' ? probe : () => false
}

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
  'cuantas',
  'dime',
  'dime cuantas',
  'dime cuantos',
  'que es',
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
  return startsWithFrame(clean, QUESTION_STARTERS)
}

/**
 * ¿El texto es un comando ACCIONABLE de otro dominio (agenda o notas)?
 * Con una partida activa, esos comandos NO deben consumirse como respuesta del
 * juego: se dejan pasar (return null) para que el enrutador normal los ejecute
 * (crear alarma/cita/recordatorio, poner/quitar notas…). El juego queda activo.
 *
 * Sin acoplamiento al árbitro (import directo de los parsers) para no crear
 * un ciclo de imports (el árbitro ya importa este módulo).
 */
function isNonGameActionableCommand(text) {
  try {
    const agenda = parseAgendaCommand(text)
    if (agenda?.handled && agenda.action) return true
  } catch {
        console.warn('[catch] src/voice/lib/gameCommands.js');
    /* parser sin match no debe romper el juego */
  }
  try {
    const note = parseNoteIntentText(text)
    if (note?.label) return true
  } catch {
        console.warn('[catch] src/voice/lib/gameCommands.js');
    /* idem */
  }
  return false
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
    // 2b. Juego que suprime voz ambiente (karaoke) con audio sonando: solo
    //     controles explícitos del motor ("sigue"/"pista"/salir). La letra o el
    //     ruido NO cambian la canción ni saltan de juego.
    if (suppressesAmbient(activeSession.id) && audioPlayingProbe()) {
      const audioEngine = getGameEngine(activeSession.id)
      if (audioEngine && audioEngine.isGameCommand(text)) {
        return { gameId: activeSession.id, action: 'turn', playerText: text }
      }
      return null
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
    // 5b. Comando accionable de OTRO dominio (agenda/notas): NO es respuesta del
    //     juego → se deja pasar para que se ejecute (el juego sigue activo).
    if (isNonGameActionableCommand(text)) {
      return null
    }
    // 6. Respuesta abierta del jugador (el motor decide si es correcta).
    return { gameId: activeSession.id, action: 'turn', playerText: text }
  }

  // Sin partida activa: una PREGUNTA sobre el juego la responde la IA, NO inicia
  // la partida (antes "dime cuántas cartas tiene la lotería" arrancaba el juego).
  const cleanNoSession = normalized.replace(/^[^a-z0-9]+/, '')
  if (isQuestionLike(cleanNoSession) || startsWithFrame(cleanNoSession, NON_GAME_REQUEST_FRAMES)) {
    return null
  }
  // Solo inicia si hay intención explícita y resoluble.
  const intent = matchGameIntent(text)
  if (intent) return { gameId: intent.id, action: 'start' }

  // Nada → no es un juego.
  return null
}
