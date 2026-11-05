// @vitest-environment node
// ============================================================
// voiceLocalFallbackSwap - UN motor activo, nunca cero (degradacion y recuperacion)
// ------------------------------------------------------------
// La recuperacion a Chrome necesita el swap INVERSO al de la degradacion. El
// riesgo no es el camino feliz: es que Chrome no arranque y la escucha quede sin
// motor (o con dos). Este test fija el contrato de `installChromeRecognition`:
//   - previous ya Chrome  -> null, sin tocar nada;
//   - create falla        -> null, el motor activo NO se suelta;
//   - start falla         -> { ok:false, fallback } con un local ARRANCADO;
//   - start ok            -> { ok:true } y el anterior liberado (handlers + abort).
// ============================================================
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  created: 0,
  engines: [] as any[],
}))

vi.mock('../src/voice/lib/asr/whisperRecognitionEngine.js', () => ({
  createWhisperRecognitionEngine: vi.fn(() => {
    const engine = {
      id: `local-${(h.created += 1)}`,
      pushAudio: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      onstart: null,
      onresult: null,
      onerror: null,
      onend: null,
    }
    h.engines.push(engine)
    return engine
  }),
}))

import { installChromeRecognition, installLocalRecognition } from '../src/voice/lib/voiceLocalFallback.js'

function localEngine(id = 'local-activo') {
  return {
    id,
    pushAudio: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onstart: null as null | (() => void),
    onresult: null as null | (() => void),
    onerror: null as null | (() => void),
    onend: null as null | (() => void),
  }
}

function chromeEngine(id = 'chrome-nuevo') {
  return {
    id,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onstart: null as null | (() => void),
    onresult: null as null | (() => void),
    onerror: null as null | (() => void),
    onend: null as null | (() => void),
  }
}

describe('installChromeRecognition — swap inverso con contrato', () => {
  it('previous ya es Chrome: no aplica y no toca nada', () => {
    const previous = chromeEngine()
    const create = vi.fn(() => chromeEngine())
    expect(installChromeRecognition({ previous, create, wire: vi.fn(), start: vi.fn(() => true) })).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(previous.abort).not.toHaveBeenCalled()
  })

  it('si Chrome no se puede crear, el motor local sigue VIVO (no se suelta)', () => {
    const previous = localEngine()
    const out = installChromeRecognition({ previous, create: () => null, wire: vi.fn(), start: () => true })
    expect(out).toBeNull()
    expect(previous.abort).not.toHaveBeenCalled()
    expect(previous.onresult).toBeNull() // nunca se cableo: el local no se toco
  })

  it('si Chrome arranca: anterior liberado, nuevo cableado y arrancado', () => {
    const previous = localEngine()
    const recognition = chromeEngine()
    const wire = vi.fn()
    const start = vi.fn(() => true)
    const out = installChromeRecognition({ previous, create: () => recognition, wire, start })
    expect(out).toEqual({ ok: true, recognition })
    expect(previous.onstart).toBeNull()
    expect(previous.onresult).toBeNull()
    expect(previous.abort).toHaveBeenCalledTimes(1)
    expect(wire).toHaveBeenCalledWith(recognition)
    expect(start).toHaveBeenCalledWith(recognition)
  })

  it('si Chrome NO arranca: se restaura un local ARRANCADO (la escucha no queda muerta)', () => {
    const previous = localEngine()
    const recognition = chromeEngine()
    const wire = vi.fn()
    const out = installChromeRecognition({ previous, create: () => recognition, wire, start: () => false })
    expect(out?.ok).toBe(false)
    const fallback = (out as { ok: false; fallback: any }).fallback
    expect(fallback).toBeTruthy()
    expect(typeof fallback.pushAudio).toBe('function')
    expect(fallback.start).toHaveBeenCalledTimes(1)
    expect(wire).toHaveBeenCalledWith(recognition) // el Chrome fallido se cableo
    expect(recognition.abort).toHaveBeenCalledTimes(1) // ...y se solto
  })
})

describe('installLocalRecognition — degradacion (contrato previo intacto)', () => {
  it('previous Chrome: instala local, lo arranca y libera el Chrome', () => {
    const previous = chromeEngine('chrome-viejo')
    const wire = vi.fn()
    const local = installLocalRecognition({ previous, wire })
    expect(local).toBeTruthy()
    expect(local.start).toHaveBeenCalledTimes(1)
    expect(wire).toHaveBeenCalledWith(local)
    expect(previous.abort).toHaveBeenCalledTimes(1)
  })

  it('previous local: no se crea un segundo motor', () => {
    const previous = localEngine()
    expect(installLocalRecognition({ previous, wire: vi.fn() })).toBeNull()
    expect(previous.abort).not.toHaveBeenCalled()
  })
})
