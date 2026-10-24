/**
 * Preview y commit del stream de conversación (mic -> UI/log).
 * Extraído de useFluVoiceAssistant para aislar la ruta syncConversationStream.
 */
import { cleanForSpeech, detectWakeIntroducedName, formatClock, sameRequestWindowMs, stripDiacritics } from './audioMath.js'
import { normalizeMicText } from './speechMerge.js'
import { resolveInlineWakeAtCommit, isTurnCapture, requiresWakeWord } from './wakeTurnCommit.js'
import { getAsrSegmentationCfg, getTranscriptPolicyCfg } from './fluTranscriptMotor.js'
import { getTranscriptPauseCfg } from './fluTranscriptPause.js'
import { FLU_CONFIG } from './fluConfig.js'
import {
  resolveMicCommitAction,
  isDuplicateTurnCommit,
  isFragmentOfLocution,
  reconcileCommitText,
} from './turnStream.js'
import {
  advancePublishedDisplay,
  clearPendingFinal,
  detectNextSpeakerPhrase,
  getSpeakerLabel,
  phrasesEquivalent,
  readSession,
  shouldRefreshStream,
  syncSpeakerIndexFromLabel,
  utterancesSameRevision,
  committedEchoStreakWindowMs,
} from './activeListen.js'
import { readTurnLive, countSharedSpeechWords, conservaLasPalabrasDe } from './conversationStream.js'
import { canonSinTartamudeo } from './transcriptIngress.js'
import { debugHotPath, fluDebugHot } from './fluDebug.js'
import { relayLog } from '../../lib/clientLogRelay'
import { voiceProbe } from './voiceProbe'
import { finalizeTurnIdentityPipeline } from './turnIdentityPipeline.js'
import { planAsrTurnSegments, segmentPlanCoversCapture } from './asrTurnSegmentation.js'
import { resolveTurnSpeakerAtCommit, applyResolvedSpeakerToSessionRefs } from './turnSpeakerCommit.js'
import {
  anchorResolvedToLastLogged,
  blindSpeakerFallback,
  resolveCommitStickyFallback,
  isWeakAsrSpeakerEvidence,
} from './speakerPolicy.js'
import { markCommitPerfNow } from './audioSegmentClock.js'
import { labelToSpeakerId } from './conversationRow.js'
import { renameSpeakerRows } from './conversationTurnRow'

import { preflightEvidenceMeasured } from './turnSpeakerPreflight.js'
import { isSessionPrimaryPresented } from './sessionPrimarySpeaker.js'
import { normalizeSpeakerLabel, isAutoSpeakerLabel } from './voiceIdentity.js'
import { isSameEmissionWithinWindow } from './captureDedup.js'
import { DISCARD_REASONS, discardLocution } from './phraseDiscard.js'

/**
 * Fabrica UNICA de la instantanea FINAL de hablante del turno. La usan los DOS pasos
 * del cierre: la espera acotada antes del commit (`primeTurnSpeakerPreflight`) y el
 * propio commit (via `finalizeTurnIdentityPipeline`). Un solo dueño de los argumentos
 * del resolver evita que la espera y el commit midieran audios distintos.
 * @param {{ createSpeakerAudioResolver?: Function, phrase?: string, turnId?: number }} [options]
 * @returns {Function} resolutor (fabrica ya desenvuelta)
 */
export function buildFinalSpeakerSnapshotResolver({ createSpeakerAudioResolver, phrase = '', turnId } = {}) {
  return () =>
    typeof createSpeakerAudioResolver === 'function'
      ? createSpeakerAudioResolver({
          atTurnBoundary: true,
          allowNewCluster: true,
          utterance: phrase,
          // El FINAL resuelve TARDE: el id se fija al commit para que lea el audio de
          // ESTE turno (`turnAudioSnapshot`) y no el del turno que ya empezo.
          turnId,
        })
      : undefined
}

/**
 * @typedef {Object} ConversationStreamCommitPayload
 * @property {string} [capture]
 * @property {boolean} [newParagraph]
 * @property {string} [speaker]
 * @property {string} [utterance]
 * @property {boolean} [freshUtterance]
 * @property {boolean} [turnCommit]
 * @property {boolean} [turnBoundary]
 * @property {boolean} [diarize]
 * @property {boolean} [atTurnBoundary]
 * @property {boolean} [forceNewRowOnSegment]
 * @property {boolean} [settlesTurn] Cierre REAL del turno (onend/srGap/wake-split):
 *   un `final` de SEGMENTO de Chrome NO lo declara.
 * @property {number|null} [turnId] Turno al que pertenece una captura ya CERRADA
 *   (`locutionClosed`). Lo sella el ingress al derramar `pendingFinal`; el cierre solo
 *   adopta la caja cuando AMBOS turnos se conocen y coinciden.
 * @property {boolean} [confirmedFinal] La captura es un `final` de SEGMENTO: texto
 *   CONFIRMADO por el ASR. No cierra el turno, pero es la frase canonica de la
 *   locucion y la caja la adopta (nunca encoge).
 * @property {boolean} [locutionClosed] La captura es una locucion YA CONFIRMADA y
 *   CERRADA (volcado de `pendingFinal`): no se reconcilia contra la linea viva.
 * @property {boolean} [closeTurnOnly] La orden ya consumio la linea viva: solo se
 *   CIERRA el turno, sin commitear ni tocar la captura.
 * @property {boolean} [commandTurn] El commit lo produjo una ORDEN (comando/consulta).
 *   Con la wake AL INICIO la locucion NO se cierra: el usuario sigue dictando y la caja
 *   conserva el mandato. La procedencia la lee el pelado del preview para no arrancar
 *   del texto de una orden que sigue viva.
 * @property {number} [preflightTurnId] Turno cuyo preflight ya ESPERO el llamador
 *   (`primeTurnSpeakerPreflight`, dueno unico de la espera). El cierre consume ESE
 *   slot: sin el, el sorteo del turno siguiente (`ensureTurnId`) dejaba el commit
 *   leyendo un slot vacio y la evidencia medida no llegaba a la fila (medido en el
 *   log del dueno 2026-10-15: `Preflight turn=29 ready=true` y `commit turn=30
 *   preReady=false`, 34/34 commits).
 */

/**
 * Refs, callbacks y estado compartido inyectados desde useFluVoiceAssistant.
 *
 * @typedef {Object} ConversationStreamCommitDeps
 * @property {import('react').MutableRefObject<boolean>} conversationActiveRef
 * @property {import('react').MutableRefObject<string>} publishedLiveRef
 * @property {import('react').MutableRefObject<object>} listenStateRef
 * @property {import('react').MutableRefObject<boolean>} openPreviewTurnRef
 * @property {(capture: string) => void} scheduleLiveTranscriptUpdate
 * @property {(capture: string) => void} setLiveTranscript
 * @property {(phrase: string, fallbackSpeaker: string, options?: object) => void} applyConversationSpeaker
 * @property {() => void} flushPendingStreamLog
 * @property {import('react').MutableRefObject<string[]>} logRowsTextRef
 * @property {import('react').MutableRefObject<number>} activeTurnIdRef
 * @property {() => void} flushPcmAfterTurnCommit
 * @property {import('react').MutableRefObject<number>} lastCommitAtRef
 * @property {import('react').MutableRefObject<number>} lastOnresultAtRef
 * @property {import('react').MutableRefObject<number>} turnAudioStartSampleRef
 * @property {import('react').MutableRefObject<number>} chunkTotalSamplesRef
 * @property {import('react').MutableRefObject<boolean>} preflightScheduledForTurnRef
 * @property {import('react').MutableRefObject<boolean>} srGapFiredForOpenLineRef
 * @property {import('react').MutableRefObject<(capture: string, action: object) => void | Promise<void>>} processConversationFluQueryRef
 * @property {import('react').MutableRefObject<string>} lastEmittedTranscriptRef
 * @property {(capture: string, options?: object) => boolean} emitConversationLog
 * @property {(options?: object) => object} createSpeakerAudioResolver
 * @property {import('react').MutableRefObject<string>} sessionPrimarySpeakerRef
 * @property {import('react').MutableRefObject<string>} lastLoggedSpeakerRef
 * @property {import('react').MutableRefObject<string[]>} logRowSpeakersRef
 * @property {import('react').MutableRefObject<object[]>} speakerClustersRef
 * @property {import('react').MutableRefObject<string>} lastSpeakerRef
 * @property {import('react').MutableRefObject<number[]|null>} lastTurnSignatureRef
 * @property {import('react').MutableRefObject<string>} lastLogLineTextRef
 * @property {import('react').MutableRefObject<boolean>} [lastLogLineWasCommandRef] La
 *   ultima linea commiteada la escribio una ORDEN y su locucion sigue viva.
 * @property {(capture: string, speakerName: string, options?: object) => void} commitTurnToSessionRows
 * @property {import('react').MutableRefObject<{ onTurnCommitted?: () => void }|null>} fluParticipantRef
 * @property {import('react').MutableRefObject<{ text?: string, at?: number }>} [lastRequestRef]
 */

/**
 * Clave comparable de una palabra de la caja: sin caja ni signos, con el texto original
 * intacto para poder publicar la cola tal cual (el replay midio que la union perdia
 * mayusculas: 'Daniel' -> 'daniel').
 * @param {string} palabra
 * @returns {string}
 */
export function claveDePalabra(palabra) {
  // El plegado de acentos tiene UN dueno (textUtils.stripDiacritics, via audioMath):
  // aqui solo se quitan los signos, para comparar palabras.
  return stripDiacritics(String(palabra || '')).replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Es la MISMA palabra con otra ortografia: iguales, o una es el ARRANQUE de la otra (el
 * ASR completa la palabra: 'prueba' -> 'pruebas', 'tar' -> 'tardo'). Nunca con menos de
 * 3 letras compartidas: 'a'/'al' o 'la'/'las' no son la misma palabra.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function mismaPalabraClave(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const corta = a.length <= b.length ? a : b
  const larga = a.length <= b.length ? b : a
  // POLITICA DE TRANSCRIPCION (una tabla): `transcript.policy.sameWordMinLetters`.
  const minLetras = Number(getTranscriptPolicyCfg().sameWordMinLetters) || 2
  return corta.length >= minLetras && larga.startsWith(corta)
}

/**
 * Comparacion de palabras de la CAJA: misma clave sin distinguir mayusculas (el ASR
 * reescribe "vamos" como "Vamos" en la misma frase).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function mismaPalabraDeLaCaja(a = '', b = '') {
  return mismaPalabraClave(claveDePalabra(a).toLowerCase(), claveDePalabra(b).toLowerCase())
}

/**
 * Palabras comparables de un texto de la caja (clave de palabra, sin vacias).
 * @param {string} texto
 * @returns {string[]}
 */
function palabrasDeLaCaja(texto = '') {
  return String(texto || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) => claveDePalabra(palabra))
    .filter(Boolean)
}

/**
 * El BOCETO no dice nada que la FRASE CANONICA no diga ya: todas sus palabras aparecen
 * en la frase, en orden. Es el caso del canon limpiando el ASR ("puso Cloud Cloud" vs
 * "puso Cloud"): la caja puede ceder sin perder habla. Si el boceto lleva habla AJENA
 * (la locucion siguiente) devuelve false y la caja NO se sustituye: ahi sigue mandando
 * el no-encogimiento.
 * @param {string} mostrado Lo que la caja muestra.
 * @param {string} frase Frase canonica (cierre o final confirmado).
 * @returns {boolean}
 */
function bocetoCubiertoPor(mostrado = '', frase = '') {
  const boceto = palabrasDeLaCaja(mostrado)
  const canonica = palabrasDeLaCaja(frase)
  if (!boceto.length || !canonica.length) return false
  let j = 0
  let ultima = ''
  for (const palabra of boceto) {
    if (ultima && mismaPalabraClave(palabra, ultima)) continue
    while (j < canonica.length && !mismaPalabraClave(palabra, canonica[j])) j += 1
    if (j >= canonica.length) return false
    ultima = canonica[j]
    j += 1
  }
  return true
}

/**
 * La palabra nueva es la MISMA palabra CRECIENDO ("du" -> "dupli" -> "duplica")?
 *
 * Exige prefijo ESTRICTO de >= 2 letras: el doble legitimo ("no no") NO crece (claves
 * iguales) y una palabra distinta que empieza igual ("la" -> "largo") tampoco cuenta
 * como la misma si no comparte la clave completa del arranque.
 *
 * @param {string} mostrada Palabra que la caja ya muestra.
 * @param {string} nueva Primera palabra de la emision.
 * @returns {boolean}
 */
export function palabraQueCrece(mostrada = '', nueva = '') {
  const a = claveDePalabra(mostrada).toLowerCase()
  const b = claveDePalabra(nueva).toLowerCase()
  if (!a || !b || a === b) return false
  if (b.length <= a.length) return false
  return b.startsWith(a)
}

