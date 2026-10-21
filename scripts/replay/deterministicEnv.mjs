/**
 * RELOJ Y AZAR CONGELADOS: modo determinista del replay.
 *
 * Una grabacion se reinyecta con SUS marcas de tiempo: `Date.now`/`performance.now`
 * siguen al reloj virtual, y los `setTimeout`/`setInterval` viven en una cola que solo
 * avanza cuando el runner mueve el reloj. `crypto.randomUUID` y `Math.random` salen de
 * un generador con semilla: dos corridas del mismo NDJSON dan el mismo resultado.
 */

/** PRNG determinista (mulberry32): mismo NDJSON, mismo resultado. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** UUID v4 determinista a partir de un contador (mismo orden, mismos ids). */
function deterministicUuid(counter, random) {
  const bytes = new Array(16).fill(0).map(() => Math.floor(random() * 256))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  void counter
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Instala el entorno determinista.
 * @param {{ startMs?: number, seed?: number }} [options]
 * @returns {{ now: () => number, advanceTo: (ms: number) => void, runDue: () => number, pending: () => number, restore: () => void, uuid: () => string }}
 */
export function installDeterministicEnv({ startMs = 0, seed = 1 } = {}) {
  const original = {
    dateNow: Date.now,
    perfNow: typeof performance !== 'undefined' ? performance.now.bind(performance) : null,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    random: Math.random,
    randomUUID: globalThis.crypto?.randomUUID,
  }

  const random = seededRandom(seed)
  const t0 = Number(startMs) || 0
  let virtualNow = t0
  let seq = 0
  /** @type {{ id: number, dueAt: number, fn: Function, every: number|null }[]} */
  let timers = []

  const schedule = (fn, ms, every) => {
    if (typeof fn !== 'function') return 0
    seq += 1
    const delay = Math.max(0, Number(ms) || 0)
    timers.push({ id: seq, dueAt: virtualNow + delay, fn, every })
    return seq
  }
  const cancel = (id) => {
    timers = timers.filter((timer) => timer.id !== Number(id))
  }

  const runDue = () => {
    let ejecutados = 0
    for (;;) {
      timers.sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)
      const next = timers[0]
      if (!next || next.dueAt > virtualNow) break
      timers.shift()
      ejecutados += 1
      try {
        next.fn()
      } catch (error) {
        // El runner NO se traga el error: lo devuelve en la cola de fallos del replay.
        if (typeof globalThis.__replayTimerError === 'function') globalThis.__replayTimerError(error)
        else throw error
      }
      if (next.every != null) {
        timers.push({ ...next, id: (seq += 1), dueAt: virtualNow + Math.max(1, next.every) })
      }
    }
    return ejecutados
  }

  Date.now = () => virtualNow
  if (typeof performance !== 'undefined' && original.perfNow) {
    performance.now = () => virtualNow - t0
  }
  globalThis.setTimeout = (fn, ms) => schedule(fn, ms, null)
  globalThis.clearTimeout = (id) => cancel(id)
  globalThis.setInterval = (fn, ms) => schedule(fn, ms, Math.max(1, Number(ms) || 1))
  globalThis.clearInterval = (id) => cancel(id)
  Math.random = () => random()
  if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
    globalThis.crypto.randomUUID = () => deterministicUuid(seq, random)
  }

  return {
    now: () => virtualNow,
    advanceTo(ms) {
      const target = Number(ms)
      if (Number.isFinite(target) && target > virtualNow) virtualNow = target
      runDue()
    },
    runDue,
    pending: () => timers.length,
    uuid: () => deterministicUuid(seq, random),
    restore() {
      Date.now = original.dateNow
      if (typeof performance !== 'undefined' && original.perfNow) performance.now = original.perfNow
      globalThis.setTimeout = original.setTimeout
      globalThis.clearTimeout = original.clearTimeout
      globalThis.setInterval = original.setInterval
      globalThis.clearInterval = original.clearInterval
      Math.random = original.random
      if (globalThis.crypto && original.randomUUID) globalThis.crypto.randomUUID = original.randomUUID
    },
  }
}
