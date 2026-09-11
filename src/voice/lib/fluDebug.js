/**
 * Modo debug: checklist, invariantes y traza estructurada.
 * Encendible/apagable vía FLU_CONFIG.debug.enabled o __fluDev.debug.enable/disable().
 *
 * Contrato de performance:
 * - Producción: call sites usan `import.meta.env.DEV && debugHotPath` → eliminados en build.
 * - Dev apagado: debugHotPath === false → una sola lectura booleana, sin alloc ni I/O.
 * - Dev encendido: solo contadores + comprobaciones ligeras; ring solo en violaciones.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { rowDuplicatesPrior, utterancesRelate, validateLogRowsNoPrefixDup } from './conversationStream.js'
import { sortSessionSpeakers } from './voiceIdentity.js'

const IS_DEV = Boolean(import.meta.env?.DEV)
const VIOLATION_RING = 40

/** @type {boolean | null} */
let runtimeOverride = null

/** Lectura única en hot path (call sites en dev). */
export let debugHotPath = false

const state = {
  enabled: false,
  startedAt: 0,
  micEvents: 0,
  streamSyncs: 0,
  logEmits: 0,
  streamSkips: 0,
  lastMicAt: 0,
  lastMicInterim: '',
  lastMicFinal: '',
  lastLive: '',
  lastLogText: '',
  lastLogSpeaker: '',
  lastSession: '',
  historyErrors: 0,
  lastOnresultAt: 0,
  recognitionActive: false,
  listeningStatus: 'idle',
  conversationActive: false,
  logRowCount: 0,
  /** @type {string[]} */
  logRowTexts: [],
  logRowsPrefixChainOk: true,
  rowOpens: 0,
  rowReplaces: 0,
  stallRebuilds: 0,
  recognitionEnds: 0,
  speakerNews: 0,
  speakerChangeCommits: 0,
  speakerRegisters: 0,
  speakerPrunes: 0,
  finalShorterThanInterim: 0,
  commandDispatches: 0,
  commandSkips: 0,
  lastCommandPlan: '',
  lastCommandId: '',
  /** @type {string[]} */
  logSpeakerLabels: [],
  maxLiveLen: 0,
  maxLogLen: 0,
  minuteKnowledgeRows: 0,
  minuteKnowledgePromptRows: 0,
  minuteKnowledgePromptChars: 0,
  minuteKnowledgeTrimmed: false,
  workspaceImageRequests: 0,
  workspaceImageSuccess: 0,
  workspaceImageFail: 0,
  workspaceImageLastSource: '',
  liveShrinks: 0,
  logShrinks: 0,
  /** @type {Array<{ t: number, checkId: string, detail: unknown }>} */
  violations: [],
  /** @type {Record<string, { id: string, label: string, pass: boolean, detail: string }>} */
  checks: {},
}

function syncHotPath() {
  debugHotPath = IS_DEV && state.enabled
}

function resolveEnabledFlag() {
  if (runtimeOverride !== null) return runtimeOverride
  if (typeof window !== 'undefined' && typeof window.__FLU_DEBUG_ENABLED === 'boolean') {
    return window.__FLU_DEBUG_ENABLED
  }
  return Boolean(FLU_CONFIG.debug?.enabled)
}

export function isFluDebugEnabled() {
  return state.enabled
}

export function initFluDebug() {
  if (!IS_DEV) {
    state.enabled = false
    syncHotPath()
    return false
  }
  state.enabled = resolveEnabledFlag()
  state.startedAt = Date.now()
  syncHotPath()
  if (state.enabled && FLU_CONFIG.debug?.consoleLog) {
    console.info('[Flu][debug] Modo debug activo — apagar: __fluDev.debug.disable()')
  }
  return state.enabled
}

export function enableFluDebug() {
  runtimeOverride = true
  state.enabled = true
  if (!state.startedAt) state.startedAt = Date.now()
  syncHotPath()
  if (typeof window !== 'undefined') window.__FLU_DEBUG_ENABLED = true
  logDebug('modo debug encendido')
}

