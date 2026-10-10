// ============================================================
// vozReinicioMicroGuard - Ciclo de vida del microfono: reanudar NO instancia dos veces
// ni re-arranca una escucha que ya captura (InvalidStateError).
// ------------------------------------------------------------
// MEDIDO (2026-10-10, log del dueno 14:00-14:08): `InvalidStateError: recognition has
// already started`. `startSpeechRecognition` volvia a llamar `.start()` sobre la MISMA
// instancia ya activa (el lock solo miraba "hay otra distinta"), y el error se tragaba
// como si fuera exito.
//
// REGLA: el lock de la escucha lo gobiernan los EVENTOS reales (`onstart` marca captura,
// `onend` la libera) y `startSpeechRecognition` es IDEMPOTENTE mientras captura. Una
// sola instancia activa: arrancar otra detiene la anterior.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindSpeechRecognition,
  getActiveRecognition,
  resetActiveRecognitionForTest,
  startSpeechRecognition,
  stopSpeechRecognition,
} from '../src/voice/lib/speechRecognitionLocal.js'

/** Instancia falsa con el ciclo de vida real (start/stop/abort + onstart/onend). */
type FakeRec = {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  onstart?: ((event?: unknown) => void) | null
  onend?: ((event?: unknown) => void) | null
}

function fakeRecognition({ throwOnSecondStart = false } = {}): FakeRec {
  let arranques = 0
  return {
    start: vi.fn(function () {
      arranques += 1
      if (throwOnSecondStart && arranques > 1) {
        const error = new Error('recognition has already started')
        error.name = 'InvalidStateError'
        throw error
      }
    }),
    stop: vi.fn(),
    abort: vi.fn(),
  }
}

describe('ciclo de vida del microfono', () => {
  beforeEach(() => {
    resetActiveRecognitionForTest()
  })

  it('(util) arrancar dos veces la MISMA escucha no la re-arranca (idempotente)', () => {
    const r = fakeRecognition({ throwOnSecondStart: true })
    bindSpeechRecognition(r as never, { onEnd: vi.fn() })
    expect(startSpeechRecognition(r as never)).toBe(true)
    r.onstart?.({}) // el motor confirma que captura
    expect(startSpeechRecognition(r as never), 'no se re-arranca ni lanza InvalidStateError').toBe(true)
    expect((r as unknown as { start: { mock: { calls: unknown[] } } }).start.mock.calls.length).toBe(1)
  })

  it('(util) tras onend la escucha se puede REANUDAR (el lock no se queda pegado)', () => {
    const r = fakeRecognition()
    bindSpeechRecognition(r as never, { onEnd: vi.fn() })
    startSpeechRecognition(r as never)
    r.onstart?.({})
    r.onend?.({})
    expect(getActiveRecognition(), 'onend libera el lock').toBeNull()
    expect(startSpeechRecognition(r as never), 'reanudar tras el fin si arranca').toBe(true)
    expect((r as unknown as { start: { mock: { calls: unknown[] } } }).start.mock.calls.length).toBe(2)
  })

  it('(util) una sola escucha activa: arrancar otra DETIENE la anterior (no dos instancias)', () => {
    const a = fakeRecognition()
    const b = fakeRecognition()
    bindSpeechRecognition(a as never, {})
    bindSpeechRecognition(b as never, {})
    startSpeechRecognition(a as never)
    a.onstart?.({})
    startSpeechRecognition(b as never)
    expect((a as unknown as { stop: { mock: { calls: unknown[] } } }).stop.mock.calls.length, 'a se detiene').toBe(1)
    expect(getActiveRecognition()).toBe(b)
    stopSpeechRecognition(b as never)
    expect(getActiveRecognition()).toBeNull()
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): sin el lock, la 2ª llamada lanza', () => {
    const r = fakeRecognition({ throwOnSecondStart: true })
    expect(() => {
      r.start()
      r.start()
    }, 'el defecto real: re-arrancar la misma escucha lanza InvalidStateError').toThrow(/already started/)
  })
})
