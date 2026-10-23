/**
 * Envoltorio local de SpeechRecognition (navegador).
 */
import { getActiveListenConfig } from './fluConfig'
import { getRecognitionLanguage } from './activeListen'
import { relayLog } from '../../lib/clientLogRelay'
import { logCaughtError } from '../../lib/caughtError';
import { defaultLanguage } from './languageDefault.ts'

export function isSpeechRecognitionSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function createSpeechRecognition(language = defaultLanguage(), activeLocale = '') {
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
export function acquireSpeechRecognition(language = defaultLanguage(), activeLocale = '') {
  return createSpeechRecognition(language, activeLocale)
}

export function bindSpeechRecognition(recognition, handlers = {}) {
  if (!recognition) return

  const onStart = handlers.onStart || null
  const onEnd = handlers.onEnd || null
  // El ciclo de vida del lock: la captura se marca al INTENTAR start() (P9.70) y
  // `onstart` CONFIRMA el arranque (P9.76); `onend` libera las dos marcas. Sin esto el
  // lock quedaba pegado tras `onend` o se creia "capturando" antes de arrancar.
  recognition.onstart = (event) => {
    capturing.add(recognition)
    confirmed.add(recognition)
    if (onStart) onStart(event)
  }
  recognition.onend = (event) => {
    capturing.delete(recognition)
    confirmed.delete(recognition)
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

/** Instancias con start() INTENTADO (P9.70: se marca al intentar; se limpia en `onend`/stop). */
let capturing = new WeakSet()
/** Instancias cuyo arranque CONFIRMO el motor (`onstart`) - P9.76. */
let confirmed = new WeakSet()
/** Instancias cuyo ULTIMO start() fallo (estado `failed` de la API de estados). */
let failed = new WeakSet()

/** Instancia que está capturando ahora mismo (o null). Solo lectura. */
export function getActiveRecognition() {
  return activeRecognition
}

/** Solo para tests: limpia el lock entre casos. */
export function resetActiveRecognitionForTest() {
  activeRecognition = null
  // Los WeakSet no se pueden vaciar: se recrean (reset solo de tests; si olvidara las
  // marcas, el caso siguiente mediria el estado del anterior).
  capturing = new WeakSet()
  confirmed = new WeakSet()
  failed = new WeakSet()
}

/**
 * Estado REAL del motor de reconocimiento para una instancia.
 *
 * Tres estados, un solo dueno: `starting` (start() aceptado, `onstart` aun no),
 * `started` (el motor confirmo `onstart`), `failed` (el ultimo start() lanzo y no se
 * pudo arrancar) y `idle` (no es la captura activa). Antes el llamador solo tenia un
 * booleano y no podia distinguir "arrancando" de "arrancado" (auditoria 2026-10-23).
 * @param {object|null} recognition instancia de SpeechRecognition
 * @returns {'starting'|'started'|'failed'|'idle'}
 */
export function speechRecognitionState(recognition) {
  if (!recognition) return 'idle'
  if (failed.has(recognition)) return 'failed'
  if (activeRecognition !== recognition || !capturing.has(recognition)) return 'idle'
  return confirmed.has(recognition) ? 'started' : 'starting'
}

export function startSpeechRecognition(recognition) {
  if (!recognition) return false
  // YA capturando: un segundo `start()` lanza `InvalidStateError: recognition has
  // already started` (medido en la sesion del dueno). No se re-arranca ni se
  // instancia otra escucha; el motor ya esta capturando.
  // P9.76: el lock NO re-arranca (1 sola llamada a start()) pero el valor dice si el motor
  // CONFIRMO el arranque (`onstart`). Sin confirmar devuelve false para que el llamante
  // conserve su via de recuperacion (stop + retry + rebuild): antes devolvia true siempre
  // y esa senal desaparecia (el micro podia quedarse muerto en silencio).
  if (activeRecognition === recognition && capturing.has(recognition)) {
    // ESTADOS (auditoria 2026-10-23): "arrancando" y "arrancado" NO son lo mismo, pero
    // ambos significan "no re-arrancar". Devolver `false` mientras `onstart` no llegaba
    // hacia que el llamador reiniciara el micro creyendo que no estaba capturando.
    // El estado fino se consulta con `speechRecognitionState`.
    return true
  }
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
    failed.delete(recognition)
    return true
  } catch (error) {
        logCaughtError('[catch] src/voice/lib/speechRecognitionLocal.js', error);
    const message = String(error?.message || error).toLowerCase()
    if (message.includes('already') && message.includes('start')) {
      // El motor DICE que ya esta arrancado: confirmacion explicita (P9.76).
      activeRecognition = recognition
      capturing.add(recognition)
      confirmed.add(recognition)
      failed.delete(recognition)
      return true
    }
    failed.add(recognition)
    return false
  }
}

export function stopSpeechRecognition(recognition) {
  if (!recognition) return
  capturing.delete(recognition)
  confirmed.delete(recognition)
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
  confirmed.delete(recognition)
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
