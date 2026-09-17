/**
 * Contrato escucha en conversación:
 * - Interino → preview («Última frase»), nunca fila en el log
 * - Final → único commit al log + sesión archivada
 */
import { cleanForSpeech } from './audioMath.js'
import { phrasesEquivalent } from './activeListen.js'
import {
  archiveCommittedTurn,
  processListenPacket,
  resolveLogRowAction,
  shouldRefreshStream,
} from './conversationStream.js'
import { wouldShrinkLog } from './speechMerge.js'

export function createTurnStreamState() {
  return {
    published: '',
    preview: '',
    openPreview: false,
    lastEmitted: '',
  }
}

/** Procesa interino: actualiza motor ASR + preview, sin tocar el log. */
export function applyMicPreview(
  turn,
  listenState,
  { interim = '', turnBoundary = false, priorRows = [], shrinkContext = {} } = {},
) {
  const packet = processListenPacket(listenState, turn.published, {
    interim,
    turnBoundary,
    priorRows,
  })
  const capture = cleanForSpeech(
    packet.published || readTurnLive(listenState) || interim,
  )
  if (!capture) {
    return { changed: false, packet, preview: turn.preview }
  }

  if (
    !packet.freshUtterance &&
    !turnBoundary &&
    wouldShrinkLog(capture, turn.preview, shrinkContext)
  ) {
    turn.published = capture.length >= turn.published.length ? capture : turn.published
    turn.preview = turn.published
    turn.openPreview = true
    return { changed: true, packet, preview: turn.preview }
  }

  turn.published = capture
  turn.preview = capture
  turn.openPreview = true
  return { changed: true, packet, preview: capture }
}

/** Resuelve acción de fila al cerrar turno (solo final / onend). */
export function resolveMicCommitAction(
  turn,
  {
    capture = '',
    newParagraph = false,
    turnBoundary = false,
    lastCommitted = '',
    logRowContext = {},
  } = {},
) {
  return resolveLogRowAction({
    activeLogStream: false,
    newParagraph,
    turnBoundary,
    turnCommit: true,
    lastEmitted: turn.lastEmitted,
    lastCommitted,
    capture,
    logRowContext,
  })
}

/**
 * Re-emisión del mismo turno ya cerrado: la MISMA frase vuelve a commitearse
 * sin que haya llegado un nuevo resultado de reconocimiento desde el último
 * commit (doble `onend` / doble dispatch de la misma línea cerrada). El
 * discriminador es determinista, sin ventanas de tiempo: si hubo habla nueva,
 * `lastResultAt > lastCommitAt`. Preserva "pausa ⇒ fila nueva" (ahí el nuevo
 * resultado llega DESPUÉS del commit).
 */
export function isDuplicateTurnCommit(
  capture,
  { lastEmitted = '', lastCommitted = '', lastResultAt = 0, lastCommitAt = 0 } = {},
) {
  if (!capture || !lastCommitAt) return false
  if (lastResultAt > lastCommitAt) return false
  const prior = lastEmitted || lastCommitted
  if (!prior) return false
  return phrasesEquivalent(capture, prior)
}

/** Cierra preview tras commit exitoso. */
export function finalizeMicPreview(turn) {
  turn.published = ''
  turn.preview = ''
  turn.openPreview = false
}

/** Archiva turno en sesión interna y devuelve si el texto de fila cambió. */
export function archiveMicSession(listenState, capture, { maxChars } = {}) {
  const text = cleanForSpeech(capture)
  if (!text) return false
  archiveCommittedTurn(listenState, text, { maxChars })
  return true
}

export function shouldEmitMicCommit(lastEmitted, capture) {
  return shouldRefreshStream(lastEmitted, capture)
}
