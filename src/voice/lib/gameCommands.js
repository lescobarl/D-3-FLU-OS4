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
import { isVisualRequestText } from './audioMath.js'
import { detectExplicitGenerationTipo } from './workspaceContract.js'
import { parseAgendaCommand } from '../../core/agenda/agendaCommandParser'
import { isNoteCommand } from './noteIntentParser'
import { resolveEnvironmentIntent } from '../../core/environments/environmentIntents'
import { parseShoppingIntent } from '../../core/reminders/shoppingIntentParser'
import { parseDiaryIntent } from '../../core/diary/diaryIntentParser'
import {
  matchGameIntent,
  matchGameAliasOnly,
  END_GAME_FRAMES,
  GAME_MENU_FRAMES,
  NON_GAME_REQUEST_FRAMES,
  getGameEngine,
  suppressesAmbient,
} from '../../core/games/gameCatalog'
import { getActiveGameSession, isGameSuspended } from '../../core/games/gameSessionStore'
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
 * ¿El texto lo RECLAMA otro dominio (no es una jugada del juego)?
 *
 * DUENO UNICO de la pregunta "¿de quién es este turno?". Con una partida activa,
 * un texto reclamado por otro dominio NO puede consumirse como respuesta del
 * jugador: si el motor lo consume, el juego responde POR ENCIMA del dueño real
 * (defecto medido: "okay flow genera una imagen" con la lotería activa generaba
 * la imagen y además el motor cantaba "La carta es…"; una cita CON hora se
 * creaba y el motor respondía su carta igual) y el turno se produce dos veces
 * (el motor y la IA), duplicando la fila de la locución.
 *
 * La respuesta la da el DUENO de cada dominio (su resolutor), nunca una lista
 * paralela que se desvía: configuración, navegación/generación de
 * video-documento, petición visual (imagen/foto), ambiente, agenda, compras,
 * diario y notas. Se importan los resolutores (no el árbitro) para no crear un
 * ciclo: el árbitro importa este módulo.
 *
 * @param {string} text Texto del turno (crudo o ya limpio).
 * @param {{ language?: string, now?: number }} [options] Idioma y marca de tiempo
 *   que esperan los resolutores de ambiente, agenda y diario.
 * @returns {boolean} true si otro dominio reclama el turno.
 */
export function isClaimedByOtherDomain(text = '', options = {}) {
  const { language = 'es', now } = options || {}
  const owned = (intent) => Boolean(intent?.handled && intent.action)
  const run = (owner) => {
    try {
      return Boolean(owner())
    } catch (e) {
      logCaughtError('[catch] src/voice/lib/gameCommands.js', e)
      /* un resolutor sin match no debe romper el juego */
      return false
    }
  }
  return (
    // Agenda: crear, editar, cancelar. Dueño: su parser. Reclama también la
    // creación PENDIENTE (reconocida por su `kind` pero sin instante): no es una
    // jugada — la atiende el carril conversacional, que pide la hora.
    run(() => {
      const cmd = parseAgendaCommand(text, { now })
      return owned(cmd) || Boolean(cmd?.action && cmd?.kind)
    })
    // Notas: alta Y borrado (predicado único del parser).
    || run(() => isNoteCommand(text))
    // Configuración: volumen, color del avatar, branding…
    || run(() => resolveConfigCommandFromText(text))
    // Navegación declarada + generación de video/documento pedida tal cual.
    || run(() => resolveNavigationCommand(text))
    || run(() => detectExplicitGenerationTipo(text))
    // Petición visual (imagen/foto/ilustración/diagrama). Dueño: el predicado
    // visual del audio; su generación corre por el carril de workspace.
    || run(() => isVisualRequestText(text))
    // Ambiente (activar/reset).
    || run(() => resolveEnvironmentIntent(text, language)?.tipo)
    // Lista de compras.
    || run(() => owned(parseShoppingIntent(text)))
    // Diario.
    || run(() => owned(parseDiaryIntent(text, { language })))
  )
}