/**
 * La emisión **REENTREGA lo mostrado EN ORDEN y sigue con más palabras**? Entonces es la
 * MISMA locución creciendo (el ASR la vuelve a entregar entera), no una palabra que se
 * completa.
 *
 * Existe porque una palabra CORTA de la caja es ARRANQUE de la primera palabra de la
 * reentrega ("mi" -> "mientras", "la" -> "largo") y la rama de `palabraQueCrece` pegaba la
 * emisión ENTERA detrás. Defecto medido en d4c1c8f3 (commit #13 de la fila):
 * caja "…el menjurje en mi" + emisión "…el menjurje en mi pla"
 * -> "... el menjurje en mientras vamos a preparar el menjurje en mi pla" (bloque duplicado,
 * 4 valores de caja y la fila duplicada). Cuando esto es cierto, la decisión vuelve al
 * alineado de cola (`(A)`/`(B)`), que completa la última palabra y añade SOLO lo que falta.
 *
 * @param {string[]} mostradas Palabras que la caja muestra.
 * @param {string[]} nuevas Palabras de la emisión.
 * @returns {boolean}
 */
export function reentregaLoMostrado(mostradas = [], nuevas = []) {
  if (!mostradas.length || !nuevas.length) return false
  // REENTREGA = la emision repite la locucion DESDE EL PRINCIPIO, coincidiendo en todas las
  // palabras mostradas MENOS la ultima (la que puede estar creciendo). NO exige que la
  // emision sea MAS LARGA: "… hablando de un" reentregada como "… hablando de" es la MISMA
  // locucion, y tomarla por "la ultima palabra creciendo" pegaba la emision ENTERA detras de
  // la caja, que la mostraba dos veces (medido en cec7281d: 238 -> 471 chars, el bloque
  // "unidad de medida actualizada" repetido).
  // Con UNA sola palabra mostrada no hay locucion que reentregar: ahi manda el crecimiento
  // de esa palabra ("du" -> "dupli"), y por eso se devuelve false.
  if (mostradas.length < 2) return false
  if (nuevas.length < mostradas.length - 1) return false
  const clavesMostradas = mostradas.map(claveDePalabra)
  const clavesNuevas = nuevas.map(claveDePalabra)
  const comparables = Math.min(clavesMostradas.length - 1, clavesNuevas.length)
  for (let i = 0; i < comparables; i += 1) {
    if (!mismaPalabraClave(clavesMostradas[i], clavesNuevas[i])) return false
  }
  return true
}

/**
 * Cola NUEVA de una emision: alinea el FINAL de lo mostrado con un tramo de la emision
 * nueva (el ASR reentrega la cola y sigue) y devuelve SOLO lo que viene DESPUES de ese
 * tramo, con el texto CRUDO de la emision (mas la letra que completa la ultima palabra
 * si la emision trae la version larga). Sin solape fiable no se inventa nada: '' =
 * no hay nada genuino que anadir (bloquear). Nunca quita texto de lo mostrado.
 * @param {string} mostrado
 * @param {string} nuevo
 * @returns {string}
 */
/** La emision ARRANCA con la cola de lo mostrado (reentrega genuina, no otra hipotesis). */
function arrancaConLaColaDe(mostradas = [], nuevas = []) {
  const max = Math.min(mostradas.length, nuevas.length)
  for (let k = max; k >= 1; k -= 1) {
    let igual = true
    for (let j = 0; j < k; j += 1) {
      if (claveDePalabra(mostradas[mostradas.length - k + j]) !== claveDePalabra(nuevas[j])) {
        igual = false
        break
      }
    }
    if (igual) return true
  }
  return false
}

/** Palabras iguales desde el principio (dueno: `countSharedSpeechWords`, conversationStream). */
function palabrasCompartidasAlArranque(mostradas = [], nuevas = []) {
  return countSharedSpeechWords(mostradas.join(' '), nuevas.join(' '))
}

/**
 * La emision empieza con un TRAMO de lo mostrado (>=2 palabras) cuya PRIMERA palabra
 * coincide EXACTA. Una palabra que solo "crece" ("prepara" vs "preparar") no es una
 * reentrega: es otra hipotesis del mismo audio (medido: "vamos a preparar la receta" +
 * "prepara la receta completa..." fabricaba "vamos a preparar la receta completa...").
 */
function empiezaConTramoExacto(mostradas = [], nuevas = []) {
  if (nuevas.length < 2 || !mostradas.length) return false
  const primera = claveDePalabra(nuevas[0])
  for (let i = 0; i < mostradas.length; i += 1) {
    if (claveDePalabra(mostradas[i]) !== primera) continue
    let k = 1
    while (
      k < nuevas.length &&
      i + k < mostradas.length &&
      mismaPalabraClave(claveDePalabra(mostradas[i + k]), claveDePalabra(nuevas[k]))
    ) {
      k += 1
    }
    if (k >= 2) return true
  }
  return false
}

/**
 * La emision CONTINUA lo mostrado (misma locucion), no es otra hipotesis del mismo audio.
 * Tres formas legitimas:
 *  (a) empieza con TODO lo mostrado (extension) o lo mostrado empieza con ella;
 *  (b) comparte un arranque largo (>=3 palabras): misma frase con la cola revisada;
 *  (c) reentrega la COLA de lo mostrado al principio de la emision.
 * Un bloque INTERIOR compartido con OTRO arranque no es continuacion: unirlo fabricaba
 * una frase que nadie dijo ("vamos a preparar la receta" + "prepara la receta completa").
 */
function empiezaComoLoMostrado(mostradas = [], nuevas = []) {
  if (!mostradas.length || !nuevas.length) return false
  const comunes = palabrasCompartidasAlArranque(mostradas, nuevas)
  if (comunes >= Math.min(mostradas.length, nuevas.length)) return true
  if (comunes >= 3) return true
  if (comunes >= 1 && nuevas[comunes]) {
    // La primera palabra que DIVERGE: si la de la emision es la misma creciendo (o al
    // reves), es la misma frase (la ultima palabra mostrada se completa).
    const mostradaDivergente = mostradas[comunes] ? claveDePalabra(mostradas[comunes]) : ''
    const nuevaDivergente = claveDePalabra(nuevas[comunes])
    if (
      mostradaDivergente &&
      (nuevaDivergente.startsWith(mostradaDivergente) || mostradaDivergente.startsWith(nuevaDivergente))
    ) {
      return true
    }
    if (comunes >= 2) return true
  }
  return arrancaConLaColaDe(mostradas, nuevas) || empiezaConTramoExacto(mostradas, nuevas)
}

export function colaNuevaTrasSolape(mostrado, nuevo) {
  // La reentrega vive SIEMPRE al final de lo mostrado: se alinea contra la COLA (ventana
  // acotada) y la cola a anadir no puede estar ya ahi (nada se duplica ni se infla).
  const VENTANA = 160
  const crudas = String(mostrado || '').trim().split(/\s+/).filter(Boolean)
  const crudasNuevas = String(nuevo || '').trim().split(/\s+/).filter(Boolean)
  if (!crudas.length || !crudasNuevas.length) return ''
  // (0) COMPLETAR LA ULTIMA PALABRA, no pegarla (medido 2026-10-21: la caja mostraba
  // "du dupli duplica"). El ASR hace CRECER la palabra que la caja ya tiene: se
  // REEMPLAZA la ultima palabra por la forma completa y el resto de la emision se
  // anade detras. Antes el caso de UNA sola palabra se descartaba arriba
  // (`crudasNuevas.length < 2`) y la caja se quedaba con la parcial hasta el final.
  // GUARDA (medido d4c1c8f3): si la emision REENTREGA lo mostrado en orden y sigue, no
  // hay palabra creciendo sino la MISMA locucion mas larga. Sin esta guarda, la palabra
  // corta del borde ("mi") se tomaba por el arranque de la primera palabra de la
  // reentrega ("mientras") y la locucion entera se pegaba detras (bloque duplicado).
  if (
    !reentregaLoMostrado(crudas, crudasNuevas) &&
    palabraQueCrece(crudas[crudas.length - 1], crudasNuevas[0])
  ) {
    return crudas.slice(0, -1).concat(crudasNuevas).join(' ')
  }
  if (crudasNuevas.length < 2) return ''
  // REENTREGA GENUINA: la emision debe CONTINUAR lo mostrado (mismo arranque o reentrega
  // de la cola). Un bloque INTERIOR compartido con otro arranque es otra HIPOTESIS del
  // mismo audio: unirlo fabricaba una frase que nadie dijo (medido: "vamos a preparar la
  // receta" + "prepara la receta completa con..." -> "vamos a preparar la receta completa").
  if (!empiezaComoLoMostrado(crudas, crudasNuevas)) return ''
  const mostrar = String(mostrado)
  const colaDeLoMostrado = crudas.slice(-VENTANA)
  const clavesMostradas = colaDeLoMostrado.map(claveDePalabra)
  const clavesNuevas = crudasNuevas.map(claveDePalabra)

  /** El tramo de palabras YA esta en la cola de lo mostrado (reentrega: no se aNade). */
  const yaMostrado = (palabras) => {
    if (!palabras.length) return true
    for (let i = 0; i + palabras.length <= clavesMostradas.length; i += 1) {
      let igual = true
      for (let j = 0; j < palabras.length; j += 1) {
        if (clavesMostradas[i + j] !== palabras[j]) { igual = false; break }
      }
      if (igual) return true
    }
    return false
  }

  /** La cola es GENUINA: no entera ya en lo mostrado y no ARRANCA con un tramo ya mostrado
   *  (la reentrega "creciente" de la misma cola repetiria el texto: medido en el replay). */
  const colaGen = (palabras) => {
    if (!palabras.length) return false
    if (yaMostrado(palabras)) return false
    const arranque = palabras.slice(0, Math.min(6, palabras.length))
    return arranque.length < 2 || !yaMostrado(arranque)
  }

  // (A) El SUFIJO de lo mostrado se reentrega dentro de la emision nueva: se anade lo que
  // viene DESPUES de ese tramo (mas la letra que completa la ultima palabra si viene larga).
  const tope = Math.min(60, clavesMostradas.length)
  let fin = -1
  let largo = 0
  for (let p = clavesNuevas.length - 1; p >= 0; p -= 1) {
    if (!mismaPalabraClave(clavesMostradas[clavesMostradas.length - 1], clavesNuevas[p])) continue
    let k = 1
    while (
      k < tope &&
      k < clavesMostradas.length &&
      p - k >= 0 &&
      mismaPalabraClave(clavesMostradas[clavesMostradas.length - 1 - k], clavesNuevas[p - k])
    ) k += 1
    if (k > largo) { largo = k; fin = p }
  }
  if (fin >= 0 && (largo >= 2 || largo === clavesMostradas.length)) {
    const crudaMostrada = colaDeLoMostrado[colaDeLoMostrado.length - 1]
    const crudaNueva = crudasNuevas[fin]
    const completacion = crudaNueva.length > crudaMostrada.length &&
      crudaNueva.toLowerCase().startsWith(crudaMostrada.toLowerCase())
      ? crudaNueva.slice(crudaMostrada.length)
      : ''
    const cola = clavesNuevas.slice(fin + 1)
    if (colaGen(cola)) {
      // COSTURA ANTI-TARTAMUDEO (medido d4c1c8f3): la cola puede ARRANCAR repitiendo la
      // palabra del borde que la caja YA muestra ("…dijo cla Cloud" + "…dijo cla Cloud
      // Cloud de que" -> la caja acumulaba "Cloud Cloud" y el duplicado se commiteaba).
      // Esa primera palabra NO es nueva: se descarta (la caja ya la tiene). La palabra
      // corta de enfasis ("…dijo no no pasa") sobrevive: solo se descarta de 4 letras
      // o mas (misma regla que `collapseAdjacentWordRepeat`, dueño del canon).
      const primeraColaA = crudasNuevas[fin + 1]
      const mismaA = mismaPalabraClave(
        String(crudaMostrada || '').toLowerCase(),
        String(primeraColaA || '').toLowerCase(),
      )
      if (mismaA && primeraColaA.length >= 4) {
        const restoA = crudasNuevas.slice(fin + 2)
        return restoA.length ? `${mostrar}${completacion} ${restoA.join(' ')}` : `${mostrar}${completacion}`
      }
      return `${mostrar}${completacion} ${crudasNuevas.slice(fin + 1).join(' ')}`
    }
    if (!cola.length && completacion) return `${mostrar}${completacion}`
  }

  // (B) La emision ARRANCA reentregando un tramo de lo mostrado (trozo INTERIOR, P11.16) y
  // sigue: se anade su cola nueva. Con menos de 2 palabras de tramo no se inventa la union.
  let mejorK = 0
  // Posicion del tramo reentregado dentro de lo mostrado: sin ella no se puede saber si la
  // reentrega llega al FINAL de la caja o se queda a mitad (otra hipotesis del audio).
  let mejorI = 0
  for (let i = 0; i < clavesMostradas.length; i += 1) {
    let k = 0
    while (
      k < clavesNuevas.length &&
      i + k < clavesMostradas.length &&
      mismaPalabraClave(clavesMostradas[i + k], clavesNuevas[k])
    ) k += 1
    if (k > mejorK) {
      mejorK = k
      mejorI = i
    }
  }
  if (mejorK >= 2) {
    // GENUINA O HIPOTESIS: solo se une cuando la emision CONTINUA lo mostrado. Dos formas:
    // (1) el tramo reentregado llega al FINAL de la caja (reentrega de la cola + habla
    // nueva), o (2) la palabra que la caja muestra JUSTO DESPUES del tramo es la que la
    // emision reescribe/crece (costura del ASR: la caja pego una parcial y el ASR la
    // completa). Un tramo INTERIOR con otra cola es otra HIPOTESIS del mismo audio: unirla
    // fabricaba una frase que nadie dijo (medido: "vamos a ver si es cie | lo que nos dijo"
    // + "vamos a ver si es cie | esta todo resuelto" -> "es cie lo que nos dijo esta todo
    // resuelto", que no se dijo).
    const restoMostrado = colaDeLoMostrado[mejorI + mejorK]
    const primeraPalabraNueva = crudasNuevas[mejorK]
    const llegaAlFinalDeLaCaja = mejorI + mejorK === clavesMostradas.length
    const continuaLaPalabra =
      Boolean(restoMostrado) &&
      Boolean(primeraPalabraNueva) &&
      (mismaPalabraDeLaCaja(restoMostrado, primeraPalabraNueva) ||
        palabraQueCrece(restoMostrado, primeraPalabraNueva))
    if (!llegaAlFinalDeLaCaja && !continuaLaPalabra) return ''
    const cola = clavesNuevas.slice(mejorK)
    if (colaGen(cola)) {
      // COSTURA ANTI-TARTAMUDEO (medido d4c1c8f3): la cola puede ARRANCAR con la
      // palabra que la caja YA muestra al final ("…dijo cla Cloud" + "…dijo Cloud
      // de que" -> la cola "Cloud de que" reentrega el "Cloud" mostrado). Pasa
      // cuando la caja pego antes una parcial ("cla", ASR 205) y por eso el
      // alineado del sufijo (A) no ve la reentrega: la caja acumulaba "cla Cloud
      // Cloud" y el duplicado se commiteaba en la fila. Esa primera palabra NO es
      // nueva: si es la MISMA que la ultima mostrada se descarta (la caja ya la
      // tiene), y si la COMPLETA (el ASR la oyo a medias: "cla" -> "Cloud") se
      // sustituye la parcial por la forma completa de la emision. El doble
      // legitimo de la emision ("…dijo no no pasa") sobrevive: solo se resuelve
      // la palabra que la caja ya muestra.
      const ultimaMostrada = colaDeLoMostrado[colaDeLoMostrado.length - 1]
      const primeraCola = crudasNuevas[mejorK]
      const misma = mismaPalabraClave(
        String(ultimaMostrada || '').toLowerCase(),
        String(primeraCola || '').toLowerCase(),
      )
      if (misma) {
        if (primeraCola.length > ultimaMostrada.length) {
          return crudas.slice(0, -1).concat([primeraCola], crudasNuevas.slice(mejorK + 1)).join(' ')
        }
        // Palabra corta de enfasis ("no no"): la emision la repite a proposito y se
        // conserva (misma guarda que el canon: solo se descarta de 4 letras o mas).
        if (primeraCola.length >= 4) {
          const resto = crudasNuevas.slice(mejorK + 1)
          return resto.length ? `${mostrar} ${resto.join(' ')}` : ''
        }
        return `${mostrar} ${crudasNuevas.slice(mejorK).join(' ')}`
      }
      return `${mostrar} ${crudasNuevas.slice(mejorK).join(' ')}`
    }
  }
  return ''
}

