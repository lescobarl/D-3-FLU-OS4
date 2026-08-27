/**
 * Despachador inmutable del log: filas finales con hablante congelado; texto revisable por ASR.
 */
import { cleanForSpeech } from './audioMath.js'
import { phrasesEquivalent } from './activeListen.js'
import {
  createConversationRow,
  mergeCommittedRowUpdate,
  normalizeConversationRow,
  patchConversationRowSpeaker,
} from './conversationRow.js'
import { rowDuplicatesPrior } from './conversationStream.js'
import { scheduleDeferredLogWrite } from './conversationCommitScheduler.js'

export function formatCompactLogText(value = '') {
  return cleanForSpeech(String(value || ''))
}

export function isExactDuplicateRow(previous, next) {
  if (!previous?.id || !next?.id) return false
  if (previous.speakerId !== next.speakerId) return false
  if (previous.speakerName !== next.speakerName) return false
  return formatCompactLogText(previous.text) === formatCompactLogText(next.text)
}

/**
 * @param {Array} rows
 * @param {{
 *   row?: object,
 *   replaceLast?: boolean,
 *   streamUpdate?: boolean,
 *   patchSpeaker?: object,
 * }} event
 */
export function applyConversationLogEvent(rows = [], event = {}) {
  const list = Array.isArray(rows) ? rows : []

  if (event.patchSpeaker?.rowId) {
    const { rowId, speakerId, speakerName, signature, manualRename } = event.patchSpeaker
    if (!manualRename) return list
    let patched = false
    const next = list.map((entry) => {
      const row = normalizeConversationRow(entry)
      if (!row || row.id !== rowId) return entry
      patched = true
      return patchConversationRowSpeaker(row, {
        speakerId,
        speakerName,
        signature,
        force: true,
      })
    })
    return patched ? next : list
  }

  const incoming = event.row ? normalizeConversationRow(event.row) : null
  if (!incoming?.text) return list

  if (event.replaceLast && list.length) {
    const prev = normalizeConversationRow(list[list.length - 1]) || list[list.length - 1]
    if (
      event.streamUpdate &&
      formatCompactLogText(prev.text) === formatCompactLogText(incoming.text)
    ) {
      return list
    }
    const next = [...list]
    next[next.length - 1] = mergeCommittedRowUpdate(prev, incoming)
    return next
  }

  const prev = list.length ? normalizeConversationRow(list[list.length - 1]) : null
  if (prev && isExactDuplicateRow(prev, incoming)) return list
  if (
    prev &&
    rowDuplicatesPrior(formatCompactLogText(prev.text), formatCompactLogText(incoming.text))
  ) {
    const next = [...list]
    next[next.length - 1] = mergeCommittedRowUpdate(prev, incoming)
    return next
  }

  return [...list, incoming]
}

export function buildIncomingRow({
  text,
  speakerId,
  speakerName,
  isFinal = true,
  id,
  timestamp,
  signature = null,
}) {
  return createConversationRow({
    text,
    speakerId,
    speakerName,
    isFinal,
    id,
    timestamp,
    signature,
  })
}

/**
 * Commit FINAL: escribe fila sin bloquear hilo de captura.
 */
export function dispatchConversationLogCommit({ rows = [], event = {}, onApplied } = {}) {
  const next = applyConversationLogEvent(rows, event)
  if (typeof onApplied === 'function') {
    scheduleDeferredLogWrite(() => onApplied(next, event))
  }
  return next
}
