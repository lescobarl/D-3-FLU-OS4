import { cleanForSpeech } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import {
  getTranscriptDelta as getTranscriptDeltaFromBoundary,
  mergeTranscriptText,
} from './transcriptDelta.js'

/** Estado de un turno de escucha: confirmado (finales) + interino (preview). */
export function createTurnState() {
  return { confirmed: '', interim: '' }
}

export function resetTurnState(state) {
  state.confirmed = ''
  state.interim = ''
}

/** Integra un fragmento final del reconocimiento (maneja finales acumulativos del navegador). */
export function mergeFinalChunk(confirmed = '', finalChunk = '') {
  const base = cleanForSpeech(confirmed)
  const chunk = cleanForSpeech(finalChunk)
  if (!chunk) return base
  if (!base) return chunk
  if (chunk === base) return base
  if (chunk.startsWith(base)) return chunk
  if (base.endsWith(chunk)) return base
  return mergeTranscriptText(base, chunk)
}

/** Texto visible del turno: confirmado + cola interina (el interino reemplaza preview, no borra confirmado). */
export function getTurnDisplay(state) {
  const confirmed = cleanForSpeech(state?.confirmed || '')
  const interim = cleanForSpeech(state?.interim || '')
  if (!confirmed) return interim
  if (!interim) return confirmed
  if (interim.startsWith(confirmed)) return interim
  if (confirmed.includes(interim)) return confirmed
  return mergeTranscriptText(confirmed, interim)
}

/** Quita de un fragmento del navegador lo ya registrado en sesión. */
export function stripCommittedPrefix(boundary = '', chunk = '') {
  const session = cleanForSpeech(boundary)
  const text = cleanForSpeech(chunk)
  if (!text) return ''
  if (!session) return text
  if (text === session) return ''
  if (text.startsWith(session)) return cleanForSpeech(text.slice(session.length))
  return getTranscriptDelta(session, text)
}

/** Aplica onresult ignorando texto ya registrado en el log de sesión. */
export function applyRecognitionResultWithBoundary(
  state,
  { finalText = '', interimText = '', committedBoundary = '' } = {},
) {
  const finalChunk = stripCommittedPrefix(committedBoundary, finalText)
  const interimChunk = stripCommittedPrefix(committedBoundary, interimText)

  if (!finalChunk && !interimChunk) {
    return getTurnDisplay(state)
  }

  return applyRecognitionResult(state, {
    finalText: finalChunk,
    interimText: interimChunk,
  })
}

/** Colapsa repeticiones encadenadas del ASR ("frase frase" o "a b c a b c"). */
export function collapseStutterRepeat(text = '', minWords = 2) {
  let value = cleanForSpeech(text)
  if (!value) return value

  for (let pass = 0; pass < 3; pass += 1) {
    const next = collapseStutterPass(value, minWords)
    if (next === value) break
    value = next
  }
  return value
}

function collapseStutterPass(text = '', minWords = 2) {
  const value = cleanForSpeech(text)
  if (!value) return value

  const words = value.split(/\s+/)
  if (words.length < minWords * 2) return value

  const collapsed = []
  let index = 0

  while (index < words.length) {
    let unitLen = 0
    const maxUnit = Math.min(12, Math.floor((words.length - index) / 2))

    for (let unit = maxUnit; unit >= minWords; unit -= 1) {
      const left = words.slice(index, index + unit)
      const right = words.slice(index + unit, index + unit + unit)
      if (
        left.length === unit &&
        right.length === unit &&
        left.join(' ').toLowerCase() === right.join(' ').toLowerCase()
      ) {
        unitLen = unit
        break
      }
    }

    if (!unitLen) {
      collapsed.push(words[index])
      index += 1
      continue
    }

    collapsed.push(...words.slice(index, index + unitLen))
    index += unitLen
    while (index + unitLen <= words.length) {
      const prev = collapsed.slice(-unitLen).join(' ').toLowerCase()
      const next = words.slice(index, index + unitLen).join(' ').toLowerCase()
      if (prev === next) {
        index += unitLen
      } else {
        break
      }
    }
  }

  return cleanForSpeech(collapsed.join(' '))
}

export function normalizeTranscriptText(text = '') {
  return collapseStutterRepeat(collapseInlineRepeat(text, 24), 2)
}

/**
 * §9.2 — Captura canónica del turno para commit: UNA sola normalización.
 * En conversación basta `cleanForSpeech`; fuera de conversación se colapsa
 * además el eco/repetición. Único punto que decide la normalización del motor.
 */
export function normalizeTurnCapture(turnCapture = '', { conversationActive = false } = {}) {
  return conversationActive ? cleanForSpeech(turnCapture) : normalizeTranscriptText(turnCapture)
}

