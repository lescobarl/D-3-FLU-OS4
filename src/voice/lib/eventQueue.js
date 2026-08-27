/**
 * Cola FIFO inmutable para eventos de micrófono/STT.
 * Productor: push() — Consumidor: shift() / peek().
 * Los eventos se congelan al encolar; la cola no se muta in-place.
 */

let globalSeq = 0

export function createEventQueue({ maxSize = 4096 } = {}) {
  const items = []
  let head = 0

  function activeLength() {
    return items.length - head
  }

  function compactIfNeeded() {
    if (head === 0) return
    if (head < 64 && head * 2 < items.length) return
    items.splice(0, head)
    head = 0
  }

  return Object.freeze({
    get length() {
      return activeLength()
    },

    push(event) {
      const frozen = Object.freeze({
        id: ++globalSeq,
        enqueuedAt: Date.now(),
        ...event,
      })
      if (activeLength() >= maxSize) {
        if (head > 0) {
          head += 1
        } else {
          items.shift()
        }
        compactIfNeeded()
      }
      items.push(frozen)
      return frozen
    },

    shift() {
      if (head >= items.length) {
        items.length = 0
        head = 0
        return null
      }
      const value = items[head] || null
      head += 1
      compactIfNeeded()
      if (head >= items.length) {
        items.length = 0
        head = 0
      }
      return value
    },

    peek() {
      return head < items.length ? items[head] || null : null
    },

    snapshot() {
      return Object.freeze(items.slice(head))
    },

    clear() {
      items.length = 0
      head = 0
    },
  })
}

export function resetEventQueueSeq() {
  globalSeq = 0
}
