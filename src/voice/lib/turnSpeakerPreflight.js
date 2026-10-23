/**
 * Preflight de identidad durante el turno (antes del final).
 * Al commit se consume el resultado; la fila se escribe una sola vez.
 */
import { extractTurnAudioSnapshot } from './continuousAudioBuffer.js'
import { resolveSpeakerFromAudio } from './voiceIdWorkerClient.js'
import { labelToSpeakerId } from './conversationRow.js'
import { logCaughtError } from '../../lib/caughtError'
import { isAutoSpeakerLabel, payloadSeparacionDeTurno } from './speakerCore.js'
import { normalizeSpeakerLabel } from './voiceIdentity.js'
import { capAndFuseSpeakerClusters, sameVoiceFloor } from './speakerClusters.js'
import { voiceProbe } from './voiceProbe'
import { enqueueSpeakerIdentityJob } from './voiceIdentityQueue.js'
import { FLU_CONFIG } from './fluConfig.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { relayLog } from '../../lib/clientLogRelay'
import { SPEAKER_ASSIGN } from './speakerAssignDefaults.js'
import { classifyVoiceAgainstClusters } from './speakerDiarization.js'
import { resolvePendingSpeakerRows } from './conversationTurnRow'

const preflightByTurn = new Map()

/**
 * LEDGER DE SESION de medidas de voz (fase 1 de diarizacion, 2026-10-21).
 *
 * `preflightByTurn` es por TURNO y se consume al cerrar la fila: la medida de un turno
 * desaparecia del proceso en cuanto la fila se escribia, asi que una voz no podia
 * reasignarse cuando su cluster aparecia despues. Aqui sobreviven TODAS las medidas de la
 * sesion (una entrada por snapshot, acotada por config) y son la unica fuente para
 * recalcular las filas INCIERTAS. No sustituye a los clusters: los alimenta.
 */
const sessionLedger = []

function ledgerMax() {
  const configured = Number(FLU_CONFIG.voiceIdentity?.capture?.preflightLedgerMax)
  return Number.isFinite(configured) && configured > 0 ? configured : SPEAKER_ASSIGN.preflightLedgerMax
}

/**
 * Anota una medida en el ledger de la sesion (escritor UNICO del ledger).
 * @param {number} turnId Turno de la medida.
 * @param {object} entry Medida (vector, etiqueta, motivo).
 */
function noteSessionSnapshot(turnId, entry) {
  sessionLedger.push({ turnId, ...entry })
  const max = ledgerMax()
  while (sessionLedger.length > max) sessionLedger.shift()
}

/**
 * Medidas de voz de la SESION (copia): fuente unica del recalculo de filas inciertas.
 * @returns {Array<object>}
 */
export function getSessionSpeakerSnapshots() {
  return sessionLedger.map((entry) => ({ ...entry }))
}

/** Vacia el ledger (reinicio de sesion). */
export function resetSessionSpeakerSnapshots() {
  sessionLedger.length = 0
}

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
 * @param {{ onClusters?: Function, onResolved?: Function, continuous?: boolean }} [options]
 *   `onResolved({ speakerId, speakerName, workingClusters, turnId, evidence, vector, reason })`
 *   avisa del hablante resuelto por ESTE turno. Es lo que permite etiquetar la fila con el
 *   audio del propio turno aunque el embedding llegue DESPUES del commit (medido: el commit
 *   siempre pierde la carrera; sin esto la fila hereda la etiqueta del turno previo).
 *   El `vector` viaja con el aviso: es la VOZ medida de ese turno, la evidencia con la que la
 *   fila se re-clava por timbre y el freeze de "soy X" alcanza toda esa participacion.
 */
