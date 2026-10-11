/**
 * Preflight de identidad durante el turno (antes del final).
 * Al commit se consume el resultado; la fila se escribe una sola vez.
 */
import { extractTurnAudioSnapshot } from './continuousAudioBuffer.js'
import { resolveSpeakerFromAudio } from './voiceIdWorkerClient.js'
import { labelToSpeakerId } from './conversationRow.js'
import { isAutoSpeakerLabel } from './speakerCore.js'
import { normalizeSpeakerLabel } from './voiceIdentity.js'
import { capAndFuseSpeakerClusters, sameVoiceFloor } from './speakerClusters.js'
import { voiceProbe } from './voiceProbe'
import { enqueueSpeakerIdentityJob } from './voiceIdentityQueue.js'
import { FLU_CONFIG } from './fluConfig.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { relayLog } from '../../lib/clientLogRelay'

const preflightByTurn = new Map()

/** Umbral de fusion de clusters: el de REUTILIZACION ("misma voz"). Medido: misma
 *  voz 0.69-0.74, distinta 0.58 -> el umbral (0.66) cae entre las dos bandas; NO se
 *  usa el de "misma persona" (0.85) porque los clusters de una misma voz entre turnos
 *  quedan ~0.70 y nunca se fusionarian. Delegado en el DUENO UNICO `sameVoiceFloor`
 *  (antes esta funcion era una TERCERA copia del mismo criterio). */
/** TOPE de etiquetas automaticas de la sesion (config; 0 = sin tope). */
function autoSpeakerCap() {
  return Number(FLU_CONFIG.voiceIdentity?.capture?.conversationMaxAutoSpeakers) || 0
}
function clusterMergeFloor() {
  return sameVoiceFloor()
}

/**
 * DUENO UNICO de "la identidad de este turno fue MEDIDA": el preflight resolvio
 * el hablante por una ventana de audio del turno Y reporta coincidencia
 * (`evidence`). `ready` sin `evidence` es "hay clusters", NO coincidencia.
 * Lo consumen el commit (que decide la escritura) y el resolver sincrono del hook.
 *
 * @param {object|null|undefined} slot resultado de `peekTurnSpeakerPreflight`
 * @returns {boolean}
 */
export function preflightEvidenceMeasured(slot) {
  return Boolean(slot?.ready && slot?.evidence === true)
}

/**
 * @param {number} turnId
 * @param {Function} run
 * @param {{ onClusters?: Function, onResolved?: Function, continuous?: boolean, getSpeakerClusters?: Function }} [options]
 *   `onResolved({ speakerId, speakerName, workingClusters })` avisa del hablante
 *   resuelto por ESTE turno. Es lo que permite etiquetar la fila con el audio del
 *   propio turno aunque el embedding llegue DESPUES del commit (medido: el commit
 *   siempre pierde la carrera; sin esto la fila hereda la etiqueta del turno previo).
 */
