/**
 * Turnos de conversación: un participante = una fila en log + contexto Gemini.
 * Flu usa el mismo mecanismo que Hablante 1, 2, … (sin canal paralelo).
 */
import { cleanForSpeech } from './audioMath.js'
import { phrasesEquivalent } from './activeListen.js'
import { utterancesRelate } from './conversationStream.js'
import { FLU_CONFIG } from './fluConfig.js'

export const FLU_DIALOGUE_SPEAKER = 'Flu'

export const DIALOGUE_SOURCE = Object.freeze({
  LOG: 'log',
  QUERY: 'query',
  PARTICIPANT: 'participant',
  CAPTURE: 'capture',
})

export function isFluSpeaker(speaker = '') {
  return String(speaker || '').trim() === FLU_DIALOGUE_SPEAKER
}

export function resolveDialogueRole(speaker = '') {
  return isFluSpeaker(speaker) ? 'assistant' : 'user'
}

export function trimDialogueHistory(history = [], max = FLU_CONFIG.limits.contextHistoryMax) {
  const limit = Number(max)
  if (!Number.isFinite(limit) || limit <= 0) return [...history]
  return history.length <= limit ? [...history] : history.slice(-limit)
}

function trimLogRows(texts = [], speakers = [], maxRows = FLU_CONFIG.limits.priorRowsMax) {
  const limit = Number(maxRows)
  if (!Number.isFinite(limit) || limit <= 0) return
  while (texts.length > limit) {
    texts.shift()
    speakers.shift()
  }
}

export function appendDialogueEntry(history = [], entry = {}, max = FLU_CONFIG.limits.contextHistoryMax) {
  // OS4: incluye respuesta_voz — las respuestas de Gemini llegan bajo ese campo
  // en el contrato y, si se conserva esa forma, debe persistirse igual que text.
  const text = cleanForSpeech(entry.text || entry.transcript || entry.response || entry.respuesta_voz || '')
  if (!text) return [...history]

  const speaker =
    String(entry.speaker || '').trim() ||
    (entry.role === 'assistant' ? FLU_DIALOGUE_SPEAKER : 'Hablante 1')

  const normalized = {
    role: entry.role === 'assistant' || isFluSpeaker(speaker) ? 'assistant' : 'user',
    speaker,
    text,
    phase: entry.phase || 'SESION_ACTIVA',
    source: entry.source || DIALOGUE_SOURCE.LOG,
  }

  return trimDialogueHistory([...history, normalized], max)
}

function appendDialogueTurn(
  history = [],
  { speaker, text, phase = 'SESION_ACTIVA', source = DIALOGUE_SOURCE.LOG } = {},
  max = FLU_CONFIG.limits.contextHistoryMax,
  { replaceLast = false } = {},
) {
  const cleaned = cleanForSpeech(text)
  if (!cleaned) return [...history]

  if (isFluSpeaker(speaker)) {
    return appendDialogueEntry(
      history,
      { role: 'assistant', speaker: FLU_DIALOGUE_SPEAKER, text: cleaned, phase, source },
      max,
    )
  }

  const speakerLabel = String(speaker || '').trim() || 'Hablante 1'
  const last = history[history.length - 1]

  if (replaceLast && last?.role === 'user' && last.speaker === speakerLabel) {
    return trimDialogueHistory(
      [...history.slice(0, -1), { ...last, text: cleaned, phase, source }],
      max,
    )
  }

  if (last?.role === 'user' && last.speaker === speakerLabel) {
    if (phrasesEquivalent(last.text, cleaned)) return [...history]
    if (utterancesRelate(last.text, cleaned)) {
      return trimDialogueHistory(
        [...history.slice(0, -1), { ...last, text: cleaned, phase, source }],
        max,
      )
    }
  }

  return appendDialogueEntry(
    history,
    { role: 'user', speaker: speakerLabel, text: cleaned, phase, source },
    max,
  )
}