/**
 * ALINEA la locucion YA COMMITEADA al ARRANQUE de la emision, tolerando que el ASR haya
 * PERDIDO palabras al reentregarla (misma locucion, no texto ajeno). Devuelve el indice
 * (en palabras de `crudas`) donde TERMINA la locucion, o -1 si no encaja.
 *
 * MEDIDO (d4c1c8f3): la locucion "está mal este está con el hablante uno" se reentrega
 * como "está mal está con el hablante uno" (el ASR se comio "este"). Con comparacion
 * palabra a palabra el peel fallaba, la caja volvia a pintar la locucion vieja y la
 * SIGUIENTE quedaba bloqueada como "texto ajeno" 7,4 s.
 *
 * La tolerancia son PALABRAS CAIDAS de la locucion, en orden y con el resto igual: una
 * frase DISTINTA sigue sin encajar (no se relaja la puerta para frases nuevas).
 * @param {string[]} crudas palabras de la emision
 * @param {string[]} previas palabras de la locucion commiteada
 * @param {number} maxDroppedWords palabras que el ASR pudo perder (0 = exacto)
 * @returns {number} indice de fin en `crudas`, o -1
 */
function finDeLocucionReentregada(crudas = [], previas = [], maxDroppedWords = 0) {
  if (!crudas.length || !previas.length) return -1
  // Una locucion de UNA palabra solo encaja EXACTA: sin contexto, cualquier parecido seria
  // adivinar.
  const tope = previas.length >= 2 ? Math.max(0, Math.floor(Number(maxDroppedWords) || 0)) : 0
  let i = 0
  let caidas = 0
  for (let j = 0; j < previas.length; j += 1) {
    if (i >= crudas.length) return -1
    if (claveDePalabra(crudas[i]) === claveDePalabra(previas[j])) {
      i += 1
      continue
    }
    if (caidas >= tope) return -1
    caidas += 1
  }
  // Al menos dos palabras tienen que encajar: con una sola no hay evidencia de que sea la
  // MISMA locucion.
  return previas.length - caidas >= Math.min(2, previas.length) ? i : -1
}

/**
 * Tolerancia configurada (palabras que el ASR puede perder al reentregar una locucion ya
 * commiteada). Sin valor en la llamada se lee de la config: UN solo dueno del umbral.
 * @param {number|undefined} maxDroppedWords
 * @returns {number}
 */
function toleranciaDeReentrega(maxDroppedWords) {
  if (maxDroppedWords != null && Number.isFinite(Number(maxDroppedWords))) return Number(maxDroppedWords)
  return Number(getTranscriptPauseCfg()?.committedReplayMaxDroppedWords) || 0
}

/**
 * ¿El texto EMPIEZA por las palabras de `committed`? Compara por clave de palabra
 * (sin tildes ni signos, misma mayuscula/minuscula): el ASR re-entrega la misma
 * locucion con otra ortografia en los bordes.
 * @param {string} text
 * @param {string} committed
 * @returns {boolean}
 */
export function startsWithCommittedLocution(text = '', committed = '', { maxDroppedWords } = {}) {
  const crudas = cleanForSpeech(text).split(/\s+/).filter(Boolean)
  const previas = cleanForSpeech(committed).split(/\s+/).filter(Boolean)
  return finDeLocucionReentregada(crudas, previas, toleranciaDeReentrega(maxDroppedWords)) >= 0
}

/**
 * COLA NUEVA tras una locucion YA COMMITEADA (medido 2026-10-19 23:34:16, turno 52):
 * Chrome re-entrega el FINAL de la locucion cerrada junto al arranque de la SIGUIENTE
 * y el ingress lo vuelve a mezclar con la ultima locucion commiteada
 * (`resolveIngressCaptureText`). Si `capture` EMPIEZA por `committed` y sigue, lo unico
 * nuevo es lo que viene DESPUES. Devuelve ese texto con la ortografia CRUDA de la
 * emision (conserva mayusculas) o '' si no hay cola nueva.
 * @param {string} capture
 * @param {string} committed
 * @returns {string}
 */
export function tailAfterCommittedLocution(capture = '', committed = '', { maxDroppedWords } = {}) {
  const crudas = cleanForSpeech(capture).split(/\s+/).filter(Boolean)
  const previas = cleanForSpeech(committed).split(/\s+/).filter(Boolean)
  const fin = finDeLocucionReentregada(crudas, previas, toleranciaDeReentrega(maxDroppedWords))
  if (fin < 0) return ''
  return crudas.slice(fin).join(' ')
}

/**
 * Prefijo COMUN de palabras de dos textos (misma clave de palabra).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
function prefijoComunDePalabras(a = [], b = []) {
  let comun = 0
  while (comun < a.length && comun < b.length && mismaPalabraDeLaCaja(a[comun], b[comun])) comun += 1
  return comun
}

/**
 * La emision llega al FINAL de lo mostrado (su ultima palabra es la ultima o la penultima)?
 *
 * Es la condicion que permite una revision MAS CORTA sin perder el tramo: el ASR re-reconoce
 * la locucion hasta su final (re-segmenta o corrige palabras), no se queda a mitad.
 * @param {string[]} mostradas
 * @param {string[]} nuevas
 * @returns {boolean}
 */
function alcanzaElFinalDeLoMostrado(mostradas = [], nuevas = []) {
  const ultima = nuevas[nuevas.length - 1]
  if (!ultima) return false
  return mostradas.slice(-2).some((palabra) => mismaPalabraDeLaCaja(palabra, ultima))
}

/**
 * La emision COMPARTE UN TRAMO de lo mostrado DESPUES del arranque (>=2 palabras seguidas que
 * la caja ya tenia). Es lo que separa "misma locucion, mejor hipotesis" de "otra frase que
 * empieza igual":
 *  - "porque a los tal vez" -> "porque tal vez tu papa necesita" comparte "tal vez" (SI),
 *  - "vamos a preparar la receta" -> "vamos a comprar otra cosa" no comparte nada salvo el
 *    saludo "vamos a" (NO): es otra frase y la caja no se sustituye.
 * @param {string[]} mostradas Palabras de lo mostrado.
 * @param {string[]} nuevas Palabras de la emision.
 * @param {number} comun Longitud del prefijo comun ya calculado.
 * @returns {boolean}
 */
function comparteTramoTrasElArranque(mostradas = [], nuevas = [], comun = 0) {
  const desde = Math.max(1, Number(comun) || 0)
  for (let i = desde; i + 1 < mostradas.length; i += 1) {
    for (let j = 0; j + 1 < nuevas.length; j += 1) {
      if (mismaPalabraClave(mostradas[i], nuevas[j]) && mismaPalabraClave(mostradas[i + 1], nuevas[j + 1])) {
        return true
      }
    }
  }
  return false
}

/**
 * DUENO UNICO de "esta emision entra en la caja, y como" (2026-10-21).
 *
 * Tres desenlaces, una sola regla:
 *  - `revision`: la emision DERIVA de lo mostrado (arranque estable de >=2 palabras, o el
 *    prefijo corto cuando la caja apenas tiene unas pocas), NO es un trozo contiguo (el ASR
 *    a medias no aporta y no puede recortar) y no baja del prefijo ya confirmado. Corrige o
 *    completa el MISMO tramo, asi que REEMPLAZA: anadirla duplicaria el tramo corregido.
 *    Si es mas corta, tiene que llegar al FINAL de lo mostrado (re-reconocio el tramo
 *    entero); asi una frase nueva que solo comparte el arranque no se lleva la caja.
 *  - `solape`: la emision reentrega la COLA (o un trozo interior) y sigue con habla nueva;
 *    se anade la cola genuina (`colaNuevaTrasSolape`, que sigue siendo su dueno).
 *  - `bloqueado`: texto ajeno o trozo puro; la caja no se toca ("jamas se sustituye" para
 *    lo que no deriva de lo mostrado).
 *
 * @param {string} mostrado Lo que la caja muestra ahora.
 * @param {string} nuevo Emision del ASR.
 * @returns {{ aplica: boolean, destino: string, motivo: "revision"|"solape"|"bloqueado" }}
 */
