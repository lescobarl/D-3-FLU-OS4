import { cleanForSpeech, detectTranscriptLanguage } from './audioMath.js'
import { FLU_CONFIG } from './fluConfig.js'
import { fluAsyncErrorHandler } from './fluAsyncError.js'

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
  } catch {
    // Si falla el import (entorno test, standalone, etc.), usar defaults
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
    return null
  }
}

let activeSpeechKey = ''
let activeSpeechPromise = null
let lastCompletedSpeechKey = ''
let lastCompletedSpeechAt = 0
let speechVoicesReady = false

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
  if (language === 'en') return 'en-US'
  if (language === 'both') {
    return detectTranscriptLanguage(text) === 'en' ? 'en-US' : 'es-MX'
  }
  return 'es-MX'
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

export function isSpeechSynthesisSpeaking() {
  return typeof window !== 'undefined' && Boolean(window.speechSynthesis?.speaking)
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
      // ignore
    }
  }
}

function speakSingleChunk(spoken, language) {
  return new Promise((resolve) => {
    const finish = () => resolve()

    try {
      ensureSpeechVoicesReady()
      const utterance = new SpeechSynthesisUtterance(spoken)
      utterance.lang = resolveSpeechLocale(language, spoken)

      // Aplicar configuración de voz desde el integrationStore de OS3
      const voiceCfg = getVoiceConfig()
      utterance.rate = voiceCfg.rate
      utterance.pitch = voiceCfg.pitch ?? 1
      utterance.volume = voiceCfg.volume ?? 1

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
      synth.speak(utterance)
    } catch {
      finish()
    }
  })
}

export function speakResponse(text, language = 'es', { allowWhileSpeaking = false } = {}) {
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
    // Si no hay promesa activa pero synth está hablando (podría ser de otra fuente),
    // simplemente ignorar esta solicitud para no interrumpir
    return Promise.resolve()
  }

  activeSpeechKey = speechKey
  const chunks = splitSpeechChunks(spoken, getSpeechCfg().chunkMaxChars)

  activeSpeechPromise = (async () => {
    // FLUJO UNIFICADO DE HABLA (única ruta): asegurar que el avatar entre en
    // SPEAKING (MouthMove) antes de hablar y restaurar el estado previo al
    // terminar. Idempotente: si ya está en SPEAKING (flujos que lo manejan
    // explícitamente — onContractResolved, handleSpeak), no toca nada.
    const restoreSpeaking = await enterSpeakingState()
    try {
      // Refrescar configuración de voz desde el integrationStore de OS3
      // antes de hablar, para tomar la rate y voz seleccionada más reciente
      await refreshVoiceConfigCache()

      for (const chunk of chunks) {
        await speakSingleChunk(chunk, language)
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
