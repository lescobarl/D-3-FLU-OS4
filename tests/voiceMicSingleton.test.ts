/**
 * voiceMicSingleton — Invariante §9.1: UNA sola escucha activa a la vez.
 *
 * Nace ROJO (§10.2): el choke point central `startSpeechRecognition` debe
 * garantizar que nunca haya dos instancias capturando en simultáneo. Si arranca
 * una segunda, la primera se detiene (última gana), y el lock nunca queda pegado.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  abortSpeechRecognition,
  getActiveRecognition,
  resetActiveRecognitionForTest,
  startSpeechRecognition,
  stopSpeechRecognition,
} from '../src/voice/lib/speechRecognitionLocal'

function fakeRecognition(label: string) {
  const calls = { start: 0, stop: 0, abort: 0 }
  return {
    label,
    calls,
    start() {
      calls.start += 1
    },
    stop() {
      calls.stop += 1
    },
    abort() {
      calls.abort += 1
    },
  }
}

describe('voiceMicSingleton — 1 listener activo a la vez (§9.1)', () => {
  beforeEach(() => {
    resetActiveRecognitionForTest()
  })

  it('arrancar una segunda instancia detiene la primera (no hay doble captura)', () => {
    const a = fakeRecognition('a')
    const b = fakeRecognition('b')

    expect(startSpeechRecognition(a as any)).toBe(true)
    expect(getActiveRecognition()).toBe(a)

    expect(startSpeechRecognition(b as any)).toBe(true)
    expect(a.calls.stop).toBe(1)
    expect(getActiveRecognition()).toBe(b)

    stopSpeechRecognition(b as any)
    expect(getActiveRecognition()).toBeNull()
  })

  it('abort libera el lock (no queda pegado)', () => {
    const a = fakeRecognition('a')
    startSpeechRecognition(a as any)
    abortSpeechRecognition(a as any)
    expect(a.calls.abort).toBe(1)
    expect(getActiveRecognition()).toBeNull()
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): sin el choke point habria DOBLE captura', () => {
    // Defecto real §9.1: dos instancias arrancadas por su cuenta capturan a la vez.
    const crudo = [fakeRecognition('x'), fakeRecognition('y')]
    crudo.forEach((r) => r.start())
    expect(crudo.filter((r) => r.calls.start === 1).length, 'sin singleton: 2 capturas').toBe(2)
    // Con el choke point, arrancar la segunda DETIENE la primera (1 sola captura).
    resetActiveRecognitionForTest()
    const a = fakeRecognition('a')
    const b = fakeRecognition('b')
    startSpeechRecognition(a as any)
    startSpeechRecognition(b as any)
    expect(a.calls.stop, 'el singleton detiene la primera').toBe(1)
    expect(getActiveRecognition()).toBe(b)
  })
})