export function disableFluDebug() {
  runtimeOverride = false
  state.enabled = false
  syncHotPath()
  if (typeof window !== 'undefined') window.__FLU_DEBUG_ENABLED = false
  console.info('[Flu][debug] Modo debug apagado')
}

function recordViolation(checkId, detail) {
  const row = { t: Date.now(), checkId, detail }
  state.violations.push(row)
  if (state.violations.length > VIOLATION_RING) state.violations.shift()
  if (state.enabled && FLU_CONFIG.debug?.consoleLog) {
    console.warn(`[Flu][debug] ${checkId}`, detail ?? '')
  }
}

/** @param {string} interim @param {string} lastFinal */
export function debugRecordMic(interim, lastFinal) {
  state.micEvents += 1
  state.lastMicAt = Date.now()
  state.lastOnresultAt = state.lastMicAt
  if (interim) state.lastMicInterim = interim
  if (lastFinal) state.lastMicFinal = lastFinal

  const micText = interim || lastFinal
  const live = state.lastLive
  if (micText.length > 3 && live.length > 3 && !utterancesRelate(micText, live)) {
    recordViolation('mic-live-parity', { mic: micText, live })
  }
}

/** @param {string[]} rawInterims @param {string[]} rawFinals @param {string} mergedInterim */
export function debugRecordMicFragments(rawInterims = [], rawFinals = [], mergedInterim = '') {
  if (rawInterims.length > 1) {
    const longest = rawInterims.reduce(
      (best, cur) => (String(cur || '').length > best.length ? String(cur) : best),
      '',
    )
    if (
      mergedInterim &&
      longest.length > mergedInterim.length + 6 &&
      !utterancesRelate(mergedInterim, longest)
    ) {
      recordViolation('interim-truncated', { raw: rawInterims, merged: mergedInterim, longest })
    }
  }
  if (rawFinals.length && mergedInterim) {
    const finalText = rawFinals
      .map((chunk) => String(chunk || '').trim())
      .reduce((best, cur) => (cur.length >= best.length ? cur : best), '')
    if (
      mergedInterim.length > finalText.length + 6 &&
      (utterancesRelate(mergedInterim, finalText) || mergedInterim.toLowerCase().includes(finalText.toLowerCase()))
    ) {
      state.finalShorterThanInterim += 1
    }
  }
  if (rawFinals.length > 1) {
    const mergedFinal = rawFinals.reduce(
      (acc, cur) => (acc && acc.length >= String(cur || '').length ? acc : String(cur || '')),
      '',
    )
    const full = rawFinals.join(' ')
    if (full.includes('juro') && mergedFinal && !mergedFinal.toLowerCase().includes('juro')) {
      recordViolation('final-fragment-lost', { raw: rawFinals, merged: mergedFinal })
    }
  }
}

/** Trazabilidad central de comandos (sin violación en dispatch normal). */
export function debugRecordCommandDispatch({
  plan = '',
  command = '',
  kind = '',
  source = '',
  interim = false,
  reason = '',
} = {}) {
  state.lastCommandPlan = String(plan || '')
  state.lastCommandId = String(command || kind || '')
  if (plan === 'dispatch') {
    state.commandDispatches += 1
  } else if (plan === 'skip' || plan === 'dedup') {
    state.commandSkips += 1
  }
  if (import.meta.env?.DEV && FLU_CONFIG.debug?.consoleLog && plan === 'dispatch') {
    console.info('[Flu][debug] command-dispatch', { plan, command, kind, source, interim })
  }
  if (plan === 'dispatch' && command && !/^(FLU_|INICIAR|GENERAR|GUARDAR|ABRIR|CERRAR)/.test(command)) {
    recordViolation('unknown-navigation-command', { command, source, kind })
  }
  if (plan === 'skip' && reason === 'wait' && interim) {
    recordViolation('command-interim-wait', { command, source, reason })
  }
}