export function resolverEmisionDeLaCaja(mostrado = '', nuevo = '') {
  const mostradas = String(mostrado || '').trim().split(/\s+/).filter(Boolean)
  const nuevas = String(nuevo || '').trim().split(/\s+/).filter(Boolean)
  const bloqueado = { aplica: false, destino: String(mostrado || ''), motivo: 'bloqueado' }
  if (!nuevas.length) return bloqueado
  // La COLA GENUINA la decide `colaNuevaTrasSolape` (su dueno). Se calcula una vez.
  const union = colaNuevaTrasSolape(mostrado, nuevo)
  const unionAplica = Boolean(union) && union.length > String(mostrado || '').length
  const solape = () => ({ aplica: true, destino: union, motivo: 'solape' })
  if (mostradas.length) {
    const comun = prefijoComunDePalabras(mostradas, nuevas)
    // EXTENSION PURA: la caja YA es el arranque de la emision (ninguna palabra mostrada se
    // corrige). Manda la UNION, que conserva la grafia de la caja (el replay midio que
    // reemplazar perdia mayusculas: "Daniel" -> "daniel"); solo si no hay cola que anadir
    // se sigue evaluando como revision.
    if (comun === mostradas.length && unionAplica) return solape()
    // ARRANQUE ESTABLE: >=2 palabras compartidas, o el prefijo corto ya existente cuando la
    // caja apenas tiene unas pocas (glue del arranque del turno: "te las" -> "te lo escribe").
    // Numeros en UNA tabla (`FLU_CONFIG.transcript.policy`), no repartidos por el pipeline.
    const politica = getTranscriptPolicyCfg()
    const arranqueEstable =
      comun >= (Number(politica.boxStablePrefixWords) || 2) ||
      (mostradas.length <= (Number(politica.boxShortBoxMaxWords) || 4) &&
        comun >= (Number(politica.boxShortBoxPrefixWords) || 1))
    const noEsTrozo = !isFragmentOfLocution(nuevo, mostrado)
    const noEncojeBajoLoConfirmado = nuevas.length >= comun
    // NINGUNA sustitucion puede perder palabras de la caja (solo acumula).
    const conservaLaCaja = conservaLasPalabrasDe(mostrado, nuevo)
    const crece = nuevas.length >= mostradas.length
    // EXTENSION de lo mostrado (la emision empieza por las MISMAS palabras): es la misma
    // locucion creciendo ("no" -> "no no"), asi que no necesita un tramo adicional.
    const esExtensionDeLoMostrado =
      crece && mostradas.every((palabra, i) => mismaPalabraDeLaCaja(palabra, nuevas[i]))
    if (
      arranqueEstable &&
      noEsTrozo &&
      noEncojeBajoLoConfirmado &&
      // MISMO TRAMO OBLIGATORIO (auditoria 2026-10-23): compartir el arranque no basta para
      // sustituir la caja; hace falta un tramo MAS ALLA del arranque, salvo que la emision
      // sea la MISMA locucion creciendo palabra a palabra.
      conservaLaCaja &&
      (esExtensionDeLoMostrado || comparteTramoTrasElArranque(mostradas, nuevas, comun)) &&
      (crece || alcanzaElFinalDeLoMostrado(mostradas, nuevas))
    ) {
      return { aplica: true, destino: String(nuevo), motivo: 'revision' }
    }

    // HIPOTESIS MAS COMPLETA (medido 7fce0045: la caja se quedo 10,7 s en "porque a los tal
    // vez" mientras el ASR decia "porque tal vez tu papa necesita..." — 80 emisiones dentro
    // sin entrar). Si la emision es MAS LARGA, arranca con la MISMA primera palabra y COMPARTE
    // UN TRAMO de lo mostrado mas alla del arranque, es la hipotesis VIGENTE de la MISMA
    // locucion y la caja la muestra (se REEMPLAZA, no se une). El tramo compartido es la
    // guarda contra "otra frase que empieza igual" ("vamos a preparar la receta" vs "vamos a
    // comprar otra cosa": solo comparten "vamos a" -> NO se sustituye).
    if (
      comun >= 1 &&
      nuevas.length > mostradas.length &&
      noEsTrozo &&
      comparteTramoTrasElArranque(mostradas, nuevas, comun)
    ) {
      return { aplica: true, destino: String(nuevo), motivo: 'revision' }
    }
  }
  if (unionAplica) return solape()
  return bloqueado
}

/**
 * CAJA de la frase viva ("ultima frase"): UNICO escritor de `publishedLiveRef` y de su
 * espejo visible. UNA sola regla (`publicarEnLaCaja`):
 *   - la caja vacia o una emision identica no cambian nada;
 *   - emision que YA contiene lo mostrado -> se aplica la emision (crece);
 *   - emision mas corta o que no contiene lo mostrado -> se ANADE la cola nueva
 *     (alineada con el final de lo mostrado) o se BLOQUEA: nunca se sustituye.
 * El vaciado legitimo (cierre confirmado / parrafo nuevo / reset de sesion) es
 * `vaciarLaCaja`: NO lo decide la regla de acumulacion.
 * @param {{ publishedLiveRef?: { current: string }, activeTurnIdRef?: { current: number | string | null }, cancelLiveTranscriptUpdate?: Function, scheduleLiveTranscriptUpdate?: Function, setLiveTranscript?: Function }} deps
 * @returns {{ publicarEnLaCaja: Function, vaciarLaCaja: Function }}
 */
export function crearCajaDeLaFrase(deps = {}) {
  const { publishedLiveRef, cancelLiveTranscriptUpdate, scheduleLiveTranscriptUpdate, setLiveTranscript } = deps
  const escribirVisible = (texto, inmediato) => {
    const valor = String(texto || '')
    // ESCRITURA INMEDIATA (vaciado o publicacion sin debounce): primero se CANCELA el
    // update perezoso pendiente. Sin esto, un debounce programado ANTES del vaciado
    // escribia su texto viejo DESPUES y la ultima frase "volvia a ponerse" (defecto
    // medido por el dueno 2026-10-18: la caja tardaba en limpiarse y reaparecia texto).
    if (inmediato) {
      if (typeof cancelLiveTranscriptUpdate === 'function') cancelLiveTranscriptUpdate()
      if (typeof setLiveTranscript === 'function') {
        setLiveTranscript(valor)
        return
      }
    }
    if (!valor) {
      if (typeof setLiveTranscript === 'function') setLiveTranscript('')
      return
    }
    if (typeof scheduleLiveTranscriptUpdate === 'function') {
      scheduleLiveTranscriptUpdate(valor)
      return
    }
    if (typeof setLiveTranscript === 'function') setLiveTranscript(valor)
  }
  const leer = () => String(publishedLiveRef?.current || '')
  // TURNO DEL BOCETO: a que locucion pertenece lo que la caja muestra. La caja solo
  // acumula dentro de la MISMA locucion; un turno distinto parte limpio.
  // `undefined` = TODAVIA NO SE PUBLICO NADA (identidad desconocida). Es distinto de `null`,
  // que es un turno SIN id: asi null -> 5 SI marca frontera (antes `null` significaba a la vez
  // "sin publicar" y "sin id", y un commit sin turno no partia la caja; auditoria 2026-10-23).
  let turnoDelBoceto
  const publicarEnLaCaja = (texto = '', opciones = {}) => {
    const nuevo = String(texto || '')
    const mostrado = leer()
    if (!nuevo || nuevo === mostrado) {
      return { aplicado: false, destino: mostrado, previo: mostrado.length }
    }
    // EL TURNO DE LA CAJA SIEMPRE EXISTE (auditoria 2026-10-23): si el llamador no lo pasa, se
    // toma el turno VIVO del motor. Con `null` la caja no marcaba frontera y una locucion de
    // otro turno podia heredar el boceto.
    const turnoActivo = opciones.turnId ?? deps.activeTurnIdRef?.current ?? null
    // FRONTERA POR IDENTIDAD: lo mostrado pertenece a OTRO turno -> no se hereda ni se
    // fusiona por texto (evita "se borra y luego vuelve a poner" al cruzar locuciones).
    const cambioDeTurno =
      Boolean(mostrado) && turnoDelBoceto !== undefined && turnoDelBoceto !== turnoActivo
    let destino = nuevo
    if (!cambioDeTurno) {
      if (mostrado) {
        // EXCEPCION DECLARADA (SOLO FRASE CANONICA): el CIERRE del turno y la
        // CONFIRMACION del ASR entregan la frase canonica de la locucion, y la caja la
        // ADOPTA aunque no derive de lo mostrado. Dos motivos medidos:
        //  1) el boceto puede ser un texto FABRICADO (d4c1c8f3: la caja mostraba
        //     "... es cie ... esta todo resuelto" sin "Cloud de que ya" mientras la fila
        //     si lo llevaba), y
        //  2) la frase canonica puede ser MAS CORTA que el boceto porque el canon quita
        //     el tartamudeo ("puso Cloud Cloud" -> "puso Cloud").
        // Adoptarla es lo que mantiene caja = fila (B.3). Se admite cuando crece, cuando
        // es la MISMA revision (correccion del mismo tramo) o cuando el boceto es solo un
        // ECO de la frase. Si el boceto ya lleva habla AJENA (la locucion siguiente)
        // ninguna se cumple y no se toca: ahi el no-encogimiento sigue mandando.
        if (
          opciones.canonica &&
          (nuevo.length >= mostrado.length || bocetoCubiertoPor(mostrado, nuevo)) &&
          // La frase canonica SUSTITUYE: no puede comerse palabras de la caja. La unica
          // perdida legitima es el TARTAMUDEO, que el canon colapsa ("Cloud Cloud" -> "Cloud");
          // se compara contra la caja ya canonizada. Defecto medido 2026-10-23: la canonica
          // perdio "esto" y "escucha" en medio/final de la locucion.
          conservaLasPalabrasDe(canonSinTartamudeo(mostrado), nuevo)
        ) {
          destino = nuevo
        } else {
        // UN SOLO CRITERIO (2026-10-21): la emision solo entra si DERIVA de lo mostrado.
        // El dueno unico de esa decision es `resolverEmisionDeLaCaja` (revision del mismo
        // tramo o cola genuina); aqui solo se aplica. Se decide ANTES de la union porque
        // una REVISION no se "anade": se reemplaza. Antes se anadia su cola y la caja
        // duplicaba el tramo corregido ("...la diarizacion... transcripcion...").
        const decision = resolverEmisionDeLaCaja(mostrado, nuevo)
        // LA CAJA NO ENCOGE DENTRO DE LA MISMA LOCUCION (mandato 2026-10-21): una
        // revision puede corregir/completar, pero nunca reducir lo ya mostrado. El
        // unico encogimiento legitimo es el VACIADO del cierre (`vaciarLaCaja`). Antes
        // `resolverEmisionDeLaCaja` devolvia revisiones mas cortas y 5 se aplicaron en
        // la sesion real (64->63, 147->104, 50->41, 80->64, 10->8).
        if (decision.aplica && decision.destino.length < mostrado.length) {
            return { aplicado: false, destino: mostrado, previo: mostrado.length }
        }
        if (decision.aplica) destino = decision.destino
        else return { aplicado: false, destino: mostrado, previo: mostrado.length }
        }
      }
    }
    turnoDelBoceto = turnoActivo
    if (publishedLiveRef) publishedLiveRef.current = destino
    escribirVisible(destino, Boolean(opciones.inmediato))
    return { aplicado: true, destino, previo: cambioDeTurno ? 0 : mostrado.length }
  }
  // Vaciado legitimo (cierre confirmado / arranque / parada / reset de sesion). Por
  // defecto vacia tambien el espejo visible; `{ visible: false }` solo resetea la MEMORIA
  // (el ancla del parrafo nuevo) y deja la ultima frase en pantalla: borrarla era el
  // "borra y luego vuelve a poner" medido por el dueno.
  const vaciarLaCaja = (opciones = {}) => {
    if (publishedLiveRef) publishedLiveRef.current = ''
    // `undefined` = no se publico nada desde el vaciado (identidad desconocida provisional).
    turnoDelBoceto = undefined
    if (opciones.visible !== false) escribirVisible('', true)
  }
  return {
    publicarEnLaCaja,
    vaciarLaCaja,
    // Contrato publico: `null` = turno desconocido (el sentinel interno es `undefined`).
    turnoActual: () => (turnoDelBoceto === undefined ? null : turnoDelBoceto),
  }
}

/**
 * API de la caja: la inyectada por deps si existe; si no, se deriva de los MISMOS deps
 * (ref de la caja + espejo visible). Una sola implementacion, una sola regla.
 * @param {object} deps
 * @returns {{ publicarEnLaCaja: Function, vaciarLaCaja: Function }}
 */

/**
 * DUENO UNICO de "el turno vivo se CIERRA": apaga el preview, limpia la locucion viva
 * (`openLine` / `pendingInterim` / `pendingFinal`) y sella el audio del turno.
 *
 * Lo usan los TRES cierres reales: el de un commit (`finalizeTurnCommit`), el de una
 * locucion ya consumida por una orden (`closeTurnOnly`) y el cierre sin captura. Antes
 * cada uno repetia su propia lista y a todos les faltaba `pendingFinal`: el final SIN
 * wake deja ahi el texto confirmado (`transcriptIngress.js`, P9.68-b), asi que el
 * cierre siguiente lo volcaba como fila de OTRO turno. MEDIDO en el log del dueno
 * 2026-10-19: filas 430+112 y 468+270 (la cola de una locucion ya commiteada
 * reaparecia como fila propia) y la linea de 58 chars que sobrevivio a la orden y
 * luego recorto la locucion de 316 chars.
 *
 * @param {object} deps -> los MISMOS deps del sync (refs y sellado de audio).
 */
