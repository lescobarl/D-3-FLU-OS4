/**
 * C67/C68 - el relay de traza dev: ni se auto-reintenta, ni entrega cuando no puede.
 *
 * C67 (una entrega que falla NO se re-encola): en `flush()`, un fallo de entrega se
 * reportaba con `logCaughtError`, y `logCaughtError` reenvia por el relay
 * (caughtError.ts:42-43). El fallo se reportaba POR EL CANAL QUE ACABABA DE FALLAR, asi
 * que cada fallo re-encolaba una entrada y armaba otro intento. Medido: intentos=2 con
 * una sola entrada, en vez de 1.
 *
 * C68 (sin origen no se entrega, y sin servidor no se grita): el relay entrega a la ruta
 * RELATIVA `/__flu_client_log`, que se resuelve contra el origen del documento.
 *   - Sin documento (Node, SSR) no hay origen que resolver: el intento no entregaba nada
 *     y dejaba "Failed to parse URL". Se mide aqui que hay CERO intentos.
 *   - Con documento pero sin servidor dev (el caso de los tests con jsdom, que SI tienen
 *     `document`) el intento falla; reportarlo metia ese TypeError en la consola de la
 *     suite en cada tanda. Un fallo de entrega del relay se puede declinar en silencio:
 *     es trazabilidad best-effort y su propio canal de re-reporte ES el relay.
 *
 * EVIDENCIA MEDIDA (por que se escribe asi): los dos casos se comprueban instrumentando
 * el `fetch` REAL -se cuenta la llamada y se deja fallar de verdad, sin sustituir su
 * comportamiento-, de modo que no se falsea el fallo, solo se observa. El caso C67
 * simula el ENTORNO del navegador (un documento con origen), que es donde el relay tiene
 * sentido; el fallo de entrega sigue siendo real (Node no resuelve la ruta relativa).
 * `console.error` se ESPIA para exigir que el fallo NO produzca ruido.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushLogs, relayLog, setRelayEnabled } from '../src/lib/clientLogRelay'

const ticks = async (n: number) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0))
}

/** Cuenta las llamadas al fetch REAL, sin alterar lo que hace. */
function contarEntregas() {
  const realFetch = globalThis.fetch?.bind(globalThis)
  let intentos = 0
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    intentos += 1
    return realFetch(...args)
  }) as typeof fetch
  return {
    intentos: () => intentos,
    restore: () => {
      if (realFetch) globalThis.fetch = realFetch
    },
  }
}

describe('C67/C68 - relay de traza dev: no se auto-reintenta ni entrega sin poder', () => {
  afterEach(() => {
    setRelayEnabled(false)
    flushLogs()
    delete (globalThis as { document?: unknown }).document
    vi.restoreAllMocks()
  })

  it('C68: sin documento no hay origen que resolver -> CERO intentos y CERO ruido', async () => {
    expect(typeof document, 'este caso exige un entorno sin documento').toBe('undefined')
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = contarEntregas()
    try {
      setRelayEnabled(true)
      relayLog('LOG', 'C68', 'entrada de prueba')
      flushLogs()
      await ticks(5)
      expect(f.intentos(), 'sin navegador no debe intentarse la entrega').toBe(0)
      expect(errores, 'sin origen no hay nada que reportar').not.toHaveBeenCalled()
    } finally {
      f.restore()
    }
  })

  it('C67: con documento y entrega fallida -> 1 intento, sin re-encolar y sin ruido', async () => {
    // Entorno tipo navegador: hay documento con origen, pero no hay servidor dev detras
    // (es exactamente la situacion de los tests con jsdom). El fallo es real.
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(globalThis as { document?: unknown }).document = { baseURI: 'http://127.0.0.1:9/' }
    const f = contarEntregas()
    try {
      setRelayEnabled(true)
      relayLog('LOG', 'C67', 'entrada de prueba')
      flushLogs()
      await ticks(5)
      expect(f.intentos(), 'el primer intento deberia hacerse una sola vez').toBe(1)

      // Si el fallo se re-encolo, aqui habria una entrada pendiente y se reintentaria.
      flushLogs()
      await ticks(5)
      expect(f.intentos(), 'el fallo se re-encolo: hay bucle de reintento').toBe(1)
      expect(errores, 'el fallo de entrega no debe inundar la consola').not.toHaveBeenCalled()
    } finally {
      f.restore()
    }
  })
})
