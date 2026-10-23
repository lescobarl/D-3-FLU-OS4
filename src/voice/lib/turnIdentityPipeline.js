/**
 * Pipeline de identidad por ventana: snapshots de audio al worker cada N ms
 * durante interinos; al FINAL el embedding ya está en caché local.
 */
import { FLU_CONFIG } from './fluConfig.js'
import {
  scheduleTurnSpeakerPreflight,
  consumeTurnSpeakerPreflight,
  peekTurnSpeakerPreflight,
  resetTurnSpeakerPreflights,
  resetSessionSpeakerSnapshots,
} from './turnSpeakerPreflight.js'

const timersByTurn = new Map()

/**
 * @param {{ voiceIdentity?: { capture?: { identityPipeline?: { snapshotIntervalMs?: number } } } }} [config]
 */
export function getIdentitySnapshotIntervalMs(config = FLU_CONFIG) {
  const ms = Number(config.voiceIdentity?.capture?.identityPipeline?.snapshotIntervalMs)
  return Number.isFinite(ms) && ms >= 200 ? ms : 800
}

/** Clave del pipeline que sigue al turno ACTUAL (su id se resuelve en cada tick). */
const DYNAMIC_KEY = '__dynamic__'

/**
 * DUENO UNICO del gate del tick continuo: "el AUDIO del turno avanzo" = su cuenta de
 * muestras capturadas. La revision se DERIVA del buffer de audio; el llamador NO la
 * aporta. Antes la opcion era una `getAudioRevision` opaca y el hook le pasaba el TEXTO
 * del display (`publishedLiveRef`), que cambia con cada interim -> el gate nunca frenaba
 * (MEDIDO 2026-10-12 en el log del dueno: 6 resoluciones con salida IDENTICA
 * -lastSim=0.706, clusters=2- para el mismo turno abierto; se re-embebia el MISMO audio
 * y el embedder competia con el ASR local hasta cortar la transcripcion). Con el buffer
 * como entrada, el display NO es expresable: no hay forma de colarlo.
 * @param {{ getTotalSamples?: () => number, totalSamples?: number }|null} [audioBuffer]
 * @returns {number}
 */