function closeLiveTurn(deps) {
  const {
    listenStateRef,
    openPreviewTurnRef,
    preflightScheduledForTurnRef,
    srGapFiredForOpenLineRef,
    flushPcmAfterTurnCommit,
    turnAudioStartSampleRef,
    chunkTotalSamplesRef,
  } = deps
  openPreviewTurnRef.current = false
  listenStateRef.current.openLine = ''
  listenStateRef.current.pendingInterim = ''
  // El cierre REAL termina el tramo de la frontera: su marca no puede sobrevivir al turno.
  listenStateRef.current.fronteraCerrada = ''
  clearPendingFinal(listenStateRef.current)
  preflightScheduledForTurnRef.current = false
  srGapFiredForOpenLineRef.current = false
  // El PCM del turno NO se vacia en un final de SEGMENTO: la identidad final (y su
  // embedding) se mide sobre el audio del TURNO. Vaciarlo en cada segmento dejaba
  // ventanas de 3-900 ms (medido 2026-10-18: snap=128/768, `voz` casi nula) y la
  // misma voz se separaba de su cluster. Solo el CIERRE REAL llega aqui.
  flushPcmAfterTurnCommit()
  turnAudioStartSampleRef.current = chunkTotalSamplesRef.current
}

/**
 * Sincroniza preview o commit del stream de conversación según turnCommit.
 *
 * @param {ConversationStreamCommitDeps} deps
 * @param {ConversationStreamCommitPayload} [payload]
 */