/**
 * Deriva un contrato `juego` determinista a partir del texto transcrito.
 * Retorna `null` si no hay evento de juego resoluble (guardia estricta).
 *
 * Orden de resolución con partida ACTIVA (evita secuestrar la conversación):
 *   1. Frase de salida            → `end`
 *   2. Pide el menú de juegos     → `menu`
 *   3. Pide OTRO juego concreto   → `switch` (cerrar el actual y abrir el nuevo)
 *   4. OTRO dominio lo reclama    → null (lo ejecuta su dueño; el juego no responde)
 *   5. Comando propio del juego   → `turn` (señal positiva del motor)
 *   6. Nombre pelado de otro juego→ `switch`
 *   7. Pregunta general           → null (la responde la IA, no el motor)
 *   7b. Partida EN PAUSA          → null salvo ORDEN de juego (que la retoma)
 *   8. Cualquier otra cosa        → `turn` (respuesta abierta del jugador)
 * El paso 4 VA ANTES del 5 porque los marcos del motor son tokens sueltos de
 * afirmación ("ok", "si", "vale"): sin él, "Okay Flow genera una imagen" era
 * leído como "canta la siguiente" y el juego respondía su carta.
 * Sin partida activa:
 *   1. Intención explícita de iniciar → `start`
 *   2. Nada                           → null
 */
export function resolveGameCommandFromText(text = '', options = {}) {
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
    // 4. Reclamado por OTRO dominio (imagen, generación, agenda, notas, compras,
    //    diario, ambiente, navegación, configuración) → NO es jugada: se deja
    //    pasar para que lo ejecute su dueño (la IA o el dominio) y el motor no
    //    responde por encima.
    //    VA ANTES de `engine.isGameCommand` (paso 5) porque esos marcos son
    //    TOKENS SUELTOS de afirmación ("ok", "si", "vale", "dale"): el prefijo de
    //    wake word "Okay Flow genera una imagen" llevaba el 'ok' y el motor lo leía
    //    como "canta la siguiente" (defecto medido en el log: el juego respondía su
    //    carta mientras la imagen se generaba por otro carril, y el turno salía
    //    duplicado). Orden nuevo, uno solo para TODOS los juegos.
    if (isClaimedByOtherDomain(text, options)) {
      return null
    }
    const engine = getGameEngine(activeSession.id)
    // 5. Comando propio del juego (pista, paso, "la tengo"…): siempre turno,
    //    aunque empiece como pregunta. VA ANTES del nombre pelado: en la lotería,
    //    "loteria" es SU comando (canto/ganador) y no un cambio de juego.
    if (engine && engine.isGameCommand(text)) {
      return { gameId: activeSession.id, action: 'turn', playerText: text }
    }
    // 5b. Nombre PELADO de OTRO juego ("trivia" mientras juegas lotería): es una
    //     orden de cambio, no una jugada. Si fuera del juego activo, el motor la
    //     consumiría como respuesta y no cambiaría nunca.
    const bareIntent = matchGameAliasOnly(text)
    if (bareIntent && bareIntent.id !== activeSession.id) {
      return { gameId: bareIntent.id, action: 'switch' }
    }
    // 6. Petición general (pregunta o "platícame de…") → la responde la IA.
    //    Genérico: mismo criterio para cualquier juego activo (rompe el ciclo).
    const clean = normalized.replace(/^[^a-z0-9]+/, '')
    if (isQuestionLike(clean) || startsWithFrame(clean, NON_GAME_REQUEST_FRAMES)) {
      return null
    }
    // 7. Respuesta abierta del jugador (el motor decide si es correcta), SIEMPRE
    //    que la partida no esté en PAUSA. En pausa la partida no consume el turno:
    //    el turno es de su dueño real (otra orden, o la IA si es una frase suelta),
    //    y la partida se retoma con CUALQUIERA de sus órdenes (pasos 1-5b: salir,
    //    menú, cambio de juego, arranque del mismo juego, comandos del motor), no
    //    con una respuesta suelta: así el juego no "bate la conversación" cuando el
    //    usuario está en otro asunto. La pausa la aplica noteGameTurn (hook).
    if (isGameSuspended()) return null
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
