/**
 * Contrato escucha en conversación:
 * - Interino → preview («Última frase»), nunca fila en el log
 * - Final → único commit al log + sesión archivada
 */
import { cleanForSpeech, speechWords } from './audioMath.js'
import { phrasesEquivalent, wouldShrinkListenLog } from './activeListen.js'
import {
  processListenPacket,
  readTurnLive,
  resolveLogRowAction,
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
/**
 * Fila == ultima frase mostrada.
 *
 * El preview bloquea el recorte por ruido ASR (wouldShrinkListenLog), pero el
 * commit escribia el texto RECORTADO: la fila quedaba mas corta que lo ultimo
 * mostrado y se perdia la cola ("...del centro" -> "..."), de modo que la ultima
 * frase y la fila divergian. Se decide con el MISMO predicado del preview: fila y
 * ultima frase son el mismo texto.
 *
 * No afecta a las extensiones ("intervencion" -> "intervencion 2"): eso es
 * crecimiento y la guarda deja pasar.
 */
/**
 * true si `part` es un FRAGMENTO CONTIGUO de `whole` (todas sus palabras, en orden y
 * seguidas). Un trozo del ASR a mitad de frase lo cumple; una frase nueva no.
 */
export function isFragmentOfLocution(part = '', whole = '') {
  const p = speechWords(part)
  const w = speechWords(whole)
  if (!p.length || p.length >= w.length) return false
  for (let i = 0; i + p.length <= w.length; i += 1) {
    let ok = true
    for (let j = 0; j < p.length; j += 1) {
      if (p[j] !== w[i + j]) { ok = false; break }
    }
    if (ok) return true
  }
  return false
}

/**
 * B4 - DUENO UNICO de la RECOMPOSICION de la locucion: si `part` es un trozo de la
 * locucion completa (`whole`), manda la completa; nunca se commitea un fragmento cortado.
 * Si no lo es, se conserva `part` (es habla nueva).
 *
 * @param {string} part Texto candidato (captura cruda o lo mostrado).
 * @param {string} whole Locucion completa (ultimo mostrado / texto validado del turno).
 * @returns {string}
 */
export function recomposeLocution(part = '', whole = '') {
  const candidato = cleanForSpeech(part)
  const completa = cleanForSpeech(whole)
  if (!candidato) return completa
  if (!completa || completa.length <= candidato.length) return candidato
  return isFragmentOfLocution(candidato, completa) ? completa : candidato
}

export function reconcileCommitText(capture = '', shown = '') {
  const reconciliado = wouldShrinkListenLog(capture, shown) ? shown : capture
  // B4: fila y ultima frase son la locucion COMPLETA, tambien cuando el ASR corta el turno
  // en un trozo del medio ("a comer del" -> "vamos a comer del plato").
  return recomposeLocution(reconciliado, shown)
}

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
