import { cleanForSpeech, detectTranscriptLanguage } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { fluAsyncErrorHandler } from './fluAsyncError.js'
import { relayLog } from '../../lib/clientLogRelay'
import { logCaughtError } from '../../lib/caughtError';
import { SPEECH_LOCALES } from '../../core/config/localeConfig'

/**
 * Caché de la configuración de voz leída desde el integrationStore de OS3.
 * Se actualiza cada vez que speakResponse() es llamada.
 */
let _cachedVoiceConfig = { rate: 1.0, voiceURI: '' }

/**
 * Actualiza la caché de configuración de voz desde el integrationStore de OS3.
 * Se llama automáticamente desde speakResponse().
 */
async function refreshVoiceConfigCache() {
  try {
    // Dynamic import to avoid circular dependency
    const mod = await import('../../store/integrationStore')
    const store = mod.useIntegrationStore?.getState?.()
    if (store?.voiceConfig) {
      _cachedVoiceConfig = {
        rate: store.voiceConfig.rate ?? 1.0,
        pitch: store.voiceConfig.pitch ?? 1.0,
        volume: store.voiceConfig.volume ?? 1.0,
        voiceURI: store.voiceConfig.voiceURI || '',
      }
    }
  } catch (error) {
    // Si falla el import (entorno test, standalone, etc.), usar defaults
    relayLog('LOG', 'FluSpeech', 'integrationStore no disponible; defaults de voz', error)
    _cachedVoiceConfig = { rate: 1.0, pitch: 1.0, volume: 1.0, voiceURI: '' }
  }
}

function getVoiceConfig() {
  return _cachedVoiceConfig
}

/**
 * FLUJO UNIFICADO DE HABLA — entrada única de voz.
 * speakResponse() es la ÚNICA función que emite TTS. Antes de hablar asegura
 * que el avatar entre en SPEAKING (boca en movimiento) y al terminar restaura
 * el estado previo — salvo que ya esté en SPEAKING (flujos que lo manejan
 * explícitamente) o que otro flujo haya tomado el control durante el habla.
 * Sin hardcode: lee el integrationStore con el mismo dynamic-import que
 * refreshVoiceConfigCache; si no hay store (test/standalone), solo habla.
 * @returns {Promise<(() => void) | null>} función de restauración o null.
 */
async function enterSpeakingState() {
  try {
    const mod = await import('../../store/integrationStore')
    const store = mod.useIntegrationStore?.getState?.()
    if (!store || typeof store.setConversationState !== 'function') return null
    const prevState = store.conversationState
    if (prevState === 'SPEAKING') return null
    store.setConversationState('SPEAKING')
    return () => {
      const current = mod.useIntegrationStore?.getState?.()
      // Restaurar SOLO si seguimos en SPEAKING (no pisar un estado más nuevo)
      if (current && current.conversationState === 'SPEAKING') {
        current.setConversationState(prevState)
      }
    }
  } catch {
        logCaughtError('[catch] src/voice/lib/fluSpeech.js');
    return null
  }
}

let activeSpeechKey = ''
let activeSpeechPromise = null
let lastCompletedSpeechKey = ''
let lastCompletedSpeechAt = 0
let speechVoicesReady = false
// Watchdog del TTS: si un utterance no dispara `onend`/`onerror` (bug conocido
// de Chrome), `activeSpeechPromise` nunca resolvería y la escucha quedaría
// bloqueada para siempre. El temporizador acota esa espera.
let speechWatchdogTimer = null

function getSpeechCfg() {
  return FLU_CONFIG.speech || {}
}

function ensureSpeechVoicesReady() {
  if (speechVoicesReady || typeof window === 'undefined') return
  const synth = window.speechSynthesis
  if (!synth) return
  const markReady = () => {
    if (synth.getVoices().length) speechVoicesReady = true
  }
  markReady()
  if (!speechVoicesReady) {
    synth.addEventListener('voiceschanged', markReady, { once: true })
  }
}

function detectSpeechScriptLocale(text = '') {
  if (typeof text !== 'string' || !text) return null
  // Japonés: kana (hiragana/katakana), exclusivo del japonés → ja-JP
  if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP'
  // Chino: hanzi (CJK unificado) sin kana → zh-CN
  if (/[\u3400-\u9fff]/.test(text)) return 'zh-CN'
  // Coreano: hangul → ko-KR
  if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR'
  // Cirílico (ruso, ucraniano...) → ru-RU
  if (/[\u0400-\u04ff]/.test(text)) return 'ru-RU'
  // Árabe → ar-SA
  if (/[\u0600-\u06ff]/.test(text)) return 'ar-SA'
  // Griego → el-GR
  if (/[\u0370-\u03ff]/.test(text)) return 'el-GR'
  return null
}

