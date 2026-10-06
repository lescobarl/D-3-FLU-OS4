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
} from './turnSpeakerPreflight.js'

const timersByTurn = new Map()

/**
 * @param {{ voiceIdentity?: { capture?: { identityPipeline?: { snapshotIntervalMs?: number } } } }} [config]
 */
export function getIdentitySnapshotIntervalMs(config = FLU_CONFIG) {
  const ms = Number(config.voiceIdentity?.capture?.identityPipeline?.snapshotIntervalMs)
  return Number.isFinite(ms) && ms >= 200 ? ms : 800
}

export function startContinuousIdentityPipeline(turnId, runFactory, { onClusters } = {}) {
  const id = Number(turnId)
  if (!Number.isFinite(id) || id <= 0) return

  stopContinuousIdentityPipeline(id)

  const tick = () => {
    const run = typeof runFactory === 'function' ? runFactory() : runFactory
    if (typeof run !== 'function') return
    scheduleTurnSpeakerPreflight(id, run, { onClusters, continuous: true })
  }

  tick()
  const intervalMs = getIdentitySnapshotIntervalMs()
  const timer = setInterval(tick, intervalMs)
  timersByTurn.set(id, timer)
}

export function stopContinuousIdentityPipeline(turnId) {
  const id = Number(turnId)
  const timer = timersByTurn.get(id)
  if (timer) {
    clearInterval(timer)
    timersByTurn.delete(id)
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
 * @param {Function} [runFinalSnapshot]
 * @param {{ onClusters?: Function }} [options] — `onClusters` recibe los clusters del
 * snapshot FINAL cuando resuelve (aunque sea DESPUES del commit). Sin esto, el primer
 * cluster del turno se perdia (el commit ya habia consumido su slot vacio) y el
 * comparador de voces se quedaba sin nada contra lo que comparar (inClusters=0).
 */
export function finalizeTurnIdentityPipeline(turnId, runFinalSnapshot, { onClusters } = {}) {
  const id = Number(turnId)
  stopContinuousIdentityPipeline(id)

  if (typeof runFinalSnapshot === 'function') {
    scheduleTurnSpeakerPreflight(id, runFinalSnapshot, { continuous: false, onClusters })
  }

  const slot = peekTurnSpeakerPreflight(id)
  if (slot?.ready && !slot.pending) {
    return consumeTurnSpeakerPreflight(id)
  }

  return consumeTurnSpeakerPreflight(id)
}

export function resetTurnIdentityPipeline() {
  stopAllContinuousIdentityPipelines()
  resetTurnSpeakerPreflights()
}

export { consumeTurnSpeakerPreflight, resetTurnSpeakerPreflights }
