// ============================================================
// FLU OS4 — Resolución determinista de comandos de juego por voz
// ============================================================
// Complemento 100% local y determinista del flujo `juego` (fast-path):
// cuando el niño dice "ok flu, juguemos a las adivinanzas", este módulo
// deriva el contrato a partir del texto transcrito SIN depender de Gemini.
//
// - Única fuente de verdad: gameCatalog (matchGameIntent) + gameSessionStore.
// - Sin rutas dobles: el resultado se inyecta como `contract.juego` y se
//   despacha por la ÚNICA ruta existente (App.tsx applyGameAction).
// - Guardia estricta: requiere partida activa O intención de inicio resuelta.
//   Sin partida activa, "simón dice que te calles" NO inicia nada.
// ============================================================

import { normalizeForMatch, hasToken } from './configCommands.js'
import { matchGameIntent } from '../../core/games/gameCatalog'
import { getActiveGameSession } from '../../core/games/gameSessionStore'

// ------------------------------------------------------------
// Frases de salida / control de una partida activa
// ------------------------------------------------------------
// Solo se evalúan cuando hay partida activa (nunca disparan en solitario).

const END_GAME_FRAMES = Object.freeze([
  'salir del juego',
  'terminar el juego',
  'dejar de jugar',
  'ya no quiero jugar',
  'cerrar el juego',
  'terminemos',
  'ya basta',
  'se acabo',
])

// ------------------------------------------------------------
// Resolución determinista texto → evento de juego
// ------------------------------------------------------------

/**
 * Deriva un contrato `juego` determinista a partir del texto transcrito.
 * Retorna `null` si no hay evento de juego resoluble (guardia estricta).
 *
 * Orden de resolución (espejo de resolveConfigCommandFromText):
 *   1. ¿Partida activa? → `end` (frase de salida) o `turn` (responder).
 *   2. ¿Intención de iniciar? → `matchGameIntent` → `start`.
 *   3. Nada → null (no es un juego; Gemini arbitra la conversación).
 */
export function resolveGameCommandFromText(text = '') {
  const normalized = normalizeForMatch(text)
  if (!normalized) return null

  const activeSession = getActiveGameSession()

  if (activeSession) {
    // 1a. Frase de salida → terminar la partida activa.
    if (END_GAME_FRAMES.some((frame) => hasToken(normalized, frame))) {
      return { gameId: activeSession.id, action: 'end' }
    }
    // 1b. Cualquier otra cosa con partida activa = turno del jugador.
    //     En modo conversación el niño responde SIN wake word.
    return { gameId: activeSession.id, action: 'turn', playerText: text }
  }

  // 2. Sin partida activa: solo inicia si hay intención explícita y resoluble.
  const intent = matchGameIntent(text)
  if (intent) return { gameId: intent.id, action: 'start' }

  // 3. Nada → no es un juego.
  return null
}