/** Tras resolveCommitCapture: fallo si el commit sigue más corto que preview/interino. */
export function debugRecordCommitCapture({ final = '', interim = '', capture = '', preview = '' } = {}) {
  const fin = String(final || '').trim()
  const cap = String(capture || '').trim()
  const prev = String(preview || '').trim()
  const inter = String(interim || '').trim()
  const reference = prev.length >= inter.length ? prev : inter
  if (
    fin &&
    cap &&
    reference.length > fin.length + 4 &&
    cap.length <= fin.length + 4 &&
    (utterancesRelate(reference, fin) || reference.toLowerCase().includes(fin.toLowerCase()))
  ) {
    recordViolation('final-shorter-than-preview', { final: fin, capture: cap, preview: prev, interim: inter })
  }
}

/** @param {string} speaker @param {string} utterance */
export function debugRecordSpeakerSticky(speaker, utterance) {
  recordViolation('speaker-sticky-at-boundary', { speaker, utterance: String(utterance || '').slice(0, 48) })
}

export function debugRecordSpeakerNew(from = '', to = '', atTurnBoundary = false) {
  state.speakerNews += 1
  if (state.enabled && FLU_CONFIG.debug?.consoleLog) {
    console.info('[Flu][debug] speaker-new', { from, to, atTurnBoundary })
  }
}

export function debugRecordSpeakerPrune(removed = [], kept = []) {
  state.speakerPrunes += 1
  state.clusterLabels = kept
  if (removed.length) {
    recordViolation('speaker-ghost-pruned', { removed, kept })
  }
}

export function debugRecordStallRebuild(reason = '') {
  state.stallRebuilds += 1
  recordViolation('recognition-stall-rebuild', { reason })
}

export function debugRecordSrGapCommit({ capture = '', sinceLastResultMs = 0, reason = '' } = {}) {
  recordViolation('sr-gap-segment-commit', {
    capture: String(capture || ''),
    sinceLastResultMs: Number(sinceLastResultMs) || 0,
    reason: String(reason || ''),
  })
}

export function debugRecordRecognitionEnd() {
  state.recognitionEnds += 1
}

/** @param {string} skipReason */
export function debugRecordStreamSkip(skipReason) {
  state.streamSkips += 1
  if (skipReason === 'fresh-not-new-row') {
    recordViolation('fresh-not-new-row', {})
  }
}

/**
 * @param {string} capture
 * @param {boolean} newParagraph
 * @param {boolean} replaceLast
 * @param {boolean} freshUtterance
 * @param {string} utterance
 */
export function debugRecordStreamEmit(
  capture,
  newParagraph,
  replaceLast,
  freshUtterance,
  utterance,
  session = '',
) {
  state.streamSyncs += 1
  if (session) state.lastSession = session
  if (capture) {
    const len = capture.length
    if (state.lastMicFinal && capture !== state.lastMicFinal && !utterancesRelate(capture, state.lastMicFinal)) {
      recordViolation('final-not-published', { final: state.lastMicFinal, published: capture })
    }
    const micRef = state.lastMicInterim || state.lastMicFinal
    if (micRef && len > micRef.length + 48 && !micRef.startsWith(capture) && !capture.startsWith(micRef)) {
      recordViolation('capture-bloat', { micLen: micRef.length, captureLen: len })
    }
    if (state.lastLive && len < state.lastLive.length && utterancesRelate(state.lastLive, capture)) {
      state.liveShrinks += 1
      recordViolation('live-shrink', { from: state.lastLive.length, to: len })
    }
    state.lastLive = capture
    state.maxLiveLen = Math.max(state.maxLiveLen, len)
  }
  if (newParagraph) state.rowOpens += 1
  if (replaceLast) state.rowReplaces += 1
  if (freshUtterance && newParagraph) {
    recordViolation('fresh-not-new-row', { utterance })
  }
}

