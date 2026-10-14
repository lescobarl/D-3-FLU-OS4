/**
 * workerBridge.js — esqueleto COMUN de los clientes de Web Worker (P8.9).
 *
 * Los tres clientes (fbxWorkerClient, voiceIdWorkerClient, whisperWasmTranscriber)
 * tenian copiada la MISMA orquestacion (AGENTS 7.7.b): creacion perezosa del
 * Worker + despacho del mensaje por `id` + rechazo de TODOS los pendientes en
 * `onerror`. Aqui vive esa orquestacion una sola vez; la POLITICA (que worker,
 * si se puede arrancar, esquema del id, clave del valor, timeout y limpieza al
 * morir) se inyecta, de modo que el detalle por cliente NO se copia.
 *
 * Modulo hoja respecto a los clientes: no importa ninguno de ellos.
 */
import { logCaughtError } from '../../lib/caughtError.ts'

/**
 * Crea el puente de pendientes de un cliente de worker.
 *
 * @param {object} options
 * @param {() => Worker} options.createWorker Fabrica del worker real.
 * @param {() => boolean} [options.canRun] Si devuelve false, `ensure()` no crea worker (el cliente decide el fallback).
 * @param {string} [options.label] Etiqueta de los errores ('fbx' | 'voiceId' | 'whisper').
 * @param {'json'|'result'} [options.valueKey] Clave del valor en el mensaje con ok (default 'result').
 * @param {string} [options.failMessage] Texto del fallo de una peticion (default `${label} worker failed`).
 * @param {(reason: Error, api: { terminate: () => void }) => void} [options.onFatal] Limpieza EXTRA al morir el worker (ademas del rechazo comun).
 * @returns {{ ensure: () => Worker|null, failAll: (reason: Error) => void, dispose: (reason: Error) => void, pending: Map<string, {resolve: Function, reject: Function, timer?: any}> }}
 */
export function createWorkerPendingBridge({
  createWorker,
  canRun,
  label = 'worker',
  valueKey = 'result',
  failMessage,
  onFatal,
} = {}) {
  let worker = null
  const pending = new Map()
  const failureText = failMessage || `${label} worker failed`

  /** Rechaza TODAS las peticiones pendientes (y limpia sus timers). */
  function failAll(reason) {
    for (const entry of pending.values()) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(reason)
    }
    pending.clear()
  }

  /** Termina el worker actual (si lo hay) y lo olvida. */
  function terminate() {
    if (!worker) return
    try {
      worker.terminate()
    } catch (e) {
      logCaughtError('[catch] src/voice/lib/workerPendingBridge.js', e)
    }
    worker = null
  }

  /** Crea el worker de forma perezosa y cablea el despacho por id. */
  function ensure() {
    if (worker) return worker
    if (canRun && !canRun()) return null

    worker = createWorker()

    worker.onmessage = (event) => {
      const data = event.data || {}
      const entry = pending.get(data.id)
      if (!entry) return
      if (entry.timer) clearTimeout(entry.timer)
      pending.delete(data.id)
      if (data.ok) entry.resolve(data[valueKey])
      else entry.reject(new Error(data.error || failureText))
    }

    worker.onerror = (event) => {
      const reason = new Error(event?.message || `${label} worker error`)
      failAll(reason)
      if (onFatal) onFatal(reason, { terminate })
    }

    return worker
  }

  /** Destruye el puente: rechaza lo pendiente y termina el worker. */
  function dispose(reason) {
    failAll(reason)
    terminate()
  }

  return { ensure, failAll, dispose, pending }
}
