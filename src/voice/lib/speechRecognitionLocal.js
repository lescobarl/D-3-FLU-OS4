/**
 * Envoltorio local de SpeechRecognition (navegador).
 */
import { getActiveListenConfig } from './fluConfig'
import { getRecognitionLanguage } from './activeListen'
import { relayLog } from '../../lib/clientLogRelay'

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

/**
 * §9.1: ÚNICA puerta de creación de instancias de reconocimiento. Todo
 * consumidor (motor de voz, onboarding) obtiene su instancia por aquí; nadie
 * más invoca la fábrica de Web Speech API.
 */
export function acquireSpeechRecognition(language = 'es', activeLocale = '') {
  return createSpeechRecognition(language, activeLocale)
}

export function bindSpeechRecognition(recognition, handlers = {}) {
  if (!recognition) return

  recognition.onstart = handlers.onStart || null
  recognition.onresult = handlers.onResult || null
  recognition.onerror = handlers.onError || null
  recognition.onend = handlers.onEnd || null
}

// ============================================================
// §9.1: UNA sola escucha activa a la vez (choke point central).
// Toda instancia arranca/para por estos envoltorios; nadie llama
// `.start()`/`.stop()` directo. El lock evita la doble captura
// (motor principal + onboarding) y nunca queda pegado: al arrancar
// una segunda instancia se detiene la anterior (última gana).
// ============================================================
let activeRecognition = null

/** Instancia que está capturando ahora mismo (o null). Solo lectura. */
export function getActiveRecognition() {
  return activeRecognition
}

/** Solo para tests: limpia el lock entre casos. */
export function resetActiveRecognitionForTest() {
  activeRecognition = null
}

export function startSpeechRecognition(recognition) {
  if (!recognition) return false
  if (activeRecognition && activeRecognition !== recognition) {
    // Otra instancia estaba capturando: se detiene antes de arrancar esta.
    stopSpeechRecognition(activeRecognition)
  }
  try {
    recognition.start()
    activeRecognition = recognition
    return true
  } catch (error) {
    const message = String(error?.message || error).toLowerCase()
    if (message.includes('already') && message.includes('start')) {
      activeRecognition = recognition
      return true
    }
    return false
  }
}

export function stopSpeechRecognition(recognition) {
  if (!recognition) return
  try {
    recognition.stop()
  } catch (error) {
    relayLog('INFO', 'SpeechRecognition', 'stop() falló al detener la escucha (ignorado)', error)
  }
  if (activeRecognition === recognition) {
    activeRecognition = null
  }
}

/** Aborta (anti-eco) y libera el lock para que otro flujo pueda escuchar. */
export function abortSpeechRecognition(recognition) {
  if (!recognition) return
  try {
    if (typeof recognition.abort === 'function') recognition.abort()
    else recognition.stop()
  } catch (error) {
    relayLog('INFO', 'SpeechRecognition', 'abort() falló al liberar la escucha (ignorado)', error)
  }
  if (activeRecognition === recognition) {
    activeRecognition = null
  }
}