/** @param {string} text @param {string} speaker @param {boolean} replaceLast */
export function debugRecordLogEmit(text, speaker, replaceLast) {
  state.logEmits += 1
  if (text) {
    const len = text.length
    if (state.lastLogText && len < state.lastLogText.length && utterancesRelate(state.lastLogText, text)) {
      state.logShrinks += 1
      recordViolation('log-shrink', { from: state.lastLogText.length, to: len })
    }
    state.lastLogText = text
    state.maxLogLen = Math.max(state.maxLogLen, len)

    if (replaceLast && state.logRowTexts.length) {
      if (state.logRowTexts.length >= 2) {
        const prior = state.logRowTexts[state.logRowTexts.length - 2]
        if (rowDuplicatesPrior(prior, text)) {
          state.logRowsPrefixChainOk = false
          recordViolation('log-rows-prefix-chain', {
            rows: state.logRowTexts.slice(-4),
          })
        }
      }
      state.logRowTexts[state.logRowTexts.length - 1] = text
    } else {
      if (state.logRowTexts.length && rowDuplicatesPrior(state.logRowTexts[state.logRowTexts.length - 1], text)) {
        state.logRowsPrefixChainOk = false
        recordViolation('log-row-prefix-dup', {
          prior: state.logRowTexts[state.logRowTexts.length - 1],
          next: text,
        })
      }
      state.logRowTexts.push(text)
    }
  }
  if (speaker) state.lastLogSpeaker = speaker
  if (speaker) {
    if (replaceLast && state.logSpeakerLabels.length) {
      state.logSpeakerLabels[state.logSpeakerLabels.length - 1] = speaker
    } else if (!state.logSpeakerLabels.includes(speaker)) {
      state.logSpeakerLabels.push(speaker)
    }
    state.clusterLabels = sortSessionSpeakers(state.logSpeakerLabels)
  }

  const live = state.lastLive
  if (text && live && !utterancesRelate(live, text)) {
    if (Math.abs(live.length - text.length) > 8) {
      recordViolation('live-log-parity', { live, log: text })
    }
  }
}

export function debugRecordPromptBudget({
  kind = '',
  rows = 0,
  promptRows = 0,
  promptChars = 0,
} = {}) {
  if (kind === 'minute-knowledge-sync') {
    state.minuteKnowledgeRows = Number(rows) || 0
    state.minuteKnowledgePromptRows = Number(promptRows) || 0
    state.minuteKnowledgePromptChars = Number(promptChars) || 0
    state.minuteKnowledgeTrimmed = state.minuteKnowledgeRows > state.minuteKnowledgePromptRows
  }
}

export function debugRecordWorkspaceImage({
  requested = false,
  success = false,
  source = '',
} = {}) {
  if (!requested) return
  state.workspaceImageRequests += 1
  if (success) {
    state.workspaceImageSuccess += 1
  } else {
    state.workspaceImageFail += 1
  }
  state.workspaceImageLastSource = String(source || '')
}

export function debugRecordHistoryError(detail) {
  state.historyErrors += 1
  recordViolation('history-update-failed', detail)
}

/** @param {string} status @param {boolean} conversationActive @param {number} logRowCount */
export function debugUpdateContext(status, conversationActive, logRowCount) {
  if (status) state.listeningStatus = status
  state.conversationActive = conversationActive
  if (logRowCount >= 0) state.logRowCount = logRowCount
}

/**
 * Único punto de entrada en hot path (hook, shell). Nunca lanza: el mic no cae por debug.
 * @param {string} action
 * @param {Record<string, unknown>} [payload]
 */