export function handleConversationStreamSync(
  deps,
  {
    capture: precomputed = '',
    newParagraph = false,
    speaker = '',
    utterance = '',
    freshUtterance = false,
    turnCommit = false,
    turnBoundary = false,
    diarize = false,
    atTurnBoundary = false,
    forceNewRowOnSegment = false,
    // La espera del preflight la hizo el LLAMADOR con el id del turno que resolvia:
    // el cierre consume ESE slot, no el del turno siguiente (ver el typedef).
    preflightTurnId = null,
    // CIERRE REAL del turno (onend / srGap / split por wake). Un `final` de SEGMENTO
    // de Chrome NO lo declara: la fila de conversacion no se escribe a mitad del
    // dictado (medido 2026-10-08 por el dueno: al llegar al 9 ya estaba "vaciada").
    settlesTurn = false,
    // CONFIRMACION del ASR: la captura es un `final` de SEGMENTO (texto confirmado por
    // el motor, no una hipotesis interina). No cierra el turno, pero SI es la frase
    // canonica de la locucion: la caja la adopta (B.3) en vez de quedarse con el
    // interino fabricado (medido d4c1c8f3).
    confirmedFinal = false,
    // La captura es una locucion YA CONFIRMADA que quedo pendiente (`pendingFinal`) y
    // se commitea porque llego OTRA locucion: es texto CERRADO y NO puede
    // reconciliarse contra la linea viva. Reconciliarla metia en su fila el interino
    // de la locucion SIGUIENTE (medido 2026-10-19 21:18:52: fila de 430 = 315 dichos +
    // 112 de la locucion siguiente; luego esos 112 se volvian a escribir como cola).
    locutionClosed = false,
    turnId: turnoDelTextoCerrado = null,
    // La orden (comando/consulta) YA CONSUMIO la linea viva y su fila la escribio la
    // ruta de la orden: aqui solo se CIERRA el turno vivo. Sin esto la linea seguia
    // abierta con el texto consumido, la locucion siguiente se le PEGABA y el srGap
    // recortaba la captura a su prefijo (medido 2026-10-19 21:21:22: la locucion de
    // 316 chars se descarto y la fila existente se reescribia con 40).
    closeTurnOnly = false,
    // PROCEDENCIA del commit: lo produjo una orden y la locucion sigue viva (wake al
    // inicio). El pelado del preview lo consulta para NO arrancar del texto de una
    // orden que el usuario sigue dictando.
    commandTurn = false,
  } = {},
) {
  const {
    conversationActiveRef,
    publishedLiveRef,
    listenStateRef,
    openPreviewTurnRef,
    applyConversationSpeaker,
    flushPendingStreamLog,
    logRowsTextRef,
    activeTurnIdRef,
    captureTurnAudio,
    lastCommitAtRef,
    lastOnresultAtRef,
    processConversationFluQueryRef,
    lastEmittedTranscriptRef,
    emitConversationLog,
    createSpeakerAudioResolver,
    sessionPrimarySpeakerRef,
    lastLoggedSpeakerRef,
    // Opcional: sin ref, la preferencia por la ultima resolucion medida se desactiva
    // (el sticky cae a la cadena historica). Produccion lo pasa siempre.
    lastResolvedSpeakerRef = { current: '' },
    logRowSpeakersRef,
    speakerClustersRef,
    setSpeakerClusters,
    applyResolvedSpeaker,
    lastSpeakerRef,
    lastTurnSignatureRef,
    lastLogLineTextRef,
    lastLogLineWasCommandRef,
    commitTurnToSessionRows,
    fluParticipantRef,
    lastRequestRef,
    lastEmittedTurnRef,
    registerParticipant,
  } = deps

  // CAJA ("ultima frase"): TODO pasa por la API de este modulo (un solo escritor, una
  // sola regla). Ninguna linea de aqui escribe el ref: lo hace la caja.
  //
  // DUENO UNICO DE LA INSTANCIA: el hook crea la caja UNA vez (`cajaVivaRef`) y la
  // inyecta. Fabricar una caja nueva por llamada reseteaba `turnoDelBoceto` en cada
  // sync (la frontera por identidad de turno se perdia) y dejaba dos instancias
  // vivas sobre la misma frase. Si no viene inyectada, se deriva de los mismos deps.
  const caja =
    deps.cajaDeLaFrase && typeof deps.cajaDeLaFrase.publicarEnLaCaja === 'function'
      ? deps.cajaDeLaFrase
      : crearCajaDeLaFrase(deps)
  const { publicarEnLaCaja, vaciarLaCaja } = caja

  // El cierre de una locucion YA CONFIRMADA no borra lo que el usuario esta diciendo
  // ahora: `visible:false` resetea la MEMORIA de la caja (ancla del parrafo nuevo) y
  // deja la frase viva en pantalla; su dueno la reemplaza cuando llega la locucion
  // siguiente. Es la misma regla documentada en `vaciarLaCaja`.
  //
  const vaciarTrasCierre = () =>
    locutionClosed ? vaciarLaCaja({ visible: false }) : vaciarLaCaja()

  // PROCEDENCIA de la ultima linea commiteada (`lastLogLineTextRef`): se escribe SIEMPRE
  // por esta unica via para que el texto y su origen no puedan divergir. `commandTurn`
  // marca la locucion de una ORDEN que NO se cerro: el preview siguiente puede contenerla
  // legitimamente y el pelado no debe recortarla. Un commit normal o el cierre la apagan.
  const marcarUltimaLinea = (texto) => {
    lastLogLineTextRef.current = texto
    if (lastLogLineWasCommandRef) lastLogLineWasCommandRef.current = Boolean(commandTurn)
  }

  if (!conversationActiveRef?.current) return

  // CIERRE SIN TEXTO de una locucion YA CONSUMIDA por una orden (comando/consulta).
  // Va ANTES de calcular la captura: `advancePublishedDisplay` devolveria la linea
  // viva y este sync no debe commitear nada (la fila la escribio la ruta de la orden).
  if (closeTurnOnly) {
    lastCommitAtRef.current = Date.now()
    // El turno se cerro: lo commiteado ya NO es una locucion viva de orden.
    if (lastLogLineWasCommandRef) lastLogLineWasCommandRef.current = false
    vaciarLaCaja()
    closeLiveTurn(deps)
    return
  }

  // CAPTURA VACIA NUNCA ESCRIBE FILA DESDE LA CAJA (mandato 2026-10-24): si el llamador no
  // trae captura y NO hay locucion abierta (ni linea viva, ni final pendiente), lo que la
  // caja muestra es la locucion SIGUIENTE a medias. Se cierra con la captura del tramo o
  // no se escribe: la caja no es la fuente de una fila por si misma.
  if (turnCommit && !precomputed) {
    const estadoVivo = listenStateRef.current || {}
    const hayTextoAbierto = Boolean(
      cleanForSpeech(estadoVivo.openLine || '') ||
        cleanForSpeech(estadoVivo.pendingFinal || '') ||
        cleanForSpeech(estadoVivo.pendingInterim || ''),
    )
    if (!hayTextoAbierto) {
      if (settlesTurn) {
        lastCommitAtRef.current = Date.now()
        vaciarLaCaja()
        closeLiveTurn(deps)
      }
      relayLog('LOG', 'conversationStreamCommit', 'commit sin captura ni locucion abierta: no se escribe fila (caja != tramo)')
      return
    }
  }
  let capture =
    precomputed ||
    advancePublishedDisplay(publishedLiveRef.current, listenStateRef.current, {
      reset: newParagraph,
    })
  if (!capture) {
    if (newParagraph || freshUtterance) {
      // Misma regla del cierre: se resetea el ANCLA, no lo PUBLICADO (la "ultima frase"
      // la borra su dueno, el reset de la sesion/voz, no el commit del turno).
      vaciarLaCaja({ visible: false })
      openPreviewTurnRef.current = false
    }
    // CIERRE REAL sin captura (p. ej. un comando consumio la locucion a mitad del
    // dictado): la caja visible pertenece al turno que ACABA de cerrarse y se vacia
    // por su dueno. Antes se quedaba pintada para siempre (defecto 5 del dueno) y el
    // cierre se quedaba a medias: `openLine`/`pendingFinal` sobrevivian y el cierre
    // siguiente los volcaba como fila de OTRO turno. El cierre es COMPLETO y pasa por
    // el mismo dueno que el de un commit (`closeLiveTurn`).
    if (settlesTurn) {
      lastCommitAtRef.current = Date.now()
      vaciarLaCaja()
      closeLiveTurn(deps)
    }
    if (import.meta.env.DEV && debugHotPath) fluDebugHot('stream-skip', { reason: 'empty-capture' })
    return
  }

  // LA CAJA NO VUELVE A PINTAR UNA LOCUCION YA COMMITEADA (medido 2026-10-19 23:34:15-16,
  // sesion 18f3888c, turno 52): tras cerrar la locucion, Chrome re-entrega su FINAL junto
  // al arranque de la SIGUIENTE y el ingress lo vuelve a mezclar con la ultima locucion
  // commiteada (`resolveIngressCaptureText`). El preview la repintaba entera (77 = 71 ya
  // commiteados + " o sea") y la intervencion siguiente se acumulaba encima ("no limpia
  // ultima frase cuando pasa a conversacion y acumula ahi la siguiente intervencion",
  // reporte del dueno). La locucion commiteada ya tiene su fila: lo UNICO nuevo es su
  // cola, y es lo unico que la caja publica.
  // Se pela SIEMPRE que la captura ARRANQUE por esa locucion, muestre o no la caja el
  // texto viejo: el commit de segmento que NO vacia la memoria (rama simple, final de
  // tramo de Chrome) deja la locucion EN PANTALLA y el preview siguiente la repintaba
  // igual (medido en el replay de la sesion 18f3888c). Un preview ANTERIOR al commit
  // no entra aqui: `lastLogLineTextRef` aun no es esta locucion.
  // EXCEPCION: si la linea commiteada la escribio una ORDEN cuya locucion SIGUE VIVA
  // (wake al inicio: el usuario continua dictando la MISMA frase), la caja conserva el
  // mandato; pelarlo aqui borraba de la "ultima frase" lo que el usuario acaba de decir
  // (replay vozReplayDueno20261019Comando, defecto 5).
  if (!turnCommit && !lastLogLineWasCommandRef?.current) {
    const locucionCommiteada = String(lastLogLineTextRef?.current || '')
    if (locucionCommiteada && startsWithCommittedLocution(capture, locucionCommiteada)) {
      const colaNueva = tailAfterCommittedLocution(capture, locucionCommiteada)
      // REENTREGA PURA (sin cola nueva): lo que llega es la locucion YA COMMITEADA, no habla
      // nueva. Su fila ya esta escrita, asi que el preview NO la vuelve a pintar: si la
      // pintara, la locucion SIGUIENTE seria "texto ajeno" y quedaria BLOQUEADA hasta su
      // final (medido en d4c1c8f3: 7,4 s con la frase vieja en pantalla, y el ASR dictando
      // la nueva). El commit de una repeticion genuina sigue su camino (`isDuplicateTurnCommit`
      // tiene su propio dueno): aqui solo se decide que se PINTA.
      if (!colaNueva) return
      capture = colaNueva
    }
  }

  // El ID del turno nace al ABRIR el turno (una sola vez), no al resolverlo: el
  // commit temprano, la emision que crece, la resolucion y el log crudo
  // comparten SIEMPRE el mismo id. Antes la resolucion acuñaba el id tarde (y
  // solo con diarizacion activa), asi que la fila del usuario tenia que
  // deduplicarse por POSICION: dos criterios para la misma decision.
  //
  // P8.36 - y nace SOLO para un turno DE VERDAD. El ruido de fondo (aula/casa) no
  // es un turno: si acunara id, moveria el id del turno VIVO y la resolucion (que
  // lo lee al escribir) abriria una SEGUNDA fila con la misma frase.
  const wakeRequired = requiresWakeWord(conversationActiveRef?.current)
  const esTurno = (text) => isTurnCapture(text, { wakeRequired })
  // UN ID POR PETICION (no por reloj ni por estado de la UI): la identidad del
  // turno la dicta la MISMA memoria del despacho ->la ultima peticion ACEPTADA
  // (texto + instante)-> con la ventana compartida (`sameRequestWindowMs`). Una
  // reentrega del ASR de la MISMA peticion no acuna id: la fila se reutiliza. Un
  // solo criterio (comparador del motor + una ventana) para la ejecucion y la fila.
  const sameRequestAsLastDispatch = (text) => {
    const req = lastRequestRef?.current || { text: '', at: 0 }
    return isSameEmissionWithinWindow(String(req.text || ''), text, {
      sinceMs: Date.now() - Number(req.at || 0),
      windowMs: sameRequestWindowMs(),
    })
  }
  // ¿Es el mismo turno por CONTINUIDAD de la locucion? El ASR puede re-entregar
  // la misma locucion con mas texto (p. ej. "54" -> "54 chars of text") y eso NO
  // es un turno nuevo: es la misma locucion que crece. El id del turno se acuña
  // por LOCUCION, no por revision del ASR.
  const isContinuationOfSameLocution = (text) => {
    const req = lastRequestRef?.current || { text: '', at: 0 }
    const prev = String(req.text || '')
    const next = String(text || '')
    if (!prev || !next) return false
    const sinceMs = Date.now() - Number(req.at || 0)
    const windowMs = sameRequestWindowMs()
    if (sinceMs >= windowMs) return false
    // Misma emision (igual tras normalizar)
    if (isSameEmissionWithinWindow(prev, next, { sinceMs, windowMs })) return true
    // Continuacion: el texto nuevo empieza con el anterior y es mas largo
    const prevNorm = cleanForSpeech(prev).toLowerCase()
    const nextNorm = cleanForSpeech(next).toLowerCase()
    if (prevNorm.length >= 10 && nextNorm.length > prevNorm.length && nextNorm.startsWith(prevNorm)) return true
    return false
  }
  // MINTEO DEL ID: se acuña al ABRIR el turno de habla. En el pipeline de micro ese "turno"
  // es la LOCUCION: la frontera de audio cierra el turno vivo (`openPreviewTurnRef=false` al
  // emitir la fila de la locucion cerrada), asi que la locucion siguiente vuelve a acuñar y
  // NO reutiliza la fila de la anterior. El id es, por tanto, la identidad de la LOCUCION
  // en la fila (mismo id = re-emision de la misma locucion).
  const ensureTurnId = (isTurn, sameLive, sameLocution = false) => {
    if (!isTurn) return
    if (openPreviewTurnRef.current) return
    if (sameLive || sameLocution) return
    openPreviewTurnRef.current = true
    activeTurnIdRef.current += 1
  }

  if (!turnCommit) {
    // El ID del turno se acuna AL ABRIR el turno y ANTES de la caja: un bloqueo de la frase
    // viva (3b) no puede comerse el bump (wakeRowNoiseGuard: "un PREVIEW de ruido no mueve el
    // id del turno VIVO").
    ensureTurnId(esTurno(capture), sameRequestAsLastDispatch(capture), isContinuationOfSameLocution(capture))
    // LA FRASE VIVA SOLO ACUMULA (spec del dueno, 2026-10-11): si el ASR reentrega un TROZO
    // contiguo de lo YA MOSTRADO (una COLA, un trozo del medio), manda lo mostrado y el turno
    // no se toca. Antes el recorte solo se bloqueaba por PREFIJO (`wouldShrinkListenLog`), asi
    // que una COLA reemplazaba la frase entera ("la borra y deja dos o tres palabras, y luego
    // ya se vuelve a ver": log del dueno 2026-10-11 11:28). El criterio del trozo tiene UN
    // dueno (`isFragmentOfLocution`, el mismo de la recompuesta) y ahora es el de la sonda.
    // DUENO UNICO de la CAJA (spec del dueno 2026-10-11): UNA sola condicion de bloqueo, el TROZO
    // (cola/medio que reemplazaria la locucion entera). Se retiro la dimension de LONGITUD
    // (`encoge`/revision mas corta): una emision mas corta de la locucion en curso SI se aplica
    // (la caja refleja la emision actual, suba o baje). El VACIADO (len=0) no pasa por aqui: solo
    // lo hace el reset del cierre (silencio/cambio de hablante/commit).
    // LA CAJA SOLO ACUMULA: cualquier emision MAS CORTA que lo ya mostrado se BLOQUEA
    // (antes solo el TROZO contiguo, y una emision corta NO relacionada REEMPLAZABA:
    // medido 2026-10-11 22:36 -> 356 acortamientos APLICADOS y la frase viva "se comia"
    // parte de la transcripcion). Cero excepciones: acorta:true + aplicado = 0.
    const previoLive = publishedLiveRef.current || ''
    const esTrozo = isFragmentOfLocution(capture, previoLive)
    // La CAJA tiene UN dueno y UNA regla: `publicarEnLaCaja` (la fabrica de la caja). Aqui no se
    // escribe el ref: se pide la publicacion y se registra la decision (sonda de la caja).
    const publicacion = publicarEnLaCaja(capture, { turnId: activeTurnIdRef.current })
    if (publicacion.aplicado) {
      voiceProbe('live', { turn: activeTurnIdRef.current, resultado: 'aplicado', motivo: publicacion.destino === capture ? 'emision-actual' : 'solape-anadido', acorta: publicacion.destino.length < publicacion.previo, fresh: Boolean(freshUtterance), mismaLocucion: false, reemplaza: publicacion.destino === capture, previo: publicacion.previo, len: publicacion.destino.length, text: publicacion.destino.slice(0, 220) }) // BANDERA DE DIAGNOSTICO
    } else {
      voiceProbe('live', { turn: activeTurnIdRef.current, resultado: 'bloqueado', motivo: capture.length < previoLive.length ? (esTrozo ? 'trozo' : 'acorta') : 'no-conserva', acorta: capture.length < previoLive.length, fresh: Boolean(freshUtterance), mismaLocucion: esTrozo, previo: previoLive.length, len: capture.length, text: capture.slice(0, 220) }) // BANDERA DE DIAGNOSTICO
    }
    if (turnBoundary || atTurnBoundary) {
      const fallbackSpeaker = speaker || getSpeakerLabel(listenStateRef.current)
      const phrase = cleanForSpeech(utterance) || capture
      const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
      const forceWakeDiarize = Boolean(detectWakeIntroducedName(phrase, wakeWords))
      applyConversationSpeaker(phrase, fallbackSpeaker, {
        force: forceWakeDiarize || diarize,
        atTurnBoundary: true,
        allowNewCluster: true,
      })
    }
    if (import.meta.env.DEV && debugHotPath) {
      fluDebugHot('stream-preview', { capture, turnBoundary, session: readSession(listenStateRef.current) })
    }
    return
  }

  flushPendingStreamLog()
  // El preview ya protegia el recorte por ruido ASR, pero aqui se commiteaba el
  // texto recortado: la fila quedaba mas corta que lo mostrado y se perdia la cola.
  // EXCEPCION UNICA: `locutionClosed` es texto CERRADO (un final ya confirmado que se
  // volco porque llego otra locucion). Reconciliarlo contra la linea viva metia en su
  // fila el interino de la locucion SIGUIENTE (medido 2026-10-19: filas 430 y 468).
  // CIERRE (2026-10-21): la caja NO se tira. Con la locucion ABIERTA se reconcilia como
  // siempre (dueno: `reconcileCommitText`). Con `locutionClosed` (texto ya confirmado que
  // se vuelca porque llego otra locucion) se adopta la caja SOLO si el final es PARTE de
  // ella (`isFragmentOfLocution`): un final corto ("mientras") tras interinos largos deja
  // de llevarse la fila, y un texto AJENO (la caja es de la locucion siguiente) no se
  // inyecta en esta fila.
  let cajaDelTurno = String(publishedLiveRef.current || '')
  // IDENTIDAD DE TURNO: un texto CERRADO solo adopta la caja si AMBAS son del mismo
  // turno. Si el turno de la caja no se conoce (publicacion externa) NO se adopta:
  // la caja pudo avanzar a la locucion SIGUIENTE (defecto medido 2026-10-19).
  const turnoDeLaCaja = typeof caja?.turnoActual === 'function' ? caja.turnoActual() : null
  if (!locutionClosed) {
    // BARRERA B.3/P11.9: "fila = caja" NO puede rebajar la fila. Si la linea viva es
    // la MISMA locucion y tiene la frase completa, se hace CRECER la caja (nunca
    // encoger) y se commitea esa misma frase. Si la caja y la linea son locuciones
    // distintas, no se mezclan: manda la caja/reconciliacion existente.
    const lineaVivaCierre = cleanForSpeech(readTurnLive(listenStateRef.current) || '')
    if (
      cajaDelTurno &&
      lineaVivaCierre &&
      utterancesSameRevision(lineaVivaCierre, cajaDelTurno) &&
      lineaVivaCierre.length > cajaDelTurno.length
    ) {
      const publicacionCierre = publicarEnLaCaja(lineaVivaCierre, {
        turnId: activeTurnIdRef.current,
      })
      if (publicacionCierre.aplicado) cajaDelTurno = publicacionCierre.destino
    }
    // FRASE CANONICA: si la captura es el CIERRE del turno o una CONFIRMACION del ASR,
    // manda ELLA y no se reconcilia contra el boceto: reconciliar resucitaba el tartamudeo
    // del interino sobre la frase limpia ("puso Cloud Cloud" ganaba a "puso Cloud"). El boceto
    // ya tuvo su oportunidad arriba (crecer con la linea viva de la misma revision).
    // FRASE CANONICA: si la captura es el CIERRE del turno o una CONFIRMACION del ASR,
    // manda la frase CONFIRMADA y no se reconcilia contra el boceto, porque reconciliar
    // resucitaba el tartamudeo del interino sobre la frase limpia ("puso Cloud Cloud" ganaba
    // a "puso Cloud"). EXCEPCION: si el boceto APORTA habla que la frase no dice (misma
    // locucion mas completa), manda el boceto (barrera P11.9). El criterio de "no aporta" es
    // el MISMO de la caja: `bocetoCubiertoPor`.
    const fraseCanonica = Boolean(settlesTurn || confirmedFinal)
    const elBocetoAportaHabla = fraseCanonica && Boolean(cajaDelTurno) && !bocetoCubiertoPor(cajaDelTurno, capture)
    if (!fraseCanonica || elBocetoAportaHabla) capture = reconcileCommitText(capture, cajaDelTurno)
  } else if (
    cajaDelTurno &&
    isFragmentOfLocution(capture, cajaDelTurno) &&
    // IDENTIDAD OBLIGATORIA: un texto CERRADO solo adopta la caja si AMBOS turnos se conocen
    // y son el MISMO. Un `null` (sello perdido, publicacion externa) NO autoriza a adoptar:
    // la caja pudo avanzar a la locucion siguiente y su texto acabaria en la fila anterior.
    turnoDeLaCaja !== null &&
    turnoDelTextoCerrado !== null &&
    Number(turnoDeLaCaja) === Number(turnoDelTextoCerrado)
  ) {
    capture = cajaDelTurno
  }
  // P11.26 (medido 2026-10-14 18:32 en su corrida): las FILAS quedaban con el tartamudeo del ASR
  // dentro ("prueba pruebas pruebas", "trans transcripcion transcripcion", "vi viste viste viste"):
  // la caja pasa por el colapsador y la fila escribia el texto CRUDO. Una sola definicion de
  // texto: la fila usa el MISMO normalizador que la caja (normalizeMicText, dueno unico).
  // NORMALIZADOR UNICO de la fila (auditoria 2026-10-23): el mismo que la caja (B.3).
  capture = normalizeMicText(capture)

  // FRASE CANONICA (con el texto ya DEFINITIVO): la caja termina el turno con la MISMA frase
  // que la fila (B.3). Hay DOS ocasiones en que la captura es la frase canonica y no una
  // hipotesis interina: el CIERRE REAL (`settlesTurn`) y la CONFIRMACION del ASR
  // (`confirmedFinal`, final de segmento). Una emision INTERINA jamas sustituye.
  // Se publica DESPUES de `normalizeMicText`: reconciliar con la caja puede devolver el texto
  // de la caja y la normalizacion lo colapsa; publicar antes dejaba caja y fila distintas
  // (medido d4c1c8f3 #0: la caja conservaba "ya esta ya esta" y la fila no).
  // QUE SE ADMITE lo decide la CAJA (`publicarEnLaCaja`, dueno unico): crecer, la MISMA
  // revision o un boceto que es solo un ECO de la frase. El canon puede ser MAS CORTO
  // ("puso Cloud Cloud" -> "puso Cloud") y ahi la caja tiene que ceder.
  if (
    (settlesTurn || confirmedFinal) &&
    capture &&
    cajaDelTurno &&
    capture !== cajaDelTurno
  ) {
    const publicacionDelCierre = publicarEnLaCaja(capture, {
      turnId: activeTurnIdRef.current,
      canonica: true,
    })
    if (publicacionDelCierre.aplicado) cajaDelTurno = publicacionDelCierre.destino
  }

  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  const lastCommittedRow = logRowsTextRef.current.at(-1) || ''
  let fluTailAfterCommit = null
  const inlineWake = resolveInlineWakeAtCommit(capture, lastCommittedRow)
  if (inlineWake.fluTail) {
    fluTailAfterCommit = inlineWake.fluTail
  }
  // La wake SOLO es compuerta de ACCION (¿se ejecuta el comando?), NUNCA de fila:
  // la TRANSCRIPCION se registra SIEMPRE (requisito del dueno, 2026-10-06). El
  // veredicto de wake se calcula ANTES de recortar la cola flu: una captura mixta
  // ("... ok flu <orden>") SI lleva wake.
  capture = inlineWake.capture

  // MISMA locucion viva: la decide el MISMO criterio que el id (la memoria del
  // despacho + la ventana compartida). Solo esa (re-emision) se bloquea, no el habla.
  const mismaLocucionViva = sameRequestAsLastDispatch(capture)
  const ambientRowBlocked = mismaLocucionViva

  // El id del turno se acuna para todo COMMIT real: la fila lo necesita (antes
  // se acuñaba solo con wake y el ruido se quedaba sin fila NI id).
  ensureTurnId(true, mismaLocucionViva, isContinuationOfSameLocution(capture))

  // §9 Sella el turno: captura UNA vez su audio (dueño: turnAudioSnapshot.js) con
  // el id YA acuñado, antes de que `finalizeTurnCommit` vacíe el buffer PCM.
  if (turnCommit && typeof captureTurnAudio === 'function') captureTurnAudio()

  // unico escritor del log: si esta MISMA frase ya se cerró y no llegó habla
  // nueva desde ese commit (doble `onend`/doble dispatch), es una re-emisión
  // del mismo turno, no una fila nueva.
  const dupCheck = {
    lastEmitted: lastEmittedTranscriptRef?.current || '',
    lastCommitted: lastCommittedRow,
    lastResultAt: lastOnresultAtRef?.current || 0,
    lastCommitAt: lastCommitAtRef?.current || 0,
    now: Date.now(),
    echoWindowMs: committedEchoStreakWindowMs(),
  }
  const esDuplicado = isDuplicateTurnCommit(capture, dupCheck)
  // BANDERA DE DIAGNOSTICO CONCLUYENTE: el veredicto del dedupe con sus ENTRADAS (edades y
  // ventana). Sin esto, una locucion duplicada no se podia diagnosticar desde el log.
  voiceProbe('dup', { turn: activeTurnIdRef.current, dup: esDuplicado, lastEmitted: dupCheck.lastEmitted.slice(0, 60), lastCommittedRow: dupCheck.lastCommitted.slice(0, 60), resultAgeMs: dupCheck.now - dupCheck.lastResultAt, commitAgeMs: dupCheck.now - dupCheck.lastCommitAt, echoWindowMs: dupCheck.echoWindowMs, capture: capture.slice(0, 60) }) // BANDERA DE DIAGNOSTICO
  if (esDuplicado) {
    discardLocution({ reason: DISCARD_REASONS.DUPLICATE_COMMIT, phrase: capture, site: 'turn-commit', log: relayLog })
    return
  }

  const finalizeTurnCommit = (closeTurn = false) => {
    finalizeTurnIdentityPipeline(activeTurnIdRef.current)
    lastCommitAtRef.current = Date.now()
    // SOLO el cierre REAL limpia la locucion viva y sella el turno. Un `final` de
    // SEGMENTO de Chrome (pausa BREVE dentro del mismo dictado) NO cierra: el texto
    // sigue visible en ULTIMA FRASE hasta el silencio/onend/cambio de hablante.
    // Antes cada segmento cerraba el turno y "vaciaba" la ultima frase a la
    // conversacion (medido 2026-10-08 por el dueno: al llegar al 9 ya estaba
    // vaciada, sin silencio real ni cambio de hablante). Mientras no cierre, el id
    // del turno NO avanza (`openPreviewTurnRef` sigue abierto) -> UNA fila.
    //
    // El cierre (limpiar la locucion, sellar el audio) lo hace UN solo dueno:
    // `closeLiveTurn`. El cierre NO borra lo publicado ni su memoria: la transicion a
    // una locucion NUEVA la decide el dueno del trozo (`isFragmentOfLocution`: una
    // frase que NO es trozo reemplaza lo mostrado; un trozo conserva la COMPLETA).
    // Borrar aqui era la via por la que una COLA del ASR dejaba la frase en dos o tres
    // palabras (log del dueno 2026-10-11 11:28) y la razon del parpadeo del 2026-10-10.
    if (closeTurn) closeLiveTurn(deps)
    if (fluTailAfterCommit?.action?.kind === 'flu' && fluTailAfterCommit.action.question) {
      void processConversationFluQueryRef.current(
        fluTailAfterCommit.fullCapture,
        fluTailAfterCommit.action,
      )
    }
  }

  // §9.5 -> RUTA aNICA de cierre de turno: finalize + aviso al participante.
  // Las dos ramas (segmentada y simple) cierran por aquí; no se invoca
  // `finalizeTurnCommit` en más de un punto.
  const finalizeAndNotify = () => {
    finalizeTurnCommit(settlesTurn)
    fluParticipantRef.current?.onTurnCommitted?.()
  }

  // UNICA puerta de emision de la fila de conversacion de un turno: el ruido de
  // fondo no la cruza (`ambientRowBlocked`). Los dos commits que emiten (ramas
  // segmentada y simple) pasan por aqui, asi que la regla vive en un solo sitio.
  const emitTurnRow = (text, options) => {
    if (!ambientRowBlocked) return emitConversationLog(text, options)
    // B1: la locucion viva bloquea la fila y el descarte deja su motivo.
    discardLocution({ reason: DISCARD_REASONS.AMBIENT_BLOCKED, phrase: text, site: 'emit-row', log: relayLog })
    return false
  }

  const {
    replaceLast,
    forcedReplacePrefix,
    effectiveNewParagraph,
  } = resolveMicCommitAction(
    {
      published: publishedLiveRef.current,
      preview: publishedLiveRef.current,
      openPreview: openPreviewTurnRef.current,
      lastEmitted: lastEmittedTranscriptRef.current,
    },
    {
      capture,
      newParagraph,
      turnBoundary,
      lastCommitted: lastCommittedRow,
    },
  )
  if (import.meta.env.DEV && debugHotPath && forcedReplacePrefix) {
    fluDebugHot('log-asr-revision-blocked', {
      prior: lastCommittedRow || lastEmittedTranscriptRef.current,
      capture,
    })
  }
  if (effectiveNewParagraph || turnBoundary) {
    openPreviewTurnRef.current = false
  }

  const refreshNeeded =
    !replaceLast || shouldRefreshStream(lastEmittedTranscriptRef.current, capture)

  // TURNO DE LA FILA (mandato 2026-10-23, 3a pasada): un RECORTE de la frase YA emitida
  // escribe SU turno, no el que acaba de acuñar el preview. Es la MISMA regla de
  // `commitAndResolveTurn` (el turno de la frase, no el vivo). El criterio de "es un recorte"
  // es el dueño unico del trozo (`isFragmentOfLocution`): una REPETICION identica NO es un
  // trozo y sigue siendo un turno nuevo (Anexo B.14: no se funde una repeticion genuina).
  const recorteDeLaEmitida =
    replaceLast &&
    lastEmittedTurnRef?.current &&
    Boolean(isFragmentOfLocution(capture, lastEmittedTranscriptRef.current))
  const turnIdDeLaFila = recorteDeLaEmitida ? lastEmittedTurnRef.current : activeTurnIdRef.current

  const fallbackSpeaker = speaker || getSpeakerLabel(listenStateRef.current)
  const phrase = cleanForSpeech(utterance) || capture
  const forceWakeDiarize = Boolean(detectWakeIntroducedName(phrase, wakeWords))
  const sameRevisionReplace =
    replaceLast &&
    lastCommittedRow &&
    utterancesSameRevision(lastCommittedRow, capture)

  markCommitPerfNow()
  const turnId = activeTurnIdRef.current
  const preflight = finalizeTurnIdentityPipeline(
    // El slot que el LLAMADOR esperó (ver el typedef). Si no hay espera previa ->la
    // ruta del comando y el commit sin preview-> se consume el turno del commit.
    Number.isFinite(Number(preflightTurnId)) && Number(preflightTurnId) > 0
      ? Number(preflightTurnId)
      : turnId,
    buildFinalSpeakerSnapshotResolver({ createSpeakerAudioResolver, phrase, turnId }),
    // §9 El cluster del turno se persiste POR EL DUENO UNICO (`setSpeakerClusters`)
    // cuando el snapshot final resuelve -> aunque sea despues del commit. Sin esto el
    // primer cluster se perdia y ninguna voz se podia separar (inClusters=0 siempre).
    { onClusters: setSpeakerClusters, onResolved: applyResolvedSpeaker },
  )

  const stickyFallback = resolveCommitStickyFallback({
    sessionPrimary: sessionPrimarySpeakerRef.current,
    lastResolved: lastResolvedSpeakerRef.current,
    lastLogged: lastLoggedSpeakerRef.current,
    fallback: fallbackSpeaker,
    phrase,
  })

  const explicitNext = detectNextSpeakerPhrase(phrase)
  let resolved = resolveTurnSpeakerAtCommit({
    phrase,
    wakeWords,
    stickyFallback,
    sessionPrimary: sessionPrimarySpeakerRef.current,
    lastLogged: lastLoggedSpeakerRef.current,
    sameRevisionReplace,
    preflight,
    knownSpeakerLabels: logRowSpeakersRef.current,
    clusters: speakerClustersRef.current,
    forceNewRowOnSegment: Boolean(forceNewRowOnSegment || turnBoundary || atTurnBoundary),
  })

  const soloSession =
    (speakerClustersRef.current || []).filter(
      (c) => isAutoSpeakerLabel(c?.label) && Array.isArray(c?.signature) && c.signature.length,
    ).length === 1

  if (preflight?.ready && !sameRevisionReplace && !explicitNext && !forceWakeDiarize) {
    const anchored = anchorResolvedToLastLogged(resolved.speakerName, stickyFallback, {
      weakAsrEvidence: isWeakAsrSpeakerEvidence({
        phrase,
        lastCommitted: lastCommittedRow,
      }),
      sessionPrimary: sessionPrimarySpeakerRef.current,
      phrase,
      preflightReady: preflight.ready,
      preflightSpeaker: preflight.speakerName,
      soloSession,
    })
    if (anchored && anchored !== resolved.speakerName) {
      resolved = {
        ...resolved,
        speakerName: anchored,
        speakerId: labelToSpeakerId(anchored),
      }
    }
  }

  // UN DUENO de "que hablante lleva la fila": la resolucion del turno
  // (`resolveTurnSpeakerAtCommit`, que YA trata la revision del mismo utterance) y el
  // escritor unico de la fila (`commitUserTurnRow` -> `resolveRowSpeakerName`).
  // Aqui se aporta la ETIQUETA RESUELTA (la voz) y SI hay evidencia acustica; el
  // escritor aplica la regla CON esa evidencia.
  // La etiqueta se escribe SIEMPRE (leccion A5): la evidencia acustica decide el
  // ASCENSO a nombre propio, NO si se escribe. Medido en el log del dueno (2026-10-10):
  // con `preflight.ready` casi siempre false, el gate condicionaba la ESCRITURA de la
  // etiqueta y dejaba `written:""` en 41/41 commits; la fila quedaba a merced de una
  // SEGUNDA resolucion por TEXTO (`resolveSpeakerByText` dentro de `emitConversationLog`):
  // dos duenos del nombre de la fila. Un dato, un dueno.
  // NOMBRE PROPIO SIN EVIDENCIA: la etiqueta del resolver puede ser un nombre heredado por
  // CONTINUIDAD (fuente `sticky`/`asr-revision`, sin ventana de audio). Eso NO se estampa:
  // degrada al label generico. El dueno de esa regla es `blindSpeakerFallback`
  // (speakerPolicy), que estaba ESCRITA Y SIN NINGUN CONSUMIDOR (medido): el defecto
  // "Luis pegado a una voz distinta" (P3 del e2e del dueno) pasaba con ella muerta.
  // Solo la evidencia de IDENTIDAD levanta el nombre: la acustica (preflight) o las
  // fuentes que lo traen de un dato (el texto "soy X" y el panel de participantes).
  // Fuentes que traen el nombre por DATO: SOLO el texto del mandato ("Okay flu soy Luis"). El
  // PARTICIPANTE queda FUERA (spec del dueno, 2026-10-11): un nombre propio solo se afirma con
  // coincidencia MEDIDA contra su ancla; elegir a Luis en el onboarding no etiqueta sus filas.
  const FUENTES_CON_IDENTIDAD = ['wake-intro']
  // Evidencia = la MEDIDA del turno (dueno: `preflightEvidenceMeasured`), no "hay clusters".
  const evidenciaAcustica = preflightEvidenceMeasured(preflight)
  const crudo = resolved.speakerName || fallbackSpeaker
  // P9.81 (spec del dueno 2026-10-12): SI al reuso del CLUSTER, NO al NOMBRE sin evidencia.
  // Levanta el nombre la MEDIDA del turno o el DATO del mandato ("soy Luis"); un nombre
  // heredado por CONTINUIDAD cae a generico via `blindSpeakerFallback`, que es la regla
  // escrita para esto ("Luis pegado a una voz distinta": medido 2026-10-12 con
  // `reason=production-reuse-no-evidence`). Antes un atajo la saltaba (ya retirado).
  const speakerResuelto =
    evidenciaAcustica ||
    FUENTES_CON_IDENTIDAD.includes(resolved.source) ||
    // La REVISION del MISMO turno no es continuidad: si el nombre ya lo PRESENTO la
    // voz en este turno, la revision lo conserva (antes se degradaba a "Hablante N").
    (resolved.source === 'asr-revision' && isSessionPrimaryPresented(sessionPrimarySpeakerRef))
      ? crudo
      : blindSpeakerFallback(crudo)
  const speakerName = normalizeSpeakerLabel(speakerResuelto)
  const speakerEscrito = speakerName

  // UNA LOCUCION CERRADA (frontera de audio) es UNA unidad de texto: no se trocea. El
  // troceo es para un TURNO con varias locuciones/hablantes; partir aqui volveria a
  // repartir la locucion en varias filas.
  let segmentPlan =
    !sameRevisionReplace && turnCommit && !locutionClosed
      ? planAsrTurnSegments({
          phrase: capture,
          priorTexts: logRowsTextRef.current,
          priorSpeakers: logRowSpeakersRef.current,
          preflight,
          fallbackSpeaker: speakerName,
        })
      : []

  const minCoverage = Number(getAsrSegmentationCfg().minCoverageRatio)
  if (
    segmentPlan.length >= 2 &&
    !segmentPlanCoversCapture(segmentPlan, capture, minCoverage)
  ) {
    segmentPlan = []
  }

  if (segmentPlan.length >= 1) {
    let replaceNext = replaceLast
    // Solo si alguna fila se EMITIO de verdad se mueve la marca del turno
    // (`lastEmittedTranscriptRef`): un commit de SEGMENTO sin cierre no emite nada.
    let segmentRowsEmitted = false
    for (let index = 0; index < segmentPlan.length; index += 1) {
      const segment = segmentPlan[index]
      const segmentText = cleanForSpeech(segment.text)
      if (!segmentText) continue

      const segmentSpeaker = normalizeSpeakerLabel(segment.speaker || speakerName)
      applyResolvedSpeakerToSessionRefs(
        { ...resolved, speakerName: segmentSpeaker, previousLabel: fallbackSpeaker || stickyFallback || segmentSpeaker },
        {
          lastSpeakerRef,
          lastLoggedSpeakerRef,
          sessionPrimarySpeakerRef,
          speakerClustersRef,
          setSpeakerClusters,
          renameSpeakerRows,
          registerParticipant,
        },
      )
      // FIRMA DEL TURNO = su medida, o NADA (dueno: `turnMeasurement`, turnSpeakerCommit).
      // Sin medida se LIMPIA: heredar la del turno anterior haria comparar contra una voz
      // que ya no es la de `lastSpeaker`; `resolveLastTurnSimilarity` cae entonces a la
      // firma del cluster de `lastSpeaker`, que es la evidencia correcta.
      lastTurnSignatureRef.current = resolved.signatureVector?.length ? resolved.signatureVector : null
      syncSpeakerIndexFromLabel(listenStateRef.current, segmentSpeaker)
      marcarUltimaLinea(segmentText)
      lastLoggedSpeakerRef.current = segmentSpeaker
      lastSpeakerRef.current = segmentSpeaker

      const segmentReplace = replaceNext
      if (refreshNeeded && settlesTurn) {
        const delivered = emitTurnRow(segmentText, {
          speakerName: segmentSpeaker,
          fallbackSpeaker: segmentSpeaker,
          currentClock: formatClock(),
          replaceLastRawLog: segmentReplace,
          streamUpdate: false,
          turnCommit: true,
          settlesTurn,
          turnId: turnIdDeLaFila,
        })
        if (delivered) {
          lastEmittedTranscriptRef.current = segmentText
          segmentRowsEmitted = true
        }
      }
      const turnIdParaVaciar = preflightTurnId ?? activeTurnIdRef?.current ?? null
      commitTurnToSessionRows(segmentText, segmentSpeaker, {
        replaceLast: segmentReplace,
        turnId: turnIdParaVaciar,
      })
      // VACIAR CAJA: pending -> committed para ese turno (una sola via del vaciado)
      if (turnIdParaVaciar !== null && turnIdParaVaciar !== undefined) {
        vaciarLaCaja({ visible: false })
      }
      replaceNext = false
    }

    // El texto COMPLETO queda como marca del turno SOLO si el troceo EMITIO fila (cierre
    // real). Un segmento SIN cierre NO la mueve: marcaria la locucion como ya commiteada
    // y el cierre real (mismo texto, `settlesTurn:true`) caeria como duplicado y se
    // perderia sin fila (defecto medido P9.59).
    if (segmentRowsEmitted) {
      lastEmittedTranscriptRef.current = capture
    }
    // CIERRE REAL del turno troceado: la caja visible tambien termina su turno. Antes
    // solo se reseteaba la MEMORIA por segmento (`visible:false`) y la ultima frase
    // quedaba pintada tras pasar a la conversacion (defecto 2 del dueno). Si la
    // locucion ya estaba confirmada (`locutionClosed`), el vaciado es solo de memoria:
    // la frase viva en pantalla pertenece al dictado siguiente.
    // SOLO si el troceo EMITIO fila: vaciar sin emitir perdia la transcripcion (defecto
    // 1 del dueno). Con `asrSegmentation` apagado este camino no se alcanza; el contrato
    // se conserva por si el planificador vuelve a activarse.
    if (settlesTurn && segmentRowsEmitted) vaciarTrasCierre()
    finalizeAndNotify()

    if (import.meta.env.DEV && debugHotPath) {
      fluDebugHot('stream-commit-segmented', {
        segments: segmentPlan.length,
        capture,
        session: readSession(listenStateRef.current),
      })
    }
    return
  }

  applyResolvedSpeakerToSessionRefs(
    { ...resolved, speakerName, previousLabel: fallbackSpeaker || stickyFallback },
    {
      lastSpeakerRef,
      lastLoggedSpeakerRef,
      sessionPrimarySpeakerRef,
      speakerClustersRef,
      setSpeakerClusters,
      renameSpeakerRows,
      registerParticipant,
    },
  )
  // FIRMA DEL TURNO = su medida, o NADA (dueno: `turnMeasurement`, turnSpeakerCommit).
  lastTurnSignatureRef.current = resolved.signatureVector?.length ? resolved.signatureVector : null
  syncSpeakerIndexFromLabel(listenStateRef.current, speakerName)
  marcarUltimaLinea(capture)
  lastLoggedSpeakerRef.current = speakerName
  lastSpeakerRef.current = speakerName

  relayLog('LOG', 'RowTrace', `refresh=${refreshNeeded} blocked=${ambientRowBlocked} replace=${replaceLast} turn=${activeTurnIdRef.current} cap="${capture.slice(0, 60)}"`) // BANDERA DE DIAGNOSTICO
  voiceProbe('commit', { preReady: Boolean(preflight?.ready), src: resolved.source, name: resolved.speakerName, written: speakerEscrito, shown: publishedLiveRef.current.slice(0, 220), wc: resolved.workingClusters?.length ?? 0, refClusters: speakerClustersRef.current?.length ?? 0, sticky: stickyFallback, turn: activeTurnIdRef.current, replace: replaceLast, len: capture.length, capture: capture.slice(0, 220) }) // BANDERA DE DIAGNOSTICO
  let delivered = false
  // La fila de CONVERSACION se escribe al CIERRE REAL del turno O cuando la LOCUCION ya
  // esta CERRADA por audio (`locutionClosed`, frontera VAD): esa locucion tiene su propia
  // fila aunque el TURNO siga abierto (el final tardio del ASR la reemplaza).
  // Chrome cierra SEGMENTOS mientras sigues hablando (un `final` por tramo) y esos
  // commits NO declaran ninguna de las dos cosas: antes cada tramo volcaba la ultima
  // frase a la conversacion (medido 2026-10-08 por el dueno: al llegar al 9 ya estaba
  // vaciada). El texto NO se pierde: sigue en la locucion viva (ULTIMA FRASE) y en
  // la fila de SESION; el cierre (onend, srGap, split por wake) la escribe completa.
  if (settlesTurn || locutionClosed) {
    // La fila se escribe si hay REFRESCO o si la frase AUN NO esta en la ultima fila:
    // un cierre podia llegar con `refreshNeeded:false` (misma marca emitida) y la fila
    // sin el texto, y el vaciado incondicional la borraba (defecto 1 del dueno
    // 2026-10-19: se veia en ULTIMA FRASE y nunca pasaba a la conversacion).
    const yaEstaEnFila = phrasesEquivalent(capture, lastCommittedRow)
    if (refreshNeeded || !yaEstaEnFila) {
      delivered = emitTurnRow(capture, {
        speakerName: speakerEscrito, evidenciaAcustica,
        fallbackSpeaker: speakerName,
        currentClock: formatClock(),
        replaceLastRawLog: replaceLast,
        streamUpdate: false,
        turnCommit: true,
        settlesTurn: Boolean(settlesTurn),
        locutionClosed,
        turnId: turnIdDeLaFila,
      })
      if (delivered) {
        lastEmittedTranscriptRef.current = capture
        if (lastEmittedTurnRef) lastEmittedTurnRef.current = activeTurnIdRef.current
      }
    }
    // RACIONAL DEL DUENO (2026-10-11): la locucion YA se vacio a la conversacion -> la caja
    // arranca de CERO. Es el reset por ITERACION NUEVA: con la memoria a "" el dictado
    // siguiente no puede quedar congelado por ser mas corto que el anterior. El cierre es
    // SIEMPRE un vaciado real a la conversacion (settlesTurn); con el turno ABIERTO la
    // frase jamas se acorta (ver `publicarEnLaCaja`).
    //
    // El vaciado pertenece al CIERRE, pero SOLO cuando la frase quedo A SALVO: se entrego
    // ahora (`delivered`), ya estaba en la fila (`yaEstaEnFila`) o es re-emision de la
    // locucion viva (`ambientRowBlocked`: su fila original existe). Si no se entrego y no
    // esta en fila, la caja NO se vacia: el texto sigue vivo y el cierre siguiente
    // (onend/srGap) lo rescata -> borrarla igual era el defecto 1 del dueno (la frase
    // desaparecia de ULTIMA FRASE sin haber pasado a la conversacion).
    //
    // Si la locucion ya estaba confirmada (`locutionClosed`), la memoria se resetea y
    // la frase viva se deja en pantalla (pertenece al dictado siguiente).
    // `locutionClosed` sin `settlesTurn`: el TURNO sigue abierto y el vaciado de la caja lo
    // hace el dueno de la frontera (el ingress), que acaba de escribir esta fila.
    if (settlesTurn && (delivered || yaEstaEnFila || ambientRowBlocked)) vaciarTrasCierre()
  }
  commitTurnToSessionRows(capture, speakerEscrito, { replaceLast })
  // `lastEmittedTranscriptRef` es el texto de la ULTIMA locucion EMITIDA y ademas la FUENTE
  // del dedupe (`isDuplicateTurnCommit`): solo puede moverla quien EMITE la fila (arriba,
  // `if (delivered)`). Escribirla cuando NO se emitio (segmento sin cierre) marcaba la
  // locucion como "ya emitida" y el CIERRE real (mismo texto, `settlesTurn:true`) caia
  // como duplicado -> la locucion entera se perdia sin fila (defecto medido P9.59).
  finalizeAndNotify()

  if (import.meta.env.DEV && debugHotPath) {
    fluDebugHot('stream-commit', {
      capture,
      newParagraph,
      replaceLast,
      freshUtterance,
      utterance,
      session: readSession(listenStateRef.current),
    })
  }
}
