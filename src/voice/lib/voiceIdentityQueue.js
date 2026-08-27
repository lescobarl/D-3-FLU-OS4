/**
 * Cola de identidad en tiempo real: 1 in-flight, pending reemplazable (drop stale).
 */
let inFlight = false
let pending = null
let droppedCount = 0

function scheduleIdle(fn, timeoutMs = 2500) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: timeoutMs })
    return
  }
  setTimeout(fn, 0)
}

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

  scheduleIdle(() => {
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
  })
}

/**
 * Encola identidad. Si hay pending sin iniciar → DROP. Si inFlight → solo la más reciente espera.
 */
export function enqueueSpeakerIdentityJob({
  rowId = '',
  run,
  onSuccess,
  onError,
  onDrop,
  fallback = null,
} = {}) {
  if (typeof run !== 'function') return

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
