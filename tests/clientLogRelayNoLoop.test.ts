/**
 * C67 - el relay de traza dev no puede auto-reintentarse en bucle.
 *
 * EVIDENCIA MEDIDA (por que existe este guard): en `flush()`, un fallo de entrega se
 * reportaba con `logCaughtError(...)`, y `logCaughtError` reenvia por el relay
 * (caughtError.ts:42-43 -> relayLog). Es decir: el fallo se reportaba POR EL CANAL QUE
 * ACABA DE FALLAR, asi que cada fallo re-encolaba una entrada nueva y armaba otro intento.
 * Con el endpoint inalcanzable (o en un entorno sin base URL, como un test en Node) el
 * relay reintenta 5 veces por segundo indefinidamente. Ese era el origen real del "ruido"
 * `Failed to parse URL from /__flu_client_log` que se habia atribuido a timing.
 *
 * REGLA VIGILADA: una entrega que falla NO se re-encola. Se instrumenta el `fetch` REAL
 * (se cuenta la llamada y se deja fallar de verdad: en Node la URL relativa ya revienta),
 * de modo que no se falsea el fallo, solo se observa.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { flushLogs, relayLog, setRelayEnabled } from '../src/lib/clientLogRelay'

const ticks = async (n: number) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0))
}

describe('C67 - el relay de traza dev no se auto-reintenta', () => {
  afterEach(() => {
    setRelayEnabled(false)
    flushLogs()
  })

  it('una entrega fallida NO se re-encola (sin bucle de reintento)', async () => {
    const realFetch = globalThis.fetch?.bind(globalThis)
    let intentos = 0
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      intentos += 1
      return realFetch(...args)
    }) as typeof fetch

    try {
      setRelayEnabled(true)
      relayLog('LOG', 'C67', 'entrada de prueba')
      flushLogs()
      await ticks(5)
      expect(intentos, 'el primer intento deberia hacerse una sola vez').toBe(1)

      // Si el fallo se re-encolo, aqui habria una entrada pendiente y se reintentaria.
      flushLogs()
      await ticks(5)
      expect(intentos, 'el fallo se re-encolo: hay bucle de reintento').toBe(1)
    } finally {
      if (realFetch) globalThis.fetch = realFetch
      setRelayEnabled(false)
      flushLogs()
    }
  })
})