/** Colapsa párrafos repetidos consecutivos (ASR tras pausa). */
export function collapseInlineRepeat(text = '', minRepeatChars = 32) {
  const value = cleanForSpeech(text)
  if (value.length < minRepeatChars * 2) return value

  for (let size = Math.floor(value.length / 2); size >= minRepeatChars; size -= 1) {
    const tail = value.slice(-size)
    const beforeTail = value.slice(0, -size).trim()
    if (!tail || !beforeTail) continue
    if (beforeTail.endsWith(tail) || beforeTail.endsWith(tail.trim())) {
      return cleanForSpeech(beforeTail)
    }
  }

  return value
}

/** Aplica un evento onresult al estado del turno. Retorna el texto visible. */
export function applyRecognitionResult(state, { finalText = '', interimText = '' } = {}) {
  if (finalText) {
    state.confirmed = mergeFinalChunk(state.confirmed, cleanForSpeech(finalText))
    state.interim = ''
  } else if (interimText) {
    state.interim = monotonicDisplay(state.interim, cleanForSpeech(interimText))
  }
  return getTurnDisplay(state)
}

/**
 * Solo crece por prefijo — nunca reemplaza por un texto diverso del ASR.
 * Evita que "…casti" salte a "…apunta" cuando Chrome reescribe el interino.
 */
export function monotonicDisplay(previous = '', next = '') {
  const prev = cleanForSpeech(previous)
  const nxt = cleanForSpeech(next)
  if (!nxt) return prev
  if (!prev) return nxt
  if (nxt.startsWith(prev)) return nxt
  if (prev.startsWith(nxt)) return prev
  return prev
}

/**
 * Calcula qué texto nuevo registrar en el log del turno actual.
 * lastLoggedCapture = acumulado del mismo turno (finales acumulativos del navegador).
 * Tras cada commit de turno, lastLoggedCapture se reinicia a ''.
 */
export function prepareLogCommit(lastLoggedCapture = '', turnCapture = '') {
  const capture = cleanForSpeech(turnCapture)
  if (!capture) return null

  const previous = cleanForSpeech(lastLoggedCapture)
  if (!previous) {
    return { logText: capture, loggedCapture: capture }
  }
  if (capture === previous) return null
  const logText = getTranscriptDeltaFromBoundary(previous, capture)
  if (!logText) return null
  return { logText, loggedCapture: capture }
}

/** Promueve interino a confirmado antes del commit (si el navegador no emitió final a tiempo). */
export function sealInterimForCommit(state) {
  if (!state?.interim) return
  state.confirmed = mergeFinalChunk(state.confirmed, state.interim)
  state.interim = ''
}

/** Texto listo para commit: sella interino + spill + confirmado. */
export function readTurnCaptureForCommit(state, pendingSpill = '') {
  sealInterimForCommit(state)
  return getTurnCommitText(state, pendingSpill)
}

/** Texto estable: spill + confirmado (sin interino). */
export function getTurnCommitText(state, pendingSpill = '') {
  const spill = cleanForSpeech(pendingSpill)
  const confirmed = cleanForSpeech(state?.confirmed || '')
  if (!spill) return confirmed
  if (!confirmed) return spill
  if (confirmed.startsWith(spill) || spill.startsWith(confirmed)) {
    return confirmed.length >= spill.length ? confirmed : spill
  }
  return mergeTranscriptText(spill, confirmed)
}

// Dueño canónico: transcriptDelta.js. Se re-exporta para no duplicar.
export { getTranscriptDelta } from './transcriptDelta.js'

/** @deprecated Usar getTurnCommitText / appendSpillText. Conservado por compatibilidad temporal. */
export function mergeCaptureText(...parts) {
  return appendSpillText(...parts)
}

/** Une spill y fragmentos conservando prefijos acumulativos del reconocedor. */
export function appendSpillText(...parts) {
  const cleaned = parts.map((part) => cleanForSpeech(part)).filter(Boolean)
  if (!cleaned.length) return ''
  return cleaned.reduce((merged, current) => mergeTranscriptText(merged, current), '')
}

/** Elimina de `pending` cualquier prefijo ya registrado en el log. */
export function stripLoggedPrefix(loggedCapture = '', pending = '') {
  const logged = cleanForSpeech(loggedCapture)
  const remainder = cleanForSpeech(pending)
  if (!remainder) return ''
  if (!logged) return remainder
  return getTranscriptDeltaFromBoundary(logged, remainder)
}

/** Espera a que el texto de captura deje de cambiar antes de registrar el turno. */
export async function waitForCaptureSettle(readCapture, timing = FLU_CONFIG.timing) {
  const stepMs = timing.transcriptSettleStepMs
  const stableMs = timing.transcriptSettleStableMs
  const maxMs = timing.transcriptSettleMaxMs

  let previous = cleanForSpeech(readCapture())
  let stableSince = Date.now()
  const deadline = Date.now() + maxMs

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, stepMs))
    const next = cleanForSpeech(readCapture())
    if (next !== previous) {
      previous = next
      stableSince = Date.now()
    } else if (Date.now() - stableSince >= stableMs) {
      return previous
    }
  }
  return previous
}
