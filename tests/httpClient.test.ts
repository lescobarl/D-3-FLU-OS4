// ============================================================
// httpClient — fetchTextEngineResilient
// Capa de transporte resiliente para las llamadas de red de voz:
//  - Reintento (1) ante fallos de transporte puros (TypeError: Failed
//    to fetch — sockets keep-alive muertos tras reiniciar el dev server).
//  - Normalización del fallo residual a { code: 'gemini_network' }.
//  - Timeout real (gemini_timeout/408) sin reintento.
//  - Errores HTTP 4xx/5xx NO se reintentan ni se normalizan.
// ============================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchTextEngineResilient,
  buildNetworkError,
} from '../src/core/ai/httpClient'

describe('httpClient — fetchTextEngineResilient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reintenta 1 vez ante TypeError (Failed to fetch) y resuelve si el 2º intento funciona', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchTextEngineResilient('http://x/api', {
      method: 'POST',
    })
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('si el fallo de transporte persiste, normaliza a gemini_network (no TypeError crudo)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const error = await fetchTextEngineResilient(
      'http://x/api',
      {},
      { retries: 1 },
    ).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('gemini_network')
    expect(error.status).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('timeout → gemini_timeout (NO se reintenta: el servidor está vivo pero lento)', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const error = await fetchTextEngineResilient(
      'http://x/api',
      {},
      { timeoutMs: 10, retries: 1 },
    ).catch((e) => e)
    expect(error.code).toBe('gemini_timeout')
    expect(error.status).toBe(408)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('errores HTTP (respuesta 4xx/5xx) NO se reintentan ni se normalizan a gemini_network', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 500, statusText: 'Server Error' }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchTextEngineResilient('http://x/api')
    expect(response.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('buildNetworkError expone code/status/detail estructurados', () => {
    const error = buildNetworkError('http://x/api', new TypeError('Failed to fetch'))
    expect(error.code).toBe('gemini_network')
    expect(error.status).toBe(0)
    expect(error.message).toBe('Failed to fetch')
    expect(error.detail).toContain('http://x/api')
  })
})
