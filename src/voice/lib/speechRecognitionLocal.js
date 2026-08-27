/**
 * Envoltorio local de SpeechRecognition (navegador).
 */
import { getActiveListenConfig } from './fluConfig'
import {
  getRecognitionLanguage,
  isBilingualListenMode,
  listBilingualLocales,
} from './activeListen'

export function isSpeechRecognitionSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function createSpeechRecognition(language = 'es', activeLocale = '') {
  if (!isSpeechRecognitionSupported()) return null

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
  const { recognition } = getActiveListenConfig()
  const instance = new Recognition()

  instance.lang = getRecognitionLanguage(language, activeLocale)
  instance.interimResults = recognition.interimResults
  instance.continuous = recognition.continuous
  instance.maxAlternatives = recognition.maxAlternatives

  return instance
}

/** Instala paquetes de idioma on-device cuando el navegador lo soporta (Chrome). */
export async function ensureSpeechRecognitionLocales(language = 'es') {
  if (typeof window === 'undefined' || !isSpeechRecognitionSupported()) return false

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (typeof Recognition.install !== 'function') return false

  const locales = isBilingualListenMode(language)
    ? listBilingualLocales()
    : [getRecognitionLanguage(language)].filter(Boolean)

  try {
    await Recognition.install({ langs: locales })
    return true
  } catch {
    return false
  }
}

export function bindSpeechRecognition(recognition, handlers = {}) {
  if (!recognition) return

  recognition.onstart = handlers.onStart || null
  recognition.onresult = handlers.onResult || null
  recognition.onerror = handlers.onError || null
  recognition.onend = handlers.onEnd || null
}

export function startSpeechRecognition(recognition) {
  if (!recognition) return false
  try {
    recognition.start()
    return true
  } catch (error) {
    const message = String(error?.message || error).toLowerCase()
    if (message.includes('already') && message.includes('start')) {
      return true
    }
    return false
  }
}

export function stopSpeechRecognition(recognition) {
  if (!recognition) return
  try {
    recognition.stop()
  } catch {
    // ignore
  }
}