function resolveSpeechLocale(language = 'es', text = '') {
  // Si el texto está escrito en un alfabeto distinto al configurado
  // (p.ej. japonés), el idioma de la voz lo decide el propio texto.
  const scriptLocale = detectSpeechScriptLocale(text)
  if (scriptLocale) return scriptLocale
  if (language === 'en') return SPEECH_LOCALES.en
  if (language === 'both') {
    return detectTranscriptLanguage(text) === 'en' ? SPEECH_LOCALES.en : SPEECH_LOCALES.es
  }
  return SPEECH_LOCALES.es
}

/** Trocea respuestas largas (Chrome falla en silencio con utterances largos). */
export function splitSpeechChunks(text = '', maxChars) {
  const spoken = cleanForSpeech(text)
  if (!spoken) return []
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Number(maxChars) : spoken.length
  if (spoken.length <= limit) return [spoken]

  const chunks = []
  let rest = spoken
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('. ', limit)
    if (cut < Math.floor(limit * 0.35)) cut = rest.lastIndexOf(', ', limit)
    if (cut < Math.floor(limit * 0.35)) cut = rest.lastIndexOf(' ', limit)
    if (cut <= 0) cut = limit
    const piece = rest.slice(0, cut).trim()
    if (piece) chunks.push(piece)
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks.filter(Boolean)
}

/**
 * C21 — API ÚNICA del motor TTS del navegador. Este módulo es el único que
 * toca el objeto global de síntesis; el resto de la app consume estas
 * funciones (getSpeechEngine/getSpeechVoices/subscribeSpeechVoices).
 */
export function getSpeechEngine() {
  return typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null
}

export function getSpeechVoices() {
  const engine = getSpeechEngine()
  return engine ? engine.getVoices() : []
}

export function subscribeSpeechVoices(listener) {
  const engine = getSpeechEngine()
  if (!engine) return () => {}
  if (typeof engine.addEventListener === 'function') {
    engine.addEventListener('voiceschanged', listener)
    return () => {
      if (typeof engine.removeEventListener === 'function') {
        engine.removeEventListener('voiceschanged', listener)
      }
    }
  }
  engine.onvoiceschanged = listener
  return () => {
    if (engine.onvoiceschanged === listener) engine.onvoiceschanged = null
  }
}

export function isSpeechSupported() {
  return Boolean(getSpeechEngine())
}

/** Cancela la cola del motor TTS (fuente única del control de síntesis). */
export function cancelSpeech() {
  const engine = getSpeechEngine()
  if (engine) engine.cancel()
}

export function isSpeechSynthesisSpeaking() {
  return typeof window !== 'undefined' && Boolean(window.speechSynthesis?.speaking)
}

/**
 * ¿FLU está hablando AHORA? Fuente de verdad de la supresión de eco: se basa
 * en la promesa propia del módulo (acotada por el watchdog), NO en el flag
 * global `speechSynthesis.speaking`, que puede quedar pegado en `true` y
 * silenciar la escucha hasta recargar la página.
 */
export function isFluSpeaking() {
  return Boolean(activeSpeechPromise)
}

export function isSpeechBusy() {
  if (activeSpeechPromise) return true
  if (typeof window === 'undefined' || !window.speechSynthesis) return false
  const synth = window.speechSynthesis
  return Boolean(synth.speaking || synth.pending)
}

/** Espera a que termine la cola TTS (promesa activa del módulo). */
export async function waitForSpeechIdle() {
  if (activeSpeechPromise) {
    try {
      await activeSpeechPromise
    } catch {
        logCaughtError('[catch] src/voice/lib/fluSpeech.js');
      // ignore
    }
  }
}

