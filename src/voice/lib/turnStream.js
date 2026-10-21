/**
 * Contrato escucha en conversación:
 * - Interino → preview («Última frase»), nunca fila en el log
 * - Final → único commit al log + sesión archivada
 */
import { cleanForSpeech, speechWords, stripDiacritics } from './audioMath.js'
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
/** Minimo de compactos del trozo para aceptar una REVISION (una frase corta no). */
const REVISION_MIN_COMPACT = 40
/** Cobertura minima del tramo contiguo comun sobre el trozo (medido: 0.910 y 0.859). */
const REVISION_MIN_COVERAGE = 0.8
/** Tope de celdas de la DP; por encima se conserva solo la via exacta. */
const REVISION_MAX_PAIR_CELLS = 1000000

/** Texto de comparacion: sin acentos, minusculas y solo alfanumericos. */
function compactForRevision(text = '') {
  return stripDiacritics(cleanForSpeech(text)).replace(/[^a-z0-9]+/g, '')
}

/**
 * Longitud del tramo CONTIGUO mas largo comun a `a` y `b` (subcadena, no
 * subsecuencia: "comer plato" NO es trozo de "vamos a comer del plato",
 * aunque las palabras aparezcan en ese orden).
 */
function longestCommonRun(a = '', b = '') {
  if (!a || !b) return 0
  let best = 0
  let prev = new Uint32Array(b.length + 1)
  let cur = new Uint32Array(b.length + 1)
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      } else {
        cur[j] = 0
      }
    }
    const swap = prev
    prev = cur
    cur = swap
  }
  return best
}

/**
 * P11.20 (medido en su log 2026-10-19 21:18/21:19): Chrome re-entrega la COLA de
 * una locucion ya emitida como REVISION —re-oye el limite con otra palabra
 * ("con que hablante lo pone" -> "con que habla te lo pone")— y la contiguidad
 * EXACTA de palabras deja de reconocerla: la cola se escribio como fila nueva
 * (430+112 y 468+270 en su pantalla). Una revision es la MISMA locucion si su
 * tramo contiguo comun cubre >=80% del trozo. Se exige trozo largo (>=40
 * compactos) para que una frase nueva y corta no pueda cumplirlo por azar.
 */
function isAsrRevisionOfLocution(part = '', whole = '') {
  const cp = compactForRevision(part)
  const cw = compactForRevision(whole)
  if (cp.length < REVISION_MIN_COMPACT || cp.length >= cw.length) return false
  if (cp.length * cw.length > REVISION_MAX_PAIR_CELLS) return false
  return longestCommonRun(cp, cw) >= Math.ceil(cp.length * REVISION_MIN_COVERAGE)
}

/**
 * true si `part` es un FRAGMENTO de `whole`: contiguo exacto (todas sus palabras,
 * en orden y seguidas) o la REVISION del ASR de la misma locucion (tramo contiguo
 * comun >=80%). Un trozo del ASR a mitad de frase lo cumple; una frase nueva no.
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
  return isAsrRevisionOfLocution(part, whole)
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
  { lastEmitted = '', lastCommitted = '', lastResultAt = 0, lastCommitAt = 0, now = Date.now(), echoWindowMs = 0 } = {},
) {
  if (!capture || !lastCommitAt) return false
  const prior = lastEmitted || lastCommitted
  if (!prior) return false
  // P11.19 (medido en su log 2026-10-14 17:18): la COLA de una locucion YA ESCRITA llega como
  // SEGMENTO nuevo (Chrome reentrega el tramo) y quedaba en DOS filas ("se repitio esa frase",
  // su pantalla). Un texto CONTENIDO en la fila ya escrita no es habla nueva: es la misma
  // locucion reentregada -> no abre fila.
  if (isFragmentOfLocution(capture, prior)) return true
  const hayResultadoNuevo = lastResultAt > lastCommitAt
  // Un "resultado nuevo" con el MISMO texto DENTRO de la ventana de eco es el MISMO evento
  // re-entregado por el ASR (doble final ~0,3-0,7 s), no habla nueva: UNA locucion = UN commit.
  // Fuera de la ventana la repeticion es genuina del usuario y SI es un turno nuevo.
  if (hayResultadoNuevo && !(echoWindowMs > 0 && now - lastCommitAt < echoWindowMs)) return false
  return phrasesEquivalent(capture, prior)
}