export function scheduleTurnSpeakerPreflight(turnId, run, { onClusters, onResolved, continuous = false, getSpeakerClusters } = {}) {
  const id = Number(turnId)
  if (!Number.isFinite(id) || id <= 0 || typeof run !== 'function') return

  // Una etiqueta AUTOMATICA ('Hablante N') que los clusters PERSISTIDOS no conocen la
  // inventa la vista PARCIAL de un tick: no rotula la fila. Medido (2026-10-06) con
  // `Clusters write=3`: las filas salian 'Hablante 4'/'Hablante 5' (voces inventadas)
  // para 2 voces reales. Sin `getSpeakerClusters` la puerta no aplica.
  const notifyResolved = (result) => {
    if (typeof onResolved !== 'function' || !result?.speakerName) return
    const label = normalizeSpeakerLabel(result.speakerName)
    if (typeof getSpeakerClusters === 'function' && isAutoSpeakerLabel(label)) {
      const known = (getSpeakerClusters() || []).some((c) => normalizeSpeakerLabel(c?.label) === label)
      if (!known) return
    }
    onResolved({ speakerId: result.speakerId || '', speakerName: result.speakerName, workingClusters: result.workingClusters || null, turnId: id, evidence: result.evidence === true })
  }

  // El aviso que COMPLETA la fila lo da SOLO el snapshot FINAL: es el unico que
  // escribe clusters y la respuesta DEFINITIVA del turno. Los ticks continuos
  // resuelven sobre ventanas parciales y dan etiquetas que oscilan; si ellos
  // completaran la fila, la reescribirian varias veces por turno (medido en el
  // log del dueno 2026-10-07: la misma persona salia Hablante 1, luego 2, luego 4
  // y "en el hablante uno puso a la mujer"). Los ticks siguen calentando la cache
  // del embedding, pero NO tocan la fila ni el historial.
  const notifyResolvedForTurn = (result) => {
    if (continuous) return
    notifyResolved(result)
  }

  // Escritor unico de clusters: CONSOLIDA antes de escribir. Con 2 personas la
  // sesion acumulaba 5 clusters y las filas saltaban de etiqueta (medido en el log
  // del dueno 2026-10-07); la fusion es segura (misma firma, nombres propios exentos).
  const emitClusters = (clusters) => {
    if (typeof onClusters !== 'function' || !clusters?.length) return
    onClusters(capAndFuseSpeakerClusters(clusters, { maxAuto: autoSpeakerCap(), floor: clusterMergeFloor() }))
  }

  const prior = preflightByTurn.get(id)
  preflightByTurn.set(id, {
    ...(prior?.ready
      ? {
          ready: true,
          speakerId: prior.speakerId,
          speakerName: prior.speakerName,
          signatureVector: prior.signatureVector,
          workingClusters: prior.workingClusters,
          reason: prior.reason,
          evidence: prior.evidence === true,
        }
      : { ready: false }),
    pending: true,
    turnId: id,
    continuous: Boolean(continuous),
    snapshotAt: Date.now(),
    snapshots: Array.isArray(prior?.snapshots) ? [...prior.snapshots] : [],
  })

  enqueueSpeakerIdentityJob({
    rowId: `preflight-${id}-${continuous ? Date.now() : 0}`,
    run,
    // El snapshot FINAL es prioritario: es el que escribe clusters (los ticks
    // continuos no) y los ticks del turno siguiente lo descartaban sin correr.
    priority: !continuous,
    onSuccess: (result) => {
      const slot = preflightByTurn.get(id)
      if (!slot) {
        // El commit ya CONSUMIO el slot (lo borra al cerrar el turno). El snapshot
        // FINAL resuelve despues: sus clusters se persisten igual, o el primer
        // cluster del turno se pierde para siempre y ninguna voz se puede separar
        // (defecto medido: `Match inClusters=0` en todos los turnos).
        if (!continuous) emitClusters(result?.workingClusters)
        notifyResolvedForTurn(result)
        return
      }
      const weakResult =
        result?.reason === 'no-audio' ||
        result?.reason === 'no-vector' ||
        !(Array.isArray(result?.signatureVector) ? result.signatureVector : result?.vector)?.length
      if (typeof window !== 'undefined') {
        relayLog(
          'LOG',
          'Preflight',
          `turn=${id} ready=${!weakResult} reason=${result?.reason || ''} name="${result?.speakerName || ''}" clusters=${result?.workingClusters?.length ?? 0} vec=${(Array.isArray(result?.signatureVector) ? result.signatureVector : result?.vector)?.length ?? 0}`,
        )
      }
      if (weakResult && slot.ready) {
        preflightByTurn.set(id, { ...slot, pending: false })
        return
      }
      const signatureVector = Array.isArray(result?.signatureVector)
        ? result.signatureVector
        : Array.isArray(result?.vector)
          ? result.vector
          : []
      const snapshotEntry = {
        speakerId: result?.speakerId || '',
        speakerName: result?.speakerName || '',
        signatureVector,
        audioStartSample: Number.isFinite(result?.audioStartSample) ? result.audioStartSample : 0,
        audioStartedAtMs: Number.isFinite(result?.audioStartedAtMs) ? result.audioStartedAtMs : 0,
        snapshotAt: Date.now(),
        reason: result?.reason || '',
        evidence: result?.evidence === true,
      }
      const snapshots = [...(slot.snapshots || []), snapshotEntry]
      preflightByTurn.set(id, {
        ready: true,
        pending: false,
        turnId: id,
        speakerId: result?.speakerId || '',
        speakerName: result?.speakerName || '',
        signatureVector,
        audioStartSample: snapshotEntry.audioStartSample,
        audioStartedAtMs: snapshotEntry.audioStartedAtMs,
        workingClusters: result?.workingClusters || null,
        reason: result?.reason || '',
        evidence: result?.evidence === true,
        snapshots,
        continuous: slot.continuous,
      })
      if (typeof onClusters === 'function' && result?.workingClusters?.length) {
        const defer =
          continuous &&
          FLU_CONFIG.voiceIdentity?.capture?.roomCapture?.deferClusterWritesUntilCommit !== false
        if (!defer) emitClusters(result.workingClusters)
      }
      voiceProbe('identity', { turn: id, reason: result?.reason || '', name: result?.speakerName || '', vec: (Array.isArray(result?.signatureVector) ? result.signatureVector : result?.vector)?.length ?? 0, clusters: result?.workingClusters?.length ?? 0, continuous: Boolean(continuous) })
      notifyResolvedForTurn(result)
    },
    onError: () => {      const slot = preflightByTurn.get(id)
      if (slot) preflightByTurn.set(id, { ...slot, ready: false, pending: false })
    },
  })
}