export function fluDebugHot(action, payload = {}) {
  if (!IS_DEV || !debugHotPath) return
  try {
    switch (action) {
      case 'mic':
        debugRecordMic(String(payload.interim || ''), String(payload.final || ''))
        break
      case 'mic-fragments':
        debugRecordMicFragments(
          payload.rawInterims || [],
          payload.rawFinals || [],
          String(payload.mergedInterim || ''),
        )
        break
      case 'final-preserved-preview':
        debugRecordCommitCapture({
          final: String(payload.final || ''),
          interim: String(payload.interim || ''),
          capture: String(payload.capture || ''),
          preview: String(payload.preview || ''),
        })
        break
      case 'speaker-sticky':
        debugRecordSpeakerSticky(String(payload.speaker || ''), String(payload.utterance || ''))
        break
      case 'speaker-new':
        debugRecordSpeakerNew(
          String(payload.from || ''),
          String(payload.to || ''),
          Boolean(payload.atTurnBoundary),
        )
        break
      case 'speaker-register':
        state.speakerRegisters = (state.speakerRegisters || 0) + 1
        if (IS_DEV && state.enabled) {
          console.info('[Flu][debug] speaker-register', payload)
        }
        break
      case 'command-log-commit':
        state.commandLogCommits = (state.commandLogCommits || 0) + 1
        break
      case 'speaker-prune':
        debugRecordSpeakerPrune(
          Array.isArray(payload.removed) ? payload.removed : [],
          Array.isArray(payload.kept) ? payload.kept : [],
        )
        break
      case 'stall-rebuild':
        debugRecordStallRebuild(String(payload.reason || ''))
        break
      case 'sr-gap-commit':
        debugRecordSrGapCommit(payload)
        break
      case 'mock-worst-case':
        if (IS_DEV && state.enabled) {
          console.info('[Flu][debug] mock-worst-case', payload)
        }
        break
      case 'recognition-end':
        debugRecordRecognitionEnd()
        break
      case 'stream-skip':
        debugRecordStreamSkip(String(payload.reason || ''))
        break
      case 'stream-emit':
      case 'stream-preview':
      case 'stream-commit':
        debugRecordStreamEmit(
          String(payload.capture || ''),
          Boolean(payload.newParagraph),
          Boolean(payload.replaceLast),
          Boolean(payload.freshUtterance),
          String(payload.utterance || ''),
          String(payload.session || ''),
        )
        break
      case 'log-emit':
        debugRecordLogEmit(
          String(payload.text || ''),
          String(payload.speaker || ''),
          Boolean(payload.replaceLast),
        )
        break
      case 'log-prefix-dup-blocked':
        recordViolation('log-prefix-dup-blocked', {
          prior: String(payload.prior || ''),
          capture: String(payload.capture || ''),
        })
        break
      case 'log-asr-revision-blocked':
        recordViolation('log-asr-revision-blocked', {
          prior: String(payload.prior || ''),
          capture: String(payload.capture || ''),
        })
        break
      case 'mic-fragment-mismerge':
        recordViolation('mic-fragment-mismerge', {
          mic: String(payload.mic || ''),
          published: String(payload.published || ''),
          collapsed: String(payload.collapsed || ''),
        })
        break
      case 'mic-stutter-collapsed':
        recordViolation('mic-stutter-collapsed', {
          rawLen: Number(payload.rawLen ?? 0),
          publishedLen: Number(payload.publishedLen ?? 0),
        })
        break
      case 'conversation-command':
        debugRecordCommandDispatch({
          plan: 'dispatch',
          command: String(payload.command || ''),
          source: 'passive',
        })
        break
      case 'conversation-dispatch':
        debugRecordCommandDispatch({
          plan: String(payload.plan || ''),
          command: String(payload.command || ''),
          kind: String(payload.kind || ''),
          source: String(payload.source || ''),
          interim: Boolean(payload.interim),
          reason: String(payload.reason || ''),
        })
        break
      case 'speaker-change-commit':
        state.speakerChangeCommits = (state.speakerChangeCommits || 0) + 1
        break
      case 'final-skipped-redundant':
        recordViolation('final-skipped-redundant', payload)
        break
      case 'context':
        debugUpdateContext(
          String(payload.status || ''),
          Boolean(payload.conversationActive),
          Number(payload.logRowCount ?? -1),
        )
        break
      case 'history-error':
        debugRecordHistoryError(payload.detail)
        break
      default:
        break
    }
  } catch (error) {
    recordViolation('debug-hot-crash', {
      action,
      message: String(error?.message || error),
    })
  }
}

