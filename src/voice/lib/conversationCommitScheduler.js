/**
 * Despacho diferido: libera hilo principal / audio antes de commit pesado.
 */
import { scheduleAfterLogPainted } from './audioTurnLifecycle.js'

function deferHost() {
  if (typeof window !== 'undefined') return window
  if (typeof globalThis !== 'undefined' && globalThis.window) return globalThis.window
  return undefined
}

export function scheduleDeferredTurnCommit(fn) {
  if (typeof fn !== 'function') return
  const host = deferHost()
  if (!host) {
    fn()
    return
  }
  scheduleAfterLogPainted(fn)
}

export function scheduleDeferredLogWrite(fn) {
  scheduleDeferredTurnCommit(fn)
}
