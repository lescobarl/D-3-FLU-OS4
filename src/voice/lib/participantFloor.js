/**

 * Participación proactiva de Flu: observador, mano alzada, intervención bajo «ok flu adelante».

 * Config: fluParticipantConfig.js · defaults en fluConfig.fluParticipant.

 */

import { resolveAppLanguage } from './audioMath.js'

import { FLU_CONFIG } from './fluConfig.js'

import {

  FLU_PARTICIPANT_CONFIG_KEYS,

  getFluParticipantConfig,

  isFluParticipantEnabled,

  resetFluParticipantOverrides,

  setFluParticipantEnabled,

  setFluParticipantOverrides,

} from './fluParticipantConfig.js'



export {

  FLU_PARTICIPANT_CONFIG_KEYS,

  getFluParticipantConfig,

  isFluParticipantEnabled,

  resetFluParticipantOverrides,

  setFluParticipantEnabled,

  setFluParticipantOverrides,

}



export const FLU_PARTICIPANT_PHASES = Object.freeze([

  'idle',

  'evaluating',

  'raised',

  'cooldown',

])



export function resolveFluParticipantLabel(key = '', language = 'es', config = FLU_CONFIG) {

  const entry = config.fluParticipant?.ui?.[key] || {}

  const lang = resolveAppLanguage(language, entry.en || entry.es || '')

  return entry[lang] || entry.es || entry.en || ''

}



export function createFluParticipantState() {

  return {

    phase: 'idle',

    reason: '',

    draftContribution: '',

    confidence: 0,

    raisedAt: 0,

    cooldownUntil: 0,

    lastEvalAt: 0,

    turnsSinceLastEval: 0,

    interventionTimestamps: [],

    evalGeneration: 0,

  }

}



export function buildParticipantLogWindow(

  texts = [],

  speakers = [],

  { maxTurns = 8 } = {},

) {

  const rows = []

  const count = texts.length

  const start = Math.max(0, count - Math.max(1, maxTurns))

  for (let index = start; index < count; index += 1) {

    const text = String(texts[index] || '').trim()

    if (!text) continue

    const speaker =

      String(speakers[index] || speakers[speakers.length - 1] || 'Hablante 1').trim() || 'Hablante 1'

    rows.push({ speaker, text })

  }

  return rows

}



export function formatParticipantLogForPrompt(rows = [], language = 'es') {

  if (!rows.length) {

    return language === 'en' ? '(empty conversation)' : '(conversación vacía)'

  }

  return rows.map((row, index) => `${index + 1}. ${row.speaker}: ${row.text}`).join('\n')

}



function countInterventionsInHour(timestamps = [], now = Date.now()) {

  const hourAgo = now - 60 * 60 * 1000

  return timestamps.filter((at) => at >= hourAgo).length

}



export function shouldEvaluateParticipantOnTurn(state = createFluParticipantState(), cfg = getFluParticipantConfig()) {

  const every = Number(cfg.evaluateEveryNTurns)

  const nextCount = Number(state.turnsSinceLastEval) + 1

  return nextCount >= every

}



export function advanceParticipantTurnCounter(state = createFluParticipantState(), cfg = getFluParticipantConfig()) {

  const every = Number(cfg.evaluateEveryNTurns)

  const nextCount = Number(state.turnsSinceLastEval) + 1

  if (nextCount >= every) {

    return { ...state, turnsSinceLastEval: 0 }

  }

  return { ...state, turnsSinceLastEval: nextCount }

}



export function canScheduleParticipantEvaluation(

  state = createFluParticipantState(),

  cfg = getFluParticipantConfig(),

  {

    conversationActive = false,

    turnCount = 0,

    now = Date.now(),

    force = false,

  } = {},

) {

  if (cfg.enabled === false || !conversationActive) return false

  if (cfg.conversationOnly !== false && !conversationActive) return false

  if (!force && cfg.evaluateOnTurnCommit === false) return false

  if (force && cfg.evaluateOnManualGrant === false) return false

  if (state.phase === 'evaluating' || state.phase === 'raised') return false

  if (state.phase === 'cooldown' && now < state.cooldownUntil) return false

  const every = Number(cfg.evaluateEveryNTurns)

  const committedTurns = Number(turnCount)

  if (!Number.isFinite(committedTurns)) return false

  if (force) {

    if (committedTurns < 1) return false

  } else if (committedTurns < every) {

    return false

  }

  if (state.interventionTimestamps.length >= Number(cfg.maxInterventionsPerSession)) {

    return false

  }

  if (countInterventionsInHour(state.interventionTimestamps, now) >= Number(cfg.maxInterventionsPerHour)) {

    return false

  }

  return true

}



