/**
 * Envoltorio local de SpeechRecognition (navegador).
 */
import { getActiveListenConfig } from './fluConfig'
import { getRecognitionLanguage } from './activeListen'
import { relayLog } from '../../lib/clientLogRelay'
import { logCaughtError } from '../../lib/caughtError';

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

  const onStart = handlers.onStart || null
  const onEnd = handlers.onEnd || null
  // El ciclo de vida del lock lo gobiernan los EVENTOS reales del motor, no el
  // llamante: `onstart` marca captura y `onend` la libera. Sin esto el lock se
  // quedaba pegado tras `onend` (el motor ya paro) o se creia "capturando" antes
  // de arrancar.
  recognition.onstart = (event) => {
    capturing.add(recognition)
    if (onStart) onStart(event)
  }
  recognition.onend = (event) => {
    capturing.delete(recognition)
    if (activeRecognition === recognition) activeRecognition = null
    if (onEnd) onEnd(event)
  }
  recognition.onresult = handlers.onResult || null
  recognition.onerror = handlers.onError || null
}

// ============================================================
// §9.1: UNA sola escucha activa a la vez (choke point central).
// Toda instancia arranca/para por estos envoltorios; nadie llama
// `.start()`/`.stop()` directo. El lock evita la doble captura
// (motor principal + onboarding) y nunca queda pegado: al arrancar
// una segunda instancia se detiene la anterior (última gana).
// ============================================================
let activeRecognition = null

/** Instancias que estan CAPTURANDO ahora mismo (se marca en `onstart`, se limpia en `onend`). */
const capturing = new WeakSet()

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
  // YA capturando: un segundo `start()` lanza `InvalidStateError: recognition has
  // already started` (medido en la sesion del dueno). No se re-arranca ni se
  // instancia otra escucha; el motor ya esta capturando.
  if (activeRecognition === recognition && capturing.has(recognition)) return true
  if (activeRecognition && activeRecognition !== recognition) {
    // Otra instancia estaba capturando: se detiene antes de arrancar esta.
    stopSpeechRecognition(activeRecognition)
  }
  try {
    recognition.start()
    activeRecognition = recognition
    // P9.70: marcar la captura al INTENTAR start(), no depender del evento `onstart` ni del
    // TEXTO del error. Si `onstart` no llegaba, la guarda de la linea 87 no veia la captura y
    // un 2.o start() volvia a llamar start() -> InvalidStateError, que solo se absorvia si el
    // mensaje decia 'already started'; con otro idioma/version del motor la rama no entraba,
    // devolvia false y el micro NO volvia, en silencio.
    capturing.add(recognition)
    return true
  } catch (error) {
        logCaughtError('[catch] src/voice/lib/speechRecognitionLocal.js', error);
    const message = String(error?.message || error).toLowerCase()
    if (message.includes('already') && message.includes('start')) {
      activeRecognition = recognition
      capturing.add(recognition)
      return true
    }
    return false
  }
}

export function stopSpeechRecognition(recognition) {
  if (!recognition) return
  capturing.delete(recognition)
  try {
    recognition.stop()
  } catch (error) {
    logCaughtError('[catch] src/voice/lib/speechRecognitionLocal.js', error);
    relayLog('INFO', 'SpeechRecognition', 'stop() falló al detener la escucha (ignorado)', error)
  }
  if (activeRecognition === recognition) {
    activeRecognition = null
  }
}

/** Aborta (anti-eco) y libera el lock para que otro flujo pueda escuchar. */
export function abortSpeechRecognition(recognition) {
  if (!recognition) return
  capturing.delete(recognition)
  try {
    if (typeof recognition.abort === 'function') recognition.abort()
    else recognition.stop()
  } catch (error) {
    logCaughtError('[catch] src/voice/lib/speechRecognitionLocal.js', error);
    relayLog('INFO', 'SpeechRecognition', 'abort() falló al liberar la escucha (ignorado)', error)
  }
  if (activeRecognition === recognition) {
    activeRecognition = null
  }
}
