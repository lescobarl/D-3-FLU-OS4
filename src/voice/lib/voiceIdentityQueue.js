/**
 * Cola de identidad en tiempo real: 1 in-flight, pending reemplazable (drop stale).
 */
import { scheduleIdle } from './idleSchedule.js'

let inFlight = false
let pending = null
let droppedCount = 0

function dropPendingJob(reason = 'dropped-stale') {
  if (!pending) return
  const job = pending
  pending = null
  droppedCount += 1
  if (typeof job.onDrop === 'function') job.onDrop(reason)
  if (typeof job.onError === 'function') job.onError(new Error(reason))
}

function drainQueue() {
  if (inFlight || !pending) return
  const job = pending
  pending = null
  inFlight = true

  const dispatch = () => {
    Promise.resolve()
      .then(() => job.run())
      .then(
        (result) => {
          if (typeof job.onSuccess === 'function') job.onSuccess(result)
        },
        (error) => {
          if (typeof job.onError === 'function') job.onError(error)
          else if (typeof job.onSuccess === 'function' && job.fallback) job.onSuccess(job.fallback)
        },
      )
      .finally(() => {
        inFlight = false
        if (pending) scheduleIdle(drainQueue, 0)
      })
  }

  // El trabajo del TURNO (`priority`: el snapshot FINAL, el unico que escribe clusters y
  // resuelve el hablante) NO espera a "idle": su retraso entra DIRECTO en el plazo del
  // commit (`commitPreflightTimeoutMs`) y el embedding corre en un WORKER, asi que no
  // compite con el hilo principal. Medido (2026-10-13): con `scheduleIdle` (tope 2500 ms)
  // y un commit que espera 1500 ms, en una pestana ocupada la medida NO llegaba nunca
  // (`preReady:false` en 60/60 turnos). Los ticks oportunistas siguen en idle.
  if (job.priority) dispatch()
  else scheduleIdle(dispatch)
}

/**
 * Encola identidad. Si hay pending sin iniciar → DROP. Si inFlight → solo la más reciente espera.
 * @param {{ rowId?: string, run?: Function, onSuccess?: Function, onError?: Function, onDrop?: Function, fallback?: unknown, priority?: boolean }} [job]
 */
export function enqueueSpeakerIdentityJob({
  rowId = '',
  run,
  onSuccess,
  onError,
  onDrop,
  fallback = null,
  priority = false,
} = {}) {
  if (typeof run !== 'function') return

  // Un job con `priority` (el snapshot FINAL del turno) NO se puede superseder: es
  // el unico que escribe clusters, y los ticks del turno siguiente lo descartaban
  // antes de correr -> `refClusters` quedaba en 0 (defecto medido, 2026-10-06).
  if (pending?.priority) return
  if (pending && !inFlight) {
    dropPendingJob('superseded-before-start')
  } else if (pending && inFlight) {
    dropPendingJob('superseded-while-queued')
  }

  pending = {
    rowId,
    run,
    onSuccess,
    onError,
    onDrop,
    fallback,
    priority: Boolean(priority),
    enqueuedAt: Date.now(),
  }
  drainQueue()
}

export function peekPendingIdentityRowId() {
  return pending?.rowId || ''
}

export function getSpeakerIdentityQueueStats() {
  return { inFlight, hasPending: Boolean(pending), droppedCount }
}

export function resetSpeakerIdentityQueue() {
  dropPendingJob('queue-reset')
  inFlight = false
}
