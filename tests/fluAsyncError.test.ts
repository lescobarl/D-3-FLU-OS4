// ============================================================
// fluAsyncError.test.ts — Conducta del registro de errores de
// promesas fire-and-forget.
// ------------------------------------------------------------
// Se sustituye SOLO la frontera (console.error) para observar
// QUE se registra y como, sin ruido en la salida de test.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fluAsyncErrorHandler, logFluAsyncError } from '../src/voice/lib/fluAsyncError.js'

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('fluAsyncError — logFluAsyncError', () => {
  it('llama a console.error exactamente una vez', () => {
    logFluAsyncError('scope', new Error('boom'))
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('prefija el mensaje con [Flu][async-error] y el scope', () => {
    logFluAsyncError('carga', new Error('boom'))
    expect(errorSpy).toHaveBeenCalledWith('[Flu][async-error] carga: boom')
  })

  it('usa el message de un Error', () => {
    logFluAsyncError('s', new Error('mensaje real'))
    expect(errorSpy.mock.calls[0][0]).toContain('mensaje real')
  })

  it('convierte a cadena un error que no es Error', () => {
    logFluAsyncError('s', 'caida de red')
    expect(errorSpy).toHaveBeenCalledWith('[Flu][async-error] s: caida de red')
  })

  it('convierte a cadena un objeto plano', () => {
    logFluAsyncError('s', { code: 500 })
    expect(errorSpy).toHaveBeenCalledWith('[Flu][async-error] s: [object Object]')
  })

  it("usa 'unknown' cuando el error es undefined", () => {
    logFluAsyncError('s', undefined)
    expect(errorSpy).toHaveBeenCalledWith('[Flu][async-error] s: unknown')
  })

  it("usa 'unknown' cuando el error es una cadena vacia", () => {
    logFluAsyncError('s', '')
    expect(errorSpy).toHaveBeenCalledWith('[Flu][async-error] s: unknown')
  })

  it("usa 'unknown' cuando el error es 0 (falsy)", () => {
    logFluAsyncError('s', 0)
    expect(errorSpy).toHaveBeenCalledWith('[Flu][async-error] s: unknown')
  })
})

describe('fluAsyncError — fluAsyncErrorHandler', () => {
  it('devuelve una funcion', () => {
    expect(typeof fluAsyncErrorHandler('s')).toBe('function')
  })

  it('la funcion devuelta registra el error con el scope capturado', () => {
    const handler = fluAsyncErrorHandler('arranque')
    handler(new Error('fallo'))
    expect(errorSpy).toHaveBeenCalledWith('[Flu][async-error] arranque: fallo')
  })

  it('la funcion devuelta registra un valor no-Error', () => {
    const handler = fluAsyncErrorHandler('arranque')
    handler('sin detalle')
    expect(errorSpy).toHaveBeenCalledWith('[Flu][async-error] arranque: sin detalle')
  })

  it('dos handlers mantienen scopes independientes', () => {
    const a = fluAsyncErrorHandler('A')
    const b = fluAsyncErrorHandler('B')
    a(new Error('e1'))
    b(new Error('e2'))
    expect(errorSpy.mock.calls[0][0]).toBe('[Flu][async-error] A: e1')
    expect(errorSpy.mock.calls[1][0]).toBe('[Flu][async-error] B: e2')
  })
})