export function identityAudioRevision(audioBuffer) {
  const n = audioBuffer?.getTotalSamples?.() ?? audioBuffer?.totalSamples
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * @param {number|(() => number)} turnId — numero (pipeline atado a ese turno) o
 *   GETTER (pipeline que sigue al turno actual). El getter es lo que usa el hook:
 *   el id del turno se acuña MAS TARDE que el aviso de inicio, asi que capturarlo
 *   al arrancar dejaba los snapshots en un slot que el commit no miraba
 *   (medido: `Preflight turn=5` vs `Commit turn=9` -> `preReady=false` siempre).
 */
export function startContinuousIdentityPipeline(turnId, runFactory, { onClusters, onResolved, getAudioBuffer } = {}) {
  const dynamic = typeof turnId === 'function'
  const initialId = Number(dynamic ? turnId() : turnId)
  if (!Number.isFinite(initialId) || initialId <= 0) return

  stopContinuousIdentityPipeline(initialId)

  // RENDIMIENTO (medido 2026-10-07): el tick corria cada 800 ms aunque el audio del
  // turno NO hubiera cambiado -> se re-embebia la MISMA ventana (log: `Preflight
  // turn=7 ready=true vec=512` repetido cada ~3 s). El gate lo gobierna el AUDIO del
  // turno (`identityAudioRevision`, derivado del buffer): si no avanzo, no hay nada
  // nuevo que embeber.
  let lastRevision = null
  const tick = () => {
    const id = dynamic ? Number(turnId()) : initialId
    if (!Number.isFinite(id) || id <= 0) return
    if (typeof getAudioBuffer === 'function') {
      const revision = identityAudioRevision(getAudioBuffer())
      if (lastRevision !== null && revision === lastRevision) return
      lastRevision = revision
    }
    // El resolutor se ata al turno del TICK: sin el id, `getCapturedAudio` leia
    // `activeTurnIdRef.current` en el momento de EJECUTAR el job y un tick viejo
    // media el audio del turno siguiente (dos duenos del turno).
    const run = typeof runFactory === 'function' ? runFactory(id) : runFactory
    if (typeof run !== 'function') return
    scheduleTurnSpeakerPreflight(id, run, { onClusters, onResolved, continuous: true })
  }

  tick()
  const intervalMs = getIdentitySnapshotIntervalMs()
  const timer = setInterval(tick, intervalMs)
  timersByTurn.set(dynamic ? DYNAMIC_KEY : initialId, timer)
}

export function stopContinuousIdentityPipeline(turnId) {
  const id = Number(turnId)
  const timer = timersByTurn.get(id)
  if (timer) {
    clearInterval(timer)
    timersByTurn.delete(id)
  }
  // El pipeline DINAMICO sigue al turno actual: pararlo con el id del commit
  // (cualquiera) debe detenerlo, o sus ticks siguen pisando el slot final.
  const dynamicTimer = timersByTurn.get(DYNAMIC_KEY)
  if (dynamicTimer && id !== DYNAMIC_KEY) {
    clearInterval(dynamicTimer)
    timersByTurn.delete(DYNAMIC_KEY)
  }
}

export function stopAllContinuousIdentityPipelines() {
  for (const timer of timersByTurn.values()) {
    clearInterval(timer)
  }
  timersByTurn.clear()
}

/**
 * @param {number} turnId
 * @param {Function} [runFinalSnapshot] - RESOLUTOR (funcion -> resultado) o FABRICA
 *   (funcion -> resolutor); ambas formas se aceptan (ver `run` abajo).
 * @param {{ onClusters?: Function }} [options] — `onClusters` recibe los clusters del
 * snapshot FINAL cuando resuelve (aunque sea DESPUES del commit). Sin esto, el primer
 * cluster del turno se perdia (el commit ya habia consumido su slot vacio) y el
 * comparador de voces se quedaba sin nada contra lo que comparar (inClusters=0).
 */
/**
 * Desenvuelve la instantanea FINAL del turno: acepta RESOLUTOR (funcion -> resultado)
 * o FABRICA (funcion -> resolutor), de forma PEREZOSA. Dueño unico de esa forma: la
 * usan la espera (`primeTurnSpeakerPreflight`) y el cierre (`finalizeTurnIdentityPipeline`).
 */
/** Plazo ACOTADO (config) de la espera del preflight antes del commit. */
function commitPreflightTimeoutMs() {
  const ms = Number(FLU_CONFIG.voiceIdentity?.capture?.identityPipeline?.commitPreflightTimeoutMs)
  // Medido en b218404f: el embedding tarda ~2000 ms y el default de 1500 expiraba
  // SIEMPRE (34/34 commits preReady=false). 3000 deja pasar la resolucion real.
  return Number.isFinite(ms) && ms >= 0 ? ms : 3000
}

function finalSnapshotRunner(runFinalSnapshot, turnId) {
  return () => {
    // FABRICA (`(turnId) => resolutor`): se le pasa el turno para que ate su audio.
    const maybeRun = runFinalSnapshot(turnId)
    return typeof maybeRun === 'function' ? maybeRun() : maybeRun
  }
}

export function finalizeTurnIdentityPipeline(turnId, runFinalSnapshot, { onClusters, onResolved } = {}) {
  const id = Number(turnId)
  stopContinuousIdentityPipeline(id)

  // Se RE-ENCOLA siempre la instantanea FINAL (es la DEFINITIVA: escribe clusters y da
  // la respuesta del turno); si el turno ya tenia evidencia (un tick continuo o una
  // espera previa `primeTurnSpeakerPreflight`), `scheduleTurnSpeakerPreflight` la
  // CONSERVA (`ready`/`snapshots`) y el slot devuelto la lleva. La fila usa esa
  // evidencia acumulada; el snapshot final la consolida despues.
  if (typeof runFinalSnapshot === 'function') {
    // El snapshot FINAL puede llegar como RESOLUTOR (funcion -> resultado) o como
    // FABRICA (funcion -> resolutor). El consumidor vivo pasa la FABRICA
    // (`() => createSpeakerAudioResolver(...)`); al no desenvolverla, el resultado era
    // la propia funcion y NO un snapshot: `Preflight ready=false vec=0` en TODOS los
    // turnos y ningun cluster persistido (`refClusters=0`). Se desenvuelve de forma
    // PEREZOSA para no arrancar el trabajo antes de que la cola lo pida.
    scheduleTurnSpeakerPreflight(id, finalSnapshotRunner(runFinalSnapshot, id), { continuous: false, onClusters, onResolved })
  }

  return consumeTurnSpeakerPreflight(id)
}

/**
 * Espera ACOTADA de la instantanea FINAL de identidad ANTES del commit.
 *
 * Por que: el commit es SINCRONO y la instantanea final (embedding del worker) viaja
 * por la cola asincrona, asi que el commit SIEMPRE perdia la carrera (medido: la fila
 * se escribia `speakerName:'' , evidenciaAcustica:false` aunque el resolver tuviera la
 * etiqueta 60 ms despues). Con esta espera la fila NACE con el hablante del turno.
 * `runFinalSnapshot` es la MISMA fabrica que consume el commit. NO lanza ni bloquea
 * indefinidamente: resuelve con el slot (listo) o tal cual si vence `timeoutMs`.
 * @param {number} turnId
 * @param {Function} runFinalSnapshot
 * @param {{ onClusters?: Function, onResolved?: Function, timeoutMs?: number }} [options]
 * @returns {Promise<{ ready?: boolean, pending?: boolean, speakerName?: string, speakerId?: string, signatureVector?: number[], snapshots?: unknown[] }|null>}
 */
export function primeTurnSpeakerPreflight(turnId, runFinalSnapshot, { onClusters, onResolved, timeoutMs = commitPreflightTimeoutMs() } = {}) {
  const id = Number(turnId)
  if (!Number.isFinite(id) || id <= 0) return Promise.resolve(null)
  const yaResuelto = peekTurnSpeakerPreflight(id)
  if (yaResuelto?.ready) return Promise.resolve(yaResuelto)
  const waitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0
  // El pipeline AVISA al resolver (onResolved); el sondeo de 30 ms era una segunda
  // espera fija sobre el mismo evento. El tope sigue siendo `waitMs` (no bloquea).
  let finalizar = () => {}
  const espera = new Promise((resolve) => {
    let terminado = false
    finalizar = (slot) => {
      if (terminado) return
      terminado = true
      resolve(slot || null)
    }
    if (waitMs > 0) {
      setTimeout(() => finalizar(peekTurnSpeakerPreflight(id)), waitMs)
    }
  })
  if (typeof runFinalSnapshot === 'function') {
    scheduleTurnSpeakerPreflight(id, finalSnapshotRunner(runFinalSnapshot, id), {
      continuous: false,
      onClusters,
      onResolved: (resuelto) => {
        if (typeof onResolved === 'function') onResolved(resuelto)
        finalizar(peekTurnSpeakerPreflight(id))
      },
    })
  }
  // Sin tope o sin trabajo programado no se espera: se resuelve con el slot actual.
  if (waitMs <= 0 || typeof runFinalSnapshot !== 'function') {
    finalizar(peekTurnSpeakerPreflight(id))
  }
  return espera
}

export function resetTurnIdentityPipeline() {
  stopAllContinuousIdentityPipelines()
  resetTurnSpeakerPreflights()
  // El ledger de medidas de la sesion tambien es estado de sesion: sin esto, un reinicio
  // reasignaria filas nuevas con medidas de la conversacion anterior.
  resetSessionSpeakerSnapshots()
}

export { consumeTurnSpeakerPreflight, resetTurnSpeakerPreflights }