export function normalizeParticipantEvaluation(raw = {}, cfg = getFluParticipantConfig()) {

  const minConf = Number(cfg.minConfidence)

  const minChars = Number(cfg.minDraftChars)

  const maxChars = Number(cfg.maxDraftChars)

  const minReason = Number(cfg.minReasonChars)

  const intervenir = Boolean(raw.intervenir ?? raw.should_intervene)

  let confidence = Number(raw.confianza)
  if (!Number.isFinite(confidence)) confidence = Number(raw.confidence)
  if (!Number.isFinite(confidence)) confidence = 0

  let reason = String(raw.motivo_corto ?? raw.short_reason ?? '').trim()

  let draft = String(raw.borrador_aportacion ?? raw.draft_contribution ?? '').trim()

  if (draft.length > maxChars) draft = `${draft.slice(0, maxChars - 1)}…`

  const accepted =

    intervenir &&

    confidence >= minConf &&

    draft.length >= minChars &&

    reason.length >= minReason

  return {

    accepted,

    intervenir,

    confidence,

    reason,

    draftContribution: draft,

  }

}



export function applyParticipantEvaluation(state, evaluation, cfg = getFluParticipantConfig(), now = Date.now()) {

  const next = { ...state, lastEvalAt: now, turnsSinceLastEval: 0 }

  if (!evaluation?.accepted) {

    next.phase = next.phase === 'evaluating' ? 'idle' : next.phase

    return next

  }

  next.phase = 'raised'

  next.reason = evaluation.reason

  next.draftContribution = evaluation.draftContribution

  next.confidence = evaluation.confidence

  next.raisedAt = now

  return next

}



export function dismissRaisedHand(state, now = Date.now()) {

  return {

    ...state,

    phase: 'idle',

    reason: '',

    draftContribution: '',

    confidence: 0,

    raisedAt: 0,

  }

}



export function consumeRaisedDraft(state, cfg = getFluParticipantConfig()) {

  if (state.phase !== 'raised' || !state.draftContribution) return { state, draft: '' }

  const draft = state.draftContribution

  return {

    draft,

    state: {

      ...state,

      phase: 'cooldown',

      reason: '',

      draftContribution: '',

      confidence: 0,

      raisedAt: 0,

      cooldownUntil: Date.now() + Number(cfg.cooldownAfterInterventionMs),

    },

  }

}



export function recordParticipantIntervention(state, now = Date.now()) {

  return {

    ...state,

    interventionTimestamps: [...(state.interventionTimestamps || []), now],

  }

}



export function shouldAutoDismissRaisedHand(state, cfg = getFluParticipantConfig(), now = Date.now()) {

  if (state.phase !== 'raised') return false

  const timeout = Number(cfg.handRaisedTimeoutMs)

  if (!timeout || !state.raisedAt) return false

  return now - state.raisedAt >= timeout

}



export function resolveParticipantUiPresentation(state, language = 'es', config = FLU_CONFIG) {

  const cfg = getFluParticipantConfig(config)

  if (cfg.enabled === false) {

    return { show: false, tone: 'idle', label: '', reason: '', phase: state.phase }

  }

  if (state.phase === 'raised') {

    return {

      show: true,

      tone: 'raised',

      label: resolveFluParticipantLabel('handRaisedLabel', language, config),

      reason: state.reason || '',

      phase: state.phase,

    }

  }

  if (state.phase === 'evaluating') {

    return {

      show: true,

      tone: 'evaluating',

      label: resolveFluParticipantLabel('evaluatingLabel', language, config),

      reason: '',

      phase: state.phase,

    }

  }

  return {

    show: true,

    tone: 'idle',

    label: resolveFluParticipantLabel('idleLabel', language, config),

    reason: resolveFluParticipantLabel('idleHint', language, config),

    phase: state.phase,

  }

}



export function canGrantParticipantFloor(state = createFluParticipantState(), cfg = getFluParticipantConfig()) {

  if (cfg.enabled === false) return false

  return state.phase === 'raised' && Boolean(String(state.draftContribution || '').trim())

}



export function shouldIgnoreParticipantFloorGrant(

  state = createFluParticipantState(),

  {

    speechActive = false,

    lastGrantAt = 0,

    delivering = false,

    cfg = getFluParticipantConfig(),

    now = Date.now(),

  } = {},

) {

  if (delivering || speechActive) return true

  if (state.phase === 'cooldown' && now < state.cooldownUntil) return true

  const dedupMs = Number(cfg.floorGrantDedupMs) || 0

  if (dedupMs > 0 && lastGrantAt && now - lastGrantAt < dedupMs) return true

  return false

}



export function detectParticipantFloorCommand(afterWake = '', voiceCommands = FLU_CONFIG.voiceCommands) {

  const text = String(afterWake || '').trim()

  if (!text) return null

  const grant = voiceCommands.grantFloor || []

  const dismiss = voiceCommands.dismissFloor || []

  const norm = text.toLowerCase()

  for (const phrase of grant) {

    const key = String(phrase || '').trim().toLowerCase()

    if (key && (norm === key || norm.startsWith(`${key} `) || norm.endsWith(` ${key}`))) {

      return 'FLU_ADELANTE'

    }

  }

  for (const phrase of dismiss) {

    const key = String(phrase || '').trim().toLowerCase()

    if (key && (norm === key || norm.includes(key))) {

      return 'FLU_ESPERA'

    }

  }

  return null

}


