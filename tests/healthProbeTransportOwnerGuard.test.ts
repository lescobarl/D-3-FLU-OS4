// @vitest-environment jsdom
// ============================================================
// healthProbeTransportOwnerGuard - P9.62: la sonda de salud va por el DUENO del transporte.
// ------------------------------------------------------------
// HALLAZGO MEDIDO (log del dueno en reposo, 2026-10-10):
//   `[flu-client 14:44:53.478] ERROR catch src/core/autonomy/healthMonitor.ts ::
//    {"detail":"Error: Text API timeout (no response within 3000ms)"}`
// y NO habia linea posterior. Al medir se acoto (no era un bug evidente): el timeout de
// 3000 ms SI es politica de config (`TIMEOUT_POLICY_MS.healthProbeAbort`) y el error SI se
// registra por `logCaughtError` (no viola 2.6). Lo que estaba mal era la RUTA: las dos
// sondas llamaban al TRANSPORTE CRUDO (`fetchTextEngine`), es decir FUERA de la politica de
// reintento que su dueno (`fetchTextEngineResilient`) ya implementa -> dos rutas para el
// mismo transporte.
//
// REGLA: el transporte del cliente tiene UN dueno. La sonda va por el, con su politica:
//   - fallo de TRANSPORTE (TypeError) -> 1 reintento (socket keep-alive muerto);
//   - TIMEOUT -> NO se reintenta (es el VEREDICTO de la sonda; reintentarlo doblaria su coste).
// Y el sondeo SE REPROGRAMA: el intervalo no muere cuando un componente falla.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchTextEngineResilient } from '../src/core/ai/httpClient'
import { HealthMonitor } from '../src/core/autonomy/healthMonitor'

const RUTA = join(process.cwd(), 'src/core/autonomy/healthMonitor.ts')

/** Implementaciones del transporte CRUDO (lo que este guard prohibe en el monitor). */
function usosDelTransporteCrudo(src: string): number {
  return (src.match(/fetchTextEngine\(/g) || []).length
}
/** Usos del DUENO del transporte. */
function usosDelTransporteDueno(src: string): number {
  return (src.match(/fetchTextEngineResilient\(/g) || []).length
}

describe('P9.62 - la sonda de salud usa el DUENO del transporte', () => {
  it('el monitor NO llama al transporte crudo: va por su dueno', () => {
    const src = readFileSync(RUTA, 'utf8')
    expect(usosDelTransporteCrudo(src), 'llamadas al transporte CRUDO').toBe(0)
    expect(usosDelTransporteDueno(src), 'llamadas al dueno del transporte').toBeGreaterThanOrEqual(2)
  })

  it('control NEGATIVO (el detector no es decorativo): reconoce la llamada cruda si aparece', () => {
    const infractor = "await fetchTextEngine(url, {}, 3000)"
    const correcto = "await fetchTextEngineResilient(url, {}, { timeoutMs: 3000 })"
    expect(usosDelTransporteCrudo(infractor), 'el detector VE el defecto').toBe(1)
    expect(usosDelTransporteDueno(infractor)).toBe(0)
    expect(usosDelTransporteCrudo(correcto)).toBe(0)
    expect(usosDelTransporteDueno(correcto)).toBe(1)
  })
})

describe('P9.62 - politica del dueno: reintenta el TRANSPORTE, no el TIMEOUT', () => {
  const fetchOriginal = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = fetchOriginal
    vi.restoreAllMocks()
  })

  it('fallo de transporte: 1 reintento y la peticion se resuelve', async () => {
    let llamadas = 0
    globalThis.fetch = vi.fn(async () => {
      llamadas += 1
      if (llamadas === 1) throw new TypeError('Failed to fetch')
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const res = await fetchTextEngineResilient('https://ejemplo.test/x', {}, { timeoutMs: 200, retryDelayMs: 1 })
    expect(res.status).toBe(200)
    expect(llamadas, 'reintenta UNA vez el fallo de transporte').toBe(2)
  })

  it('timeout: NO se reintenta (es el veredicto de la sonda)', async () => {
    let llamadas = 0
    // El deadline ABORTA la peticion: el stub honra la senal (como fetch real).
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      llamadas += 1
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }) as unknown as typeof fetch

    await expect(
      fetchTextEngineResilient('https://ejemplo.test/x', {}, { timeoutMs: 30, retryDelayMs: 1 }),
    ).rejects.toMatchObject({ code: 'gemini_timeout' })
    expect(llamadas, 'un timeout no se reintenta').toBe(1)
  })
})

describe('P9.62 - el sondeo SE REPROGRAMA aunque un componente falle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tras un fallo el intervalo sigue sondeando', async () => {
    let llamadas = 0
    const monitor = HealthMonitor.create(
      { monitoringInterval: 100, monitoredComponents: ['ia'], verboseLogging: false },
      {
        componentCheckers: {
          ia: async () => {
            llamadas += 1
            throw new Error('Text API timeout (no response within 3000ms)')
          },
        },
      },
    )
    await monitor.start()
    expect(llamadas, 'sondeo inicial').toBeGreaterThanOrEqual(1)
    await vi.advanceTimersByTimeAsync(350)
    expect(llamadas, 'el intervalo NO muere cuando el componente falla').toBeGreaterThanOrEqual(3)
    monitor.stop()
  })
})