function speakSingleChunk(spoken, language, overrides = {}) {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      if (speechWatchdogTimer !== null) {
        clearTimeout(speechWatchdogTimer)
        speechWatchdogTimer = null
      }
      resolve()
    }

    try {
      ensureSpeechVoicesReady()
      const utterance = new SpeechSynthesisUtterance(spoken)
      utterance.lang = resolveSpeechLocale(language, spoken)

      // Aplicar configuración de voz desde el integrationStore de OS3
      const voiceCfg = getVoiceConfig()
      utterance.rate = voiceCfg.rate
      utterance.pitch = voiceCfg.pitch ?? 1
      utterance.volume = voiceCfg.volume ?? 1

      // Overrides por llamada (p.ej. "grito" de victoria en juegos):
      // solo aplican si vienen definidos; mantienen el rango W3C [0,1]
      // para volume y respetan la config de voz del perfil activo.
      if (typeof overrides.rate === 'number') utterance.rate = overrides.rate
      if (typeof overrides.pitch === 'number') utterance.pitch = overrides.pitch
      if (typeof overrides.volume === 'number') utterance.volume = overrides.volume

      // Selección de voz: si el texto está en un idioma distinto al configurado
      // (p.ej. japonés detectado por script), priorizar una voz que coincida con
      // ese locale; en caso contrario respetar la voiceURI configurada.
      const voices = window.speechSynthesis.getVoices()
      const primary = utterance.lang.split('-')[0].toLowerCase()
      const langPrimary = String(language).split('-')[0].toLowerCase()
      if (primary !== langPrimary && primary !== 'es' && primary !== 'en') {
        const matching =
          voices.find((v) => v.lang && v.lang.toLowerCase() === utterance.lang.toLowerCase()) ||
          voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(primary))
        if (matching) {
          utterance.voice = matching
        }
      } else if (voiceCfg.voiceURI) {
        const selected = voices.find((v) => v.voiceURI === voiceCfg.voiceURI)
        if (selected) {
          utterance.voice = selected
        }
      }

      utterance.onend = finish
      utterance.onerror = finish

      const synth = window.speechSynthesis
      if (getSpeechCfg().resumeBeforeSpeak !== false && typeof synth.resume === 'function') {
        synth.resume()
      }
      // Watchdog: acota la espera aunque el navegador no dispare onend/onerror.
      const watchdogMs = Number(getSpeechCfg().watchdogMs) || 20000
      if (speechWatchdogTimer !== null) clearTimeout(speechWatchdogTimer)
      speechWatchdogTimer = setTimeout(finish, watchdogMs)
      synth.speak(utterance)
    } catch {
        logCaughtError('[catch] src/voice/lib/fluSpeech.js');
      finish()
    }
  })
}

/**
 * @typedef {Object} SpeechResponseOptions
 * @property {boolean} [allowWhileSpeaking] - Permitir hablar mientras ya se habla.
 * @property {number} [volume] - Override de volumen por llamada (rango W3C [0,1]).
 * @property {number} [rate] - Override de velocidad por llamada.
 * @property {number} [pitch] - Override de tono por llamada.
 */

/**
 * Habla `text` con la voz configurada. Opciones opcionales por llamada.
 * @param {string} text
 * @param {string} [language]
 * @param {SpeechResponseOptions} [options]
 */
export function speakResponse(text, language = 'es', { allowWhileSpeaking = false, volume, rate, pitch } = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return Promise.resolve()
  }

  const spoken = cleanForSpeech(text)
  if (!spoken) {
    return Promise.resolve()
  }

  const speechKey = `${language}::${spoken}`
  const now = Date.now()

  if (activeSpeechPromise && activeSpeechKey === speechKey) {
    return activeSpeechPromise
  }

  if (
    !activeSpeechPromise &&
    lastCompletedSpeechKey === speechKey &&
    now - lastCompletedSpeechAt < 350
  ) {
    return Promise.resolve()
  }

  const synth = window.speechSynthesis
  
  // Si ya se está hablando y no se permite hablar simultáneamente,
  // NO cancelar el speech en curso porque interrumpe la animación de boca.
  // En su lugar, retornar la promesa existente o rechazar silenciosamente.
  if (!allowWhileSpeaking && (synth.speaking || synth.pending)) {
    // En lugar de cancelar, retornar la promesa existente si hay una
    if (activeSpeechPromise) {
      return activeSpeechPromise
    }
    // Sin promesa propia pero el sintetizador dice estar ocupado: el flag
    // global quedó pegado (bug de Chrome tras intercalar cancel/speak/resume).
    // Se limpia en vez de descartar el habla en silencio para siempre.
    try {
      synth.cancel()
    } catch {
        logCaughtError('[catch] src/voice/lib/fluSpeech.js');
      // ignore
    }
  }

  activeSpeechKey = speechKey
  const chunks = splitSpeechChunks(spoken, getSpeechCfg().chunkMaxChars)

  activeSpeechPromise = (async () => {
    // FLUJO UNIFICADO DE HABLA (única ruta): asegurar que el avatar entre en
    // SPEAKING (MouthMove) antes de hablar y restaurar el estado previo al
    // terminar. Idempotente: si ya está en SPEAKING (flujos que lo manejan
    // explícitamente — onContractResolved), no toca nada.
    const restoreSpeaking = await enterSpeakingState()
    try {
      // Refrescar configuración de voz desde el integrationStore de OS3
      // antes de hablar, para tomar la rate y voz seleccionada más reciente
      await refreshVoiceConfigCache()

      for (const chunk of chunks) {
        await speakSingleChunk(chunk, language, { volume, rate, pitch })
      }
    } finally {
      if (restoreSpeaking) restoreSpeaking()
      if (activeSpeechKey === speechKey) {
        activeSpeechKey = ''
        activeSpeechPromise = null
        lastCompletedSpeechKey = speechKey
        lastCompletedSpeechAt = Date.now()
      }
    }
  })()

  return activeSpeechPromise
}

export function speakInBackground(text, language = 'es') {
  speakResponse(text, language).catch(fluAsyncErrorHandler('fluSpeech'))
}