/**
 * Registra un turno en log de sesión (texts/speakers) y en contexto Gemini (dialogue).
 * Mutates logTexts/logSpeakers in place; returns new dialogue array.
 */
export function recordConversationTurn(
  logTexts,
  logSpeakers,
  dialogueHistory = [],
  { speaker, text, phase = 'SESION_ACTIVA', source = DIALOGUE_SOURCE.LOG } = {},
  {
    replaceLast = false,
    maxLogRows = FLU_CONFIG.limits.priorRowsMax,
    maxDialogue = FLU_CONFIG.limits.contextHistoryMax,
  } = {},
) {
  const cleaned = cleanForSpeech(text)
  if (!cleaned) return dialogueHistory

  const speakerLabel = String(speaker || '').trim() || 'Hablante 1'
  const lastText = logTexts[logTexts.length - 1] || ''

  if (replaceLast && logTexts.length && utterancesRelate(lastText, cleaned)) {
    logTexts[logTexts.length - 1] = cleaned
    logSpeakers[logSpeakers.length - 1] = speakerLabel
  } else if (!lastText || !phrasesEquivalent(lastText, cleaned)) {
    logTexts.push(cleaned)
    logSpeakers.push(speakerLabel)
  }

  trimLogRows(logTexts, logSpeakers, maxLogRows)

  return appendDialogueTurn(
    dialogueHistory,
    { speaker: speakerLabel, text: cleaned, phase, source },
    maxDialogue,
    { replaceLast },
  )
}

export function recordConversationExchange(
  logTexts,
  logSpeakers,
  dialogueHistory = [],
  {
    user,
    assistant,
    phase = 'SESION_ACTIVA',
    userSource = DIALOGUE_SOURCE.QUERY,
    assistantSource = DIALOGUE_SOURCE.QUERY,
  } = {},
  limits = {},
) {
  let nextDialogue = dialogueHistory
  if (user?.text) {
    nextDialogue = recordConversationTurn(
      logTexts,
      logSpeakers,
      nextDialogue,
      {
        speaker: user.speaker,
        text: user.text,
        phase,
        source: userSource,
      },
      { replaceLast: false, ...limits },
    )
  }
  if (assistant?.text) {
    nextDialogue = recordConversationTurn(
      logTexts,
      logSpeakers,
      nextDialogue,
      {
        speaker: FLU_DIALOGUE_SPEAKER,
        text: assistant.text,
        phase,
        source: assistantSource,
      },
      { replaceLast: false, ...limits },
    )
  }
  return nextDialogue
}

export function getDialogueContextSlice(history = [], max = FLU_CONFIG.limits.contextHistoryMax) {
  return trimDialogueHistory(history, max)
}

export function findLastFluDialogueTurn(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry?.role === 'assistant' && isFluSpeaker(entry?.speaker)) {
      return entry
    }
  }
  return null
}

/** Filas de audit log: pregunta/comando humano + respuesta Flu (sin campo response pegado). */
export function buildFluSpeechAuditRows({
  timestamp,
  humanSpeaker = '',
  humanTranscript = '',
  fluText = '',
  phase = 'SESION_ACTIVA',
  signature = null,
  navigation = {},
  navigationComando = null,
} = {}) {
  const rows = []
  const humanText = cleanForSpeech(humanTranscript)
  const fluSpeech = cleanForSpeech(fluText)

  if (humanText) {
    rows.push({
      timestamp,
      speaker: humanSpeaker || 'Hablante 1',
      transcript: humanText,
      response: '',
      navigation: { ...navigation, comando: navigationComando },
      phase,
      signature,
    })
  }

  if (fluSpeech) {
    rows.push({
      timestamp,
      speaker: FLU_DIALOGUE_SPEAKER,
      transcript: fluSpeech,
      response: '',
      navigation: { ...navigation, comando: null },
      phase,
      signature,
    })
  }

  return rows
}