export function peekTurnSpeakerPreflight(turnId) {
  const id = Number(turnId)
  return preflightByTurn.get(id) || null
}

export function consumeTurnSpeakerPreflight(turnId) {
  const id = Number(turnId)
  const slot = preflightByTurn.get(id)
  if (!slot) return null
  preflightByTurn.delete(id)
  return slot
}

export function clearTurnSpeakerPreflight(turnId) {
  preflightByTurn.delete(Number(turnId))
}

export function resetTurnSpeakerPreflights() {
  preflightByTurn.clear()
}

/** Job de audio → hablante (preflight o refresh de clusters).
 * @param {{ getAudioBuffer?: Function, getSampleRate?: Function, getTurnStartSample?: Function, getSpeakerClusters?: Function, getLastSpeaker?: Function, getLastSignature?: Function, getFallbackSpeaker?: Function, getUtteranceText?: Function, atTurnBoundary?: boolean, allowNewCluster?: boolean, getPreferSpeaker?: Function, getSessionPrimary?: Function, getReservedLabels?: Function, getAudioStartSample?: Function, getAudioStartedAtMs?: Function, getCapturedAudio?: Function }} [options]
 */
export function createTurnSpeakerAudioResolver({
  getAudioBuffer,
  getSampleRate,
  getTurnStartSample,
  getSpeakerClusters,
  getLastSpeaker,
  getLastSignature,
  getFallbackSpeaker,
  getUtteranceText,
  atTurnBoundary = false,
  allowNewCluster = false,
  getPreferSpeaker,
  getSessionPrimary,
  getReservedLabels,
  getAudioStartSample,
  getAudioStartedAtMs,
  getCapturedAudio,
} = {}) {
  return () => {
    const sampleRate = getSampleRate?.() || DEFAULT_SAMPLE_RATE
    const audioStartSample = getAudioStartSample?.() ?? getTurnStartSample?.() ?? 0
    const audioStartedAtMs = getAudioStartedAtMs?.() || 0
    // §9 El audio del turno lo captura UN dueño antes del vaciado del buffer: si
    // ya existe, se consume ESE snapshot (el buffer vivo puede estar a 0).
    const captured = getCapturedAudio?.()
    const buffer = getAudioBuffer?.()
    const audio =
      captured?.length
        ? captured
        : buffer
          ? extractTurnAudioSnapshot(buffer, sampleRate, {
              turnAudioStartSample: getTurnStartSample?.() || 0,
              atTurnBoundary,
            })
          : new Float32Array(0)
    const fallback = getFallbackSpeaker?.() || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
    if (!audio.length) {
      return Promise.resolve({
        speakerId: labelToSpeakerId(fallback),
        speakerName: fallback,
        workingClusters: getSpeakerClusters?.() || [],
        signatureVector: [],
        audioStartSample,
        audioStartedAtMs,
        reason: 'no-audio',
      })
    }
    return resolveSpeakerFromAudio(audio, sampleRate, {
      speakerClusters: getSpeakerClusters?.() || [],
      lastSpeaker: getLastSpeaker?.() || '',
      lastSignature: getLastSignature?.() || null,
      fallbackSpeaker: fallback,
      utteranceText: getUtteranceText?.() || '',
      atTurnBoundary,
      allowNewCluster,
      preferSpeaker: getPreferSpeaker?.() || '',
      sessionPrimary: getSessionPrimary?.() || '',
      reservedLabels: getReservedLabels?.() || [],
    }).then((result) => ({
      ...result,
      audioStartSample,
      audioStartedAtMs,
    }))
  }
}