export function runFluDebugChecks() {
  const checks = []
  const now = Date.now()

  checks.push({
    id: 'modo-debug',
    label: 'Modo debug',
    pass: state.enabled,
    detail: state.enabled ? 'activo' : 'apagado',
  })

  checks.push({
    id: 'no-live-shrink',
    label: 'Última frase sin retroceso',
    pass: state.liveShrinks === 0,
    detail: state.liveShrinks ? `${state.liveShrinks} retrocesos` : 'monótona',
  })

  checks.push({
    id: 'no-log-shrink',
    label: 'Log sin borrar/retroceder',
    pass: state.logShrinks === 0,
    detail: state.logShrinks ? `${state.logShrinks} retrocesos` : 'monótono',
  })

  checks.push({
    id: 'live-log-sync',
    label: 'Última frase = fila activa log',
    pass:
      !state.lastLive ||
      !state.lastLogText ||
      state.lastLive === state.lastLogText ||
      utterancesRelate(state.lastLive, state.lastLogText),
    detail:
      state.lastLive && state.lastLogText
        ? `${state.lastLive.length}/${state.lastLogText.length} chars`
        : 'pendiente',
  })

  checks.push({
    id: 'session-live-parity',
    label: 'Sesión ≥ Última frase',
    pass:
      !state.lastSession ||
      !state.lastLive ||
      state.lastLive.length >= state.lastSession.length ||
      utterancesRelate(state.lastSession, state.lastLive),
    detail: state.lastSession
      ? `${state.lastSession.length}/${state.lastLive.length} chars`
      : 'sin sesión',
  })

  checks.push({
    id: 'no-history-errors',
    label: 'Sin errores de log UI',
    pass: state.historyErrors === 0,
    detail: state.historyErrors ? `${state.historyErrors} errores` : 'ok',
  })

  const micText = state.lastMicInterim || state.lastMicFinal
  let micLiveOk = true
  if (micText && state.lastLive) {
    micLiveOk = utterancesRelate(micText, state.lastLive)
  }
  checks.push({
    id: 'mic-live-parity',
    label: 'Mic ↔ Última frase',
    pass: !micText || !state.lastLive || micLiveOk,
    detail: micText ? `${micText.slice(0, 36)}…` : 'sin mic',
  })

  let liveLogOk = true
  if (state.lastLive && state.lastLogText) {
    liveLogOk = utterancesRelate(state.lastLive, state.lastLogText)
  }
  checks.push({
    id: 'live-log-parity',
    label: 'Última frase ↔ Conversación',
    pass: !state.lastLive || !state.lastLogText || liveLogOk,
    detail: state.lastLogText ? state.lastLogText.slice(0, 36) : 'sin log',
  })

  const stallMs = FLU_CONFIG.activeListen?.restart?.stallMs || 12000
  let recOk = true
  if (state.listeningStatus === 'listening' && state.conversationActive) {
    const since = state.lastOnresultAt ? now - state.lastOnresultAt : now - state.startedAt
    recOk = since < stallMs * 1.5
  }
  checks.push({
    id: 'recognition-alive',
    label: 'Reconocimiento sin stall',
    pass: recOk,
    detail:
      state.listeningStatus === 'listening'
        ? `${Math.round((now - (state.lastOnresultAt || state.startedAt)) / 1000)}s`
        : state.listeningStatus,
  })

  checks.push({
    id: 'row-discipline',
    label: 'Filas: repl ≥ new (turno activo)',
    pass: state.rowReplaces >= state.rowOpens || state.streamSyncs < 3,
    detail: `${state.rowReplaces} repl / ${state.rowOpens} new`,
  })

  const recentViolations = state.violations.filter((v) => now - v.t < 30000)
  checks.push({
    id: 'no-recent-violations',
    label: 'Sin violaciones (30s)',
    pass: recentViolations.length === 0,
    detail: recentViolations.length
      ? recentViolations.map((v) => v.checkId).join(', ')
      : 'ok',
  })

  const total = state.streamSyncs + state.streamSkips
  const skipRate = total > 0 ? state.streamSkips / total : 0
  checks.push({
    id: 'stream-throughput',
    label: 'Flujo mic→UI',
    pass: skipRate < 0.85 || state.streamSyncs < 5,
    detail: `${state.streamSyncs} sync / ${state.streamSkips} skip`,
  })

  checks.push({
    id: 'mic-fragment-merge',
    label: 'Sin interinos truncados en onresult',
    pass: !state.violations.some((v) => v.checkId === 'interim-truncated'),
    detail: state.lastMicInterim ? state.lastMicInterim.slice(0, 40) : 'sin mic',
  })

  checks.push({
    id: 'command-dispatch',
    label: 'Comandos centralizados (dispatch/skip)',
    pass: !state.violations.some((v) => v.checkId === 'unknown-navigation-command'),
    detail: `${state.commandDispatches} dispatch / ${state.commandSkips} skip`,
  })

  checks.push({
    id: 'final-preview-preserve',
    label: 'Final no acorta preview/interino (TV)',
    pass: !state.violations.some((v) => v.checkId === 'final-shorter-than-preview'),
    detail: state.finalShorterThanInterim
      ? `${state.finalShorterThanInterim} eventos final<interim (resueltos)`
      : 'ok',
  })

  checks.push({
    id: 'speaker-turn-boundary',
    label: 'Diarización en límite de turno',
    pass: !state.violations.some((v) => v.checkId === 'speaker-sticky-at-boundary'),
    detail: state.lastLogSpeaker || 'sin hablante',
  })

  const speakerIndexes = state.clusterLabels
    .map((label) => String(label || '').match(/^Hablante\s+(\d+)$/i)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b)
  let gapFree = true
  for (let i = 1; i < speakerIndexes.length; i += 1) {
    if (speakerIndexes[i] - speakerIndexes[i - 1] > 1) {
      gapFree = false
      break
    }
  }
  checks.push({
    id: 'speaker-index-gaps',
    label: 'Índices Hablante sin saltos (clusters)',
    pass: gapFree || speakerIndexes.length < 2,
    detail: speakerIndexes.length ? speakerIndexes.join(', ') : 'sin clusters',
  })

  checks.push({
    id: 'speaker-ghost-prune',
    label: 'Sin clusters fantasma recientes',
    pass: !state.violations.some((v) => v.checkId === 'speaker-ghost-pruned'),
    detail: `${state.speakerPrunes} podas`,
  })

  checks.push({
    id: 'recognition-recovery',
    label: 'Reconexión SR (stall/end)',
    pass: state.stallRebuilds <= 12 || state.recognitionEnds <= state.stallRebuilds + 2,
    detail: `${state.stallRebuilds} rebuild / ${state.recognitionEnds} end`,
  })

  checks.push({
    id: 'log-no-prefix-dup',
    label: 'Sin filas append con prefijo duplicado',
    pass: state.logRowsPrefixChainOk && validateLogRowsNoPrefixDup(state.logRowTexts),
    detail: state.logRowTexts.length ? `${state.logRowTexts.length} filas` : 'sin filas',
  })

  checks.push({
    id: 'minute-knowledge-budget',
    label: 'KB minutas recortada a presupuesto',
    pass:
      state.minuteKnowledgeRows === 0 ||
      state.minuteKnowledgePromptRows <= FLU_CONFIG.limits.minuteKnowledgePromptMax,
    detail: state.minuteKnowledgeRows
      ? `${state.minuteKnowledgePromptRows}/${state.minuteKnowledgeRows} filas, ${state.minuteKnowledgePromptChars} chars`
      : 'sin KB',
  })

  checks.push({
    id: 'workspace-image-flow',
    label: 'Flujo imagen workspace',
    pass: state.workspaceImageRequests === 0 || state.workspaceImageFail === 0,
    detail: state.workspaceImageRequests
      ? `${state.workspaceImageSuccess}/${state.workspaceImageRequests} ok, ${state.workspaceImageFail} fail · ${state.workspaceImageLastSource || 'n/a'}`
      : 'sin requests',
  })

  const tvStallMs = FLU_CONFIG.activeListen?.restart?.stallMs || 28000
  checks.push({
    id: 'tv-stall-tolerance',
    label: 'TV: tolerancia pausa SR',
    pass: tvStallMs >= 45000,
    detail: `stallMs=${tvStallMs}`,
  })

  checks.push({
    id: 'speaker-change-preserve',
    label: 'Cambio hablante: sin vaciar preview',
    pass: FLU_CONFIG.voiceIdentity?.capture?.roomCapture?.preservePreviewOnTurnBoundary !== false,
    detail: `commits=${state.speakerChangeCommits || 0}`,
  })

  checks.push({
    id: 'log-rows-tracked',
    label: 'Filas en conversación',
    pass: state.logRowCount > 0 || state.streamSyncs < 2,
    detail: `${state.logRowCount} filas UI / ${state.logRowTexts.length} debug`,
  })

  state.checks = Object.fromEntries(checks.map((c) => [c.id, c]))
  return checks
}

