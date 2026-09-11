/**
 * API única de comandos de voz / navegación (es + en).
 * Detección en audioMath; frases en FLU_CONFIG.voiceCommands; UI y hook usan solo este módulo.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { resolveAppLanguage } from './audioMath.js'
import {
  cleanForSpeech,
  detectSessionVoiceCommand,
  isMinuteGenerationRequest,
  isMinuteSaveRequest,
  planConversationDispatch,
} from './audioMath.js'

export const NAVIGATION_COMMAND_IDS = Object.freeze([
  'INICIAR_CONVERSACION',
  'GENERAR_RESUMEN',
  'GUARDAR_MINUTA',
  'ABRIR_ESCUCHA',
  'CERRAR_ESCUCHA',
  'REGISTRAR_PARTICIPANTE',
  'FLU_WAKE',
  'FLU_ADELANTE',
  'FLU_ESPERA',
  'ANALIZAR_DOCUMENTO',
  'ANALIZAR_APP',
  'GENERAR_DOCUMENTO',
  'GENERAR_VIDEO',
  'NAVEGAR',
  'BUSCAR',
  // P1-C (§1.3.1) — autoconocimiento por voz (fast-path local sin IA).
  'CONOCER_FLU',
])

/**
 * Subconjunto de comandos que Gemini puede emitir como safety net.
 * Los fast-paths locales (BUSCAR, CONOCER_FLU, GENERAR_VIDEO, etc.) NO deben
 * llegar a Gemini: se resuelven antes en detectUiVoiceCommand/detectSessionVoiceCommand.
 * Esta lista es la única fuente de verdad para gemini.js (schema + user prompt),
 * de modo que añadir/eliminar un comando inferible se sincroniza automáticamente.
 */
export const GEMINI_INFERABLE_COMMAND_IDS = Object.freeze([
  'FLU_WAKE',
  'INICIAR_CONVERSACION',
  'CERRAR_ESCUCHA',
  'ABRIR_ESCUCHA',
  'NAVEGAR',
])

export function getVoiceCommands(config = FLU_CONFIG) {
  return config.voiceCommands
}

export function isKnownNavigationCommand(comando = '') {
  return NAVIGATION_COMMAND_IDS.includes(String(comando || '').trim())
}

export function resolveNavigationCommand(text = '', voiceCommands = getVoiceCommands()) {
  return detectSessionVoiceCommand(text, voiceCommands)
}

/** Solo ejecutar navegación de Gemini si el usuario la pidió en el transcript (evita reset post-respuesta). */
export function userRequestedNavigationCommand(
  transcript = '',
  comando = '',
  voiceCommands = getVoiceCommands(),
) {
  const cmd = String(comando || '').trim()
  if (!cmd) return false
  const text = cleanForSpeech(transcript)
  if (!text) return false
  if (cmd === 'GENERAR_RESUMEN') return isMinuteGenerationRequest(text)
  if (cmd === 'GUARDAR_MINUTA') return isMinuteSaveRequest(text)
  if (cmd === 'FLU_WAKE' || cmd === 'FLU_ADELANTE' || cmd === 'FLU_ESPERA') {
    return detectSessionVoiceCommand(text, voiceCommands) === cmd
  }
  return detectSessionVoiceCommand(text, voiceCommands) === cmd
}

/** Prueba varios fragmentos ASR (buffer + final) — origen único en processCapture. */
export function resolveNavigationCommandFromTexts(texts = [], voiceCommands = getVoiceCommands()) {
  const list = (Array.isArray(texts) ? texts : [texts])
    .map((part) => cleanForSpeech(part))
    .filter(Boolean)
  for (const part of list) {
    const command = resolveNavigationCommand(part, voiceCommands)
    if (command) return command
  }
  return null
}

export function planVoiceCommandDispatch(
  text = '',
  options = {},
  voiceCommands = getVoiceCommands(),
) {
  return planConversationDispatch(text, voiceCommands, options)
}

export function resolveVoiceConversationAction(text = '', voiceCommands = getVoiceCommands()) {
  // Derivación ÚNICA: delega en el planificador canónico, el único que llama a
  // deriveQueryFromRow. Fallback no-nulo con la misma forma.
  return (
    planConversationDispatch(text, voiceCommands).action ?? {
      kind: 'log',
      question: '',
      searchQuery: '',
    }
  )
}

export function getCommandSpeech(
  comando = '',
  language = 'es',
  config = FLU_CONFIG,
  params = {},
) {
  const key = String(comando || '').trim()
  const entry = config.ui?.commandSpeech?.[key]
  if (!entry) return ''
  let text = ''
  if (typeof entry === 'string') {
    text = entry
  } else {
    const lang = resolveAppLanguage(language, entry.en || entry.es || '')
    text = entry[lang] || entry.es || entry.en || ''
  }
  const name = String(params.name || params.nombre || '').trim()
  if (name) {
    text = text.replace(/\{name\}/gi, name)
  }
  return text
}

/** @deprecated Usar getCommandSpeech */
export function getNavigationCommandSpeech(comando = '', language = 'es') {
  return getCommandSpeech(comando, language)
}