export function scheduleTurnSpeakerPreflight(turnId, run, { onClusters, onResolved, continuous = false } = {}) {
  const id = Number(turnId)
  if (!Number.isFinite(id) || id <= 0 || typeof run !== 'function') return

  const notifyResolved = (result) => {
    if (typeof onResolved !== 'function' || !result?.speakerName) return
    // El aviso de identidad SOLO viaja con MEDIDA. Un resultado SIN vector
    // (`no-audio` / `no-vector` / `dropped-stale`) trae el nombre de RESPALDO:
    // entregarlo igual pisaba la ultima resolucion medida y la fila siguiente
    // heredaba el fallback (medido en d4c1c8f3: el final sellado sin audio
    // devolvia el fallback y la mujer quedaba batida entre dos etiquetas).
    const vector = Array.isArray(result.signatureVector)
      ? result.signatureVector
      : Array.isArray(result.vector)
        ? result.vector
        : []
    if (!vector.length) return
    const label = normalizeSpeakerLabel(result.speakerName)
    // Una etiqueta AUTOMATICA solo se avisa si el SNAPSHOT la conoce en SUS PROPIOS
    // clusters (`workingClusters`): una vista PARCIAL inventaba 'Hablante 4'/'Hablante 5'
    // para 2 voces reales (medido 2026-10-06). La puerta mira la vista que produjo la
    // decision, NO el ref del llamante: ese ref puede ir un tick por detras y descartaba
    // la etiqueta NUEVA que el propio snapshot final acababa de crear (su fila se perdia).
    if (isAutoSpeakerLabel(label) && Array.isArray(result.workingClusters)) {
      const known = result.workingClusters.some((c) => normalizeSpeakerLabel(c?.label) === label)
      if (!known) return
    }
    onResolved({
      speakerId: result.speakerId || '',
      speakerName: result.speakerName,
      workingClusters: result.workingClusters || null,
      turnId: id,
      evidence: result.evidence === true,
      vector,
      reason: result?.reason || '',
    })
  }

  // El aviso que COMPLETA la fila lo da SOLO el snapshot FINAL: es el unico que
  // escribe clusters y la respuesta DEFINITIVA del turno. Los ticks continuos
  // resuelven sobre ventanas parciales y dan etiquetas que oscilan; si ellos
  // completaran la fila, la reescribirian varias veces por turno (medido en el
  // log del dueno 2026-10-07: la misma persona salia Hablante 1, luego 2, luego 4
  // y "en el hablante uno puso a la mujer"). Los ticks siguen calentando la cache
  // del embedding, pero NO tocan la fila ni el historial.
  // Voz NUEVA medida (el snapshot CREO un cluster): ni la persistencia ni el aviso
  // se difieren por ser tick continuo. El snapshot FINAL puede no llegar con audio
  // (turno sellado por el commit) y sin esto la sesion se queda con UN cluster y la
  // voz nueva hereda la etiqueta sticky (medido en b218404f: 18 escrituras con
  // labels:["Luis"] y la mujer pegada a "Hablante 1" del primario).
  // El conjunto de ENTRADA debe conocerse (el worker lo devuelve siempre, voz
  // nueva o no): sin el, "mas clusters al salir" no es medible y no se abre la puerta.
  const abrioVozNueva = (result) =>
    Array.isArray(result?.inputClusters) &&
    (result?.workingClusters?.length || 0) > result.inputClusters.length

  const notifyResolvedForTurn = (result) => {
    if (continuous && !abrioVozNueva(result)) return
    notifyResolved(result)
  }

  // Escritor unico de clusters: CONSOLIDA antes de escribir. Con 2 personas la
  // sesion acumulaba 5 clusters y las filas saltaban de etiqueta (medido en el log
  // del dueno 2026-10-07); la fusion es segura (misma firma, nombres propios exentos).
  const emitClusters = (clusters) => {
    if (typeof onClusters !== 'function' || !clusters?.length) return
    onClusters(capAndFuseSpeakerClusters(clusters, { maxAuto: autoSpeakerCap(), floor: clusterMergeFloor() }))
  }

  /**
   * RECALCULO de filas INCIERTAS cuando aparece un cluster NUEVO (fase 1, 2026-10-21).
   *
   * Solo se tocan las filas con etiqueta PENDIENTE (`voiceIdentity.labels.pendingSpeaker`):
   * una fila ya resuelta no se reescribe por una medida posterior. La decision la toma el
   * dueno unico de la asignacion por centroides (`classifyVoiceAgainstClusters`).
   *
   * @param {object} result Resultado del snapshot que abrio el cluster.
   */
  const reconcilePendingRows = (result) => {
    const vector = Array.isArray(result?.signatureVector)
      ? result.signatureVector
      : Array.isArray(result?.vector)
        ? result.vector
        : []
    if (!vector.length || !Array.isArray(result?.workingClusters)) return
    const verdict = classifyVoiceAgainstClusters({
      vector,
      speakerClusters: result.workingClusters,
      thresholds: FLU_CONFIG.voiceIdentity?.capture?.conversationSpeakerThresholds,
    })
    if (verdict.verdict !== 'known') return
    // El LEDGER es la fuente de la medida: resuelve tambien las filas que nacieron SIN firma.
    resolvePendingSpeakerRows(result.workingClusters, { snapshots: getSessionSpeakerSnapshots() })
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
        if (!continuous || abrioVozNueva(result)) {
          emitClusters(result?.workingClusters)
          reconcilePendingRows(result)
        }
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
      // LEDGER: la medida se anota ANTES de cualquier consume del turno.
      noteSessionSnapshot(id, snapshotEntry)
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
        // La voz NUEVA no espera el snapshot final (puede no llegar con audio): su
        // cluster se persiste en cuanto la medida lo crea (ver `abrioVozNueva`).
        if (!defer || abrioVozNueva(result)) {
          emitClusters(result.workingClusters)
          // Un cluster NUEVO es la unica ocasion de reasignar: solo se tocan las filas
          // INCIERTAS (etiqueta pendiente), nunca una fila ya resuelta.
          reconcilePendingRows(result)
        }
      }
      // SONDA POR TURNO (2026-10-18): la linea lleva TODO lo necesario para recrear
      // el escenario sin cruzar lineas por orden: el turno, la REGLA que decidio, la
      // ventana (ms/voz) y el coseno contra los clusters que EXISTIAN antes del turno.
      // `pares` es del dueno unico del coseno (`payloadSeparacionDeTurno`); `reason`
      // sigue siendo la via ('resolved-idle') y `decision` es la regla de identidad.
      const diag = result?.diagnosis || {}
      const pares = payloadSeparacionDeTurno(signatureVector, result?.inputClusters || [], [], 0).pares
      voiceProbe('identity', {
        turn: id,
        reason: result?.reason || '',
        decision: diag.reason || '',
        name: result?.speakerName || '',
        vec: signatureVector.length,
        clusters: result?.workingClusters?.length ?? 0,
        continuous: Boolean(continuous),
        evidence: result?.evidence === true,
        boundary: Boolean(result?.atTurnBoundary),
        voiced: Number(result?.voicedSampleCount) || 0,
        ms: Number(result?.audioMs) || 0,
        lastSim: Number(diag.lastSim) || 0,
        bestSim: Number.isFinite(Number(diag.bestSim)) ? Number(diag.bestSim) : -1,
        bestLabel: diag.bestLabel || '',
        pares,
      })
      notifyResolvedForTurn(result)
    },
    onError: (error) => {
      // El fallo se REGISTRA: sin traza la fila caia a etiqueta generica y nadie sabia por
      // que (auditoria 2026-10-22).
      logCaughtError('turnSpeakerPreflight.onError', error, { turnId: id })
      const slot = preflightByTurn.get(id)
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
    // §9 El audio del turno lo captura UN dueño antes del vaciado del buffer. El
    // contrato de `getCapturedAudio` distingue TRES casos: `null`/`undefined` = aun no
    // capturado (turno ACTIVO: se extrae la ventana del turno del buffer vivo); un
    // Float32Array VACIO = el turno ya esta sellado y no hay audio SUYO (nunca se cae al
    // buffer vivo, que pertenece a otro turno: medido 2026-10-18, el preflight tardio
    // media 18 s de audio ajeno y creaba "Hablante 2" con 0.091).
    const captured = getCapturedAudio?.()
    const buffer = getAudioBuffer?.()
    const hasCaptured = captured instanceof Float32Array || Array.isArray(captured)
    const audio = hasCaptured
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
        atTurnBoundary,
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
      atTurnBoundary,
    }))
  }
}
