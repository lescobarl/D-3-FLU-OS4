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

import { resolveNavigationCommand } from './voiceCommands.js'
import { normalizeForMatch, hasVoiceToken, resolveConfigCommandFromText } from './configCommands.js'
import { parseAgendaCommand } from '../../core/agenda/agendaCommandParser'
import { isNoteCommand } from './noteIntentParser'
import {
  matchGameIntent,
  matchGameAliasOnly,
  END_GAME_FRAMES,
  GAME_MENU_FRAMES,
  NON_GAME_REQUEST_FRAMES,
  getGameEngine,
  suppressesAmbient,
} from '../../core/games/gameCatalog'
import { getActiveGameSession } from '../../core/games/gameSessionStore'
import { logCaughtError } from '../../lib/caughtError';

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
 * ¿El texto es un comando ACCIONABLE de otro dominio (agenda, notas o config)?
 * Con una partida activa, esos comandos NO deben consumirse como respuesta del
 * juego: se dejan pasar (return null) para que el enrutador normal los ejecute
 * (crear alarma/cita/recordatorio, poner/quitar notas, cambiar volumen/color…).
 * El juego queda activo.
 *
 * Sin acoplamiento al árbitro (import directo de los parsers) para no crear
 * un ciclo de imports (el árbitro ya importa este módulo).
 */
function isNonGameActionableCommand(text) {
  try {
    const agenda = parseAgendaCommand(text)
    if (agenda?.handled && agenda.action) return true
  } catch (e) {
        logCaughtError('[catch] src/voice/lib/gameCommands.js', e);
    /* parser sin match no debe romper el juego */
  }
  try {
    // Alta Y borrado de notas: el predicado unico del parser (sin lista propia
    // que se desvie). Antes solo se miraba el alta, asi que "borra la nota del
    // super" con partida activa caia al motor como respuesta del juego.
    if (isNoteCommand(text)) return true
  } catch (e) {
        logCaughtError('[catch] src/voice/lib/gameCommands.js', e);
    /* idem */
  }
  try {
    // Config (volumen, color del avatar, branding…): el DUENO del criterio es su
    // resolutor, no una lista propia. Defecto real (portal): con una partida
    // activa, "cambia el color del avatar" y "sube el volumen" caian al ultimo
    // paso como respuesta del jugador y el juego los consumia: no se podia
    // ejecutar ningun comando de configuracion durante la partida.
    if (resolveConfigCommandFromText(text)) return true
  } catch (e) {
        logCaughtError('[catch] src/voice/lib/gameCommands.js', e);
    /* idem */
  }
  try {
    // Navegacion DECLARADA (wikipedia/educar/youtube): su dueno es el resolutor de
    // comandos de voz. Sin esto, "abre youtube" con la loteria activa se consumia
    // como respuesta del jugador y la navegacion nunca se ejecutaba.
    if (resolveNavigationCommand(text)) return true
  } catch (e) {
        logCaughtError('[catch] src/voice/lib/gameCommands.js', e);
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
    if (END_GAME_FRAMES.some((frame) => hasVoiceToken(normalized, frame))) {
      return { gameId: activeSession.id, action: 'end' }
    }
    // 2. Pide el menú de juegos.
    if (GAME_MENU_FRAMES.some((frame) => hasVoiceToken(normalized, frame))) {
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
    // 3b. Arranque del juego QUE YA ESTA ACTIVO ("vamos a jugar loteria" con la
    //     loteria en curso). Es una ORDEN de arranque, NO una accion de partida:
    //     si llega al motor, el motor la consume como respuesta y, cuando el
    //     nombre del juego es tambien su frame de victoria ("!loteria!"), declara
    //     ganador con UNA sola carta cantada. Se resuelve como `start` (arranque
    //     explicito del juego pedido). El dueno unico del criterio "es arranque"
    //     es matchGameIntent (frame de juego + alias): el MISMO que la ruta sin
    //     partida activa, sin listas propias.
    if (intent) {
      return { gameId: activeSession.id, action: 'start' }
    }
    const engine = getGameEngine(activeSession.id)
    // 4. Comando propio del juego (pista, paso, "la tengo"…): siempre turno,
    //    aunque empiece como pregunta. VA ANTES del nombre pelado: en la lotería,
    //    "loteria" es SU comando (canto/ganador) y no un cambio de juego.
    if (engine && engine.isGameCommand(text)) {
      return { gameId: activeSession.id, action: 'turn', playerText: text }
    }
    // 4b. Nombre PELADO de OTRO juego ("trivia" mientras juegas lotería): es una
    //     orden de cambio, no una jugada. Si fuera del juego activo, el motor la
    //     consumiría como respuesta y no cambiaría nunca.
    const bareIntent = matchGameAliasOnly(text)
    if (bareIntent && bareIntent.id !== activeSession.id) {
      return { gameId: bareIntent.id, action: 'switch' }
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
  // Nombre PELADO: respuesta al menú de juegos ("¿a cuál te gustaría jugar?" →
  // "cuenta conmigo"). Sin esto, ningún dominio lo resolvía y la IA simulaba el
  // arranque sin partida real (bug del portal 11:27).
  const bareIntent = matchGameAliasOnly(text)
  if (bareIntent) return { gameId: bareIntent.id, action: 'start' }

  // Nada → no es un juego.
  return null
}