export function getFluDebugReport() {
  const checks = runFluDebugChecks()
  const passCount = checks.filter((c) => c.pass).length
  return {
    enabled: state.enabled,
    uptimeMs: Date.now() - state.startedAt,
    summary: `${passCount}/${checks.length} OK`,
    counters: {
      micEvents: state.micEvents,
      streamSyncs: state.streamSyncs,
      streamSkips: state.streamSkips,
      logEmits: state.logEmits,
      rowOpens: state.rowOpens,
      rowReplaces: state.rowReplaces,
      stallRebuilds: state.stallRebuilds,
      recognitionEnds: state.recognitionEnds,
      speakerNews: state.speakerNews,
      speakerPrunes: state.speakerPrunes,
      minuteKnowledgeRows: state.minuteKnowledgeRows,
      minuteKnowledgePromptRows: state.minuteKnowledgePromptRows,
      minuteKnowledgePromptChars: state.minuteKnowledgePromptChars,
      workspaceImageRequests: state.workspaceImageRequests,
      workspaceImageSuccess: state.workspaceImageSuccess,
      workspaceImageFail: state.workspaceImageFail,
      violations: state.violations.length,
    },
    last: {
      micInterim: state.lastMicInterim,
      micFinal: state.lastMicFinal,
      live: state.lastLive,
      log: state.lastLogText,
      speaker: state.lastLogSpeaker,
    },
    checks,
    recentViolations: state.violations.slice(-8),
  }
}

