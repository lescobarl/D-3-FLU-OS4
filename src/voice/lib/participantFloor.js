/**
 * Participación proactiva de Flu: observador, mano alzada, intervención bajo «ok flu adelante».
 * Config: fluParticipantConfig.js · defaults en fluConfig.fluParticipant.
 *
 * D2: la lógica pura del ciclo de participación (evaluación, turnos, mano
 * alzada, cooldown, rate limiting, presentación) tiene un DUEÑO ÚNICO en
 * `src/lib/fluParticipant.ts`. Aquí vivía una copia duplicada sin ningún
 * import; se eliminó para no mantener dos fuentes de la misma lógica.
 * Este módulo conserva solo lo específico de la capa de voz: la etiqueta de
 * UI config-driven y el reconocimiento del comando de piso.
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

export function resolveParticipantFloorLabel(key = '', language = 'es', config = FLU_CONFIG) {
  const entry = config.fluParticipant?.ui?.[key] || {}
  const lang = resolveAppLanguage(language, entry.en || entry.es || '')
  return entry[lang] || entry.es || entry.en || ''
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
