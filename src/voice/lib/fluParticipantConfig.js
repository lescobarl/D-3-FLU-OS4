/**
 * Configuración de participación proactiva de Flu.
 * Defaults en fluConfig.fluParticipant; overrides en localStorage (flu-participant-settings).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { logCaughtError } from '../../lib/caughtError';

export const FLU_PARTICIPANT_STORAGE_KEY = 'flu-participant-settings'
const LEGACY_ENABLED_KEY = 'flu-participant-enabled'

export const FLU_PARTICIPANT_CONFIG_KEYS = Object.freeze([
  'enabled',
  'conversationOnly',
  'evaluateOnTurnCommit',
  'evaluateOnManualGrant',
  'evaluateEveryNTurns',
  'cooldownAfterInterventionMs',
  'handRaisedTimeoutMs',
  'maxInterventionsPerSession',
  'maxInterventionsPerHour',
  'evaluationWindowTurns',
  'minConfidence',
  'maxDraftChars',
  'minDraftChars',
  'minReasonChars',
  'floorGrantDedupMs',
])

/** Campos editables en la pantalla de configuración (orden de visualización). */
export const FLU_PARTICIPANT_EDITABLE_FIELDS = Object.freeze([
  { key: 'enabled', type: 'boolean' },
  { key: 'evaluateEveryNTurns', type: 'number', min: 1, max: 20, step: 1 },
  { key: 'minConfidence', type: 'number', min: 0.5, max: 1, step: 0.01 },
  { key: 'maxInterventionsPerSession', type: 'number', min: 1, max: 100, step: 1 },
  { key: 'maxInterventionsPerHour', type: 'number', min: 1, max: 50, step: 1 },
  {
    key: 'cooldownAfterInterventionMs',
    type: 'durationMinutes',
    min: 0,
    max: 60,
    step: 1,
  },
  {
    key: 'handRaisedTimeoutMs',
    type: 'durationMinutes',
    min: 0,
    max: 30,
    step: 1,
  },
  { key: 'evaluationWindowTurns', type: 'number', min: 2, max: 30, step: 1 },
  { key: 'minDraftChars', type: 'number', min: 8, max: 200, step: 1 },
])

function pickDefaultsFrom(config = FLU_CONFIG) {
  const block = config.fluParticipant
  if (!block || typeof block !== 'object') {
    throw new Error('fluConfig.fluParticipant es obligatorio')
  }
  const out = {}
  for (const key of FLU_PARTICIPANT_CONFIG_KEYS) {
    if (!(key in block)) {
      throw new Error(`fluConfig.fluParticipant.${key} es obligatorio`)
    }
    out[key] = block[key]
  }
  return out
}

function readStorageOverrides() {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(FLU_PARTICIPANT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
        logCaughtError('[catch] src/voice/lib/fluParticipantConfig.js');
    return {}
  }
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value
  if (value === '1' || value === 1 || value === 'true') return true
  if (value === '0' || value === 0 || value === 'false') return false
  return Boolean(value)
}

function coerceParticipantValue(key, value) {
  const field = FLU_PARTICIPANT_EDITABLE_FIELDS.find((item) => item.key === key)
  if (
    key === 'enabled' ||
    key === 'conversationOnly' ||
    key === 'evaluateOnTurnCommit' ||
    key === 'evaluateOnManualGrant'
  ) {
    return coerceBoolean(value)
  }
  const num = Number(value)
  if (!Number.isFinite(num)) return pickDefaultsFrom()[key]
  if (field?.type === 'durationMinutes') {
    let minutes = Math.round(num)
    // En storage va en ms; si supera el máximo en minutos, ya está en ms.
    if (minutes > field.max) {
      minutes = Math.round(minutes / 60000)
    }
    minutes = Math.max(field.min, Math.min(field.max, minutes))
    return minutes * 60 * 1000
  }
  if (field) {
    return Math.max(field.min, Math.min(field.max, num))
  }
  return num
}

export function getFluParticipantDefaults(config = FLU_CONFIG) {
  return pickDefaultsFrom(config)
}

export function getFluParticipantConfig(config = FLU_CONFIG) {
  const merged = { ...pickDefaultsFrom(config) }
  const overrides = readStorageOverrides()
  for (const key of FLU_PARTICIPANT_CONFIG_KEYS) {
    if (key in overrides) {
      merged[key] = coerceParticipantValue(key, overrides[key])
    }
  }
  if (typeof localStorage !== 'undefined') {
    const legacy = localStorage.getItem(LEGACY_ENABLED_KEY)
    if (legacy === '0') merged.enabled = false
    if (legacy === '1') merged.enabled = true
  }
  return merged
}

export function setFluParticipantOverrides(partial = {}) {
  if (typeof localStorage === 'undefined') return getFluParticipantConfig()
  const current = readStorageOverrides()
  const next = { ...current }
  for (const [key, value] of Object.entries(partial)) {
    if (!FLU_PARTICIPANT_CONFIG_KEYS.includes(key)) continue
    next[key] = coerceParticipantValue(key, value)
  }
  localStorage.setItem(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify(next))
  localStorage.setItem(LEGACY_ENABLED_KEY, next.enabled === false ? '0' : '1')
  return getFluParticipantConfig()
}

export function resetFluParticipantOverrides() {
  if (typeof localStorage === 'undefined') return getFluParticipantConfig()
  localStorage.removeItem(FLU_PARTICIPANT_STORAGE_KEY)
  localStorage.removeItem(LEGACY_ENABLED_KEY)
  return getFluParticipantConfig()
}

export function setFluParticipantEnabled(enabled) {
  return setFluParticipantOverrides({ enabled: Boolean(enabled) })
}

export function isFluParticipantEnabled(config = FLU_CONFIG) {
  return getFluParticipantConfig(config).enabled !== false
}

export function resolveFluParticipantFieldLabel(key = '', language = 'es', config = FLU_CONFIG) {
  const entry = config.fluParticipant?.ui?.fields?.[key] || {}
  const lang = language === 'en' && entry.en ? 'en' : 'es'
  return entry[lang] || entry.es || entry.en || key
}

export function resolveFluParticipantFieldHint(key = '', language = 'es', config = FLU_CONFIG) {
  const entry = config.fluParticipant?.ui?.fieldHints?.[key] || {}
  const lang = language === 'en' && entry.en ? 'en' : 'es'
  return entry[lang] || entry.es || entry.en || ''
}

export function msToConfigMinutes(ms) {
  return Math.round(Number(ms) / 60000)
}

export function configMinutesToMs(minutes) {
  return Math.round(Number(minutes) * 60000)
}

export function listFluParticipantHardRules(config = FLU_CONFIG) {
  const cfg = getFluParticipantConfig(config)
  return FLU_PARTICIPANT_CONFIG_KEYS.map((key) => ({
    key,
    value: cfg[key],
    source: 'fluConfig.fluParticipant',
  }))
}