export function clearFluDebug() {
  state.micEvents = 0
  state.streamSyncs = 0
  state.logEmits = 0
  state.streamSkips = 0
  state.rowOpens = 0
  state.rowReplaces = 0
  state.stallRebuilds = 0
  state.recognitionEnds = 0
  state.speakerNews = 0
  state.speakerPrunes = 0
  state.logSpeakerLabels = []
  state.clusterLabels = []
  state.maxLiveLen = 0
  state.maxLogLen = 0
  state.minuteKnowledgeRows = 0
  state.minuteKnowledgePromptRows = 0
  state.minuteKnowledgePromptChars = 0
  state.minuteKnowledgeTrimmed = false
  state.liveShrinks = 0
  state.logShrinks = 0
  state.violations = []
  state.logRowTexts = []
  state.logRowsPrefixChainOk = true
  state.lastMicInterim = ''
  state.lastMicFinal = ''
  state.lastLive = ''
  state.lastLogText = ''
  state.startedAt = Date.now()
}

export function logDebug(tag, data) {
  if (!state.enabled || !FLU_CONFIG.debug?.consoleLog) return
  if (data === undefined) console.info(`[Flu][debug] ${tag}`)
  else console.info(`[Flu][debug] ${tag}`, data)
}

export function subscribeFluDebug(listener) {
  const ms = FLU_CONFIG.debug?.refreshMs || 1500
  const tick = () => {
    if (state.enabled) listener(getFluDebugReport())
  }
  tick()
  const id = window.setInterval(tick, ms)
  return () => window.clearInterval(id)
}

export function getFluDebugApi() {
  return {
    enabled: () => state.enabled,
    enable: enableFluDebug,
    disable: disableFluDebug,
    runChecks: runFluDebugChecks,
    report: getFluDebugReport,
    clear: clearFluDebug,
    violations: () => state.violations.slice(),
    recordPromptBudget: debugRecordPromptBudget,
    recordWorkspaceImage: debugRecordWorkspaceImage,
  }
}

export function mountFluDebugDev() {
  if (!IS_DEV || typeof window === 'undefined') return
  window.__fluDebug = getFluDebugApi()
}
