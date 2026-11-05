// ============================================================
// fluAsyncError.test.ts — registro de promesas fire-and-forget
// ------------------------------------------------------------
// CONTRATO (2026-10-22): una sola salida, el registro CENTRAL (`logCaughtError`). Antes
// escribia solo `console.error` y los fallos no llegaban al relay ni a la auditoria. Se
// sustituye SOLO la frontera (logCaughtError) para observar QUE se registra y con que
// contexto, sin ruido en la salida de test.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'

const logCaughtError = vi.fn()
vi.mock('../src/lib/caughtError', () => ({ logCaughtError: (...args: unknown[]) => logCaughtError(...args) }))

import { fluAsyncErrorHandler, logFluAsyncError } from '../src/voice/lib/fluAsyncError.js'

beforeEach(() => {
  logCaughtError.mockClear()
})

describe('fluAsyncError — logFluAsyncError', () => {
  it('registra UNA vez en el registro central', () => {
    logFluAsyncError('scope', new Error('boom'))
    expect(logCaughtError).toHaveBeenCalledTimes(1)
  })

  it('el contexto lleva el scope para poder buscarlo en el log', () => {
    logFluAsyncError('carga', new Error('boom'))
    expect(String(logCaughtError.mock.calls[0][0])).toContain('carga')
  })

  it('pasa la excepcion ORIGINAL (no su mensaje) al registro', () => {
    const error = new Error('mensaje real')
    logFluAsyncError('s', error)
    expect(logCaughtError.mock.calls[0][1]).toBe(error)
  })

  it('acepta un error que no es Error', () => {
    logFluAsyncError('s', 'caida de red')
    expect(logCaughtError.mock.calls[0][1]).toBe('caida de red')
  })
})

describe('fluAsyncError — fluAsyncErrorHandler', () => {
  it('devuelve un handler que registra con el scope fijado', () => {
    const handler = fluAsyncErrorHandler('cola')
    handler(new Error('x'))
    expect(String(logCaughtError.mock.calls[0][0])).toContain('cola')
    expect(logCaughtError).toHaveBeenCalledTimes(1)
  })

  it('el handler no propaga la excepcion', () => {
    const handler = fluAsyncErrorHandler('cola')
    expect(() => handler(new Error('x'))).not.toThrow()
  })
})
