// ============================================================
// httpJson - CONDUCTA de la escritura JSON segura de los proxies.
//
// `sendJson` es el dueno unico del patron "responder JSON sin tumbar el
// dev server": si el socket ya se cerro, writeHead/end lanzan y ese throw
// se convertiria en unhandled rejection (se llama en un catch). Se mide
// SOLO la frontera: `ServerResponse` construida a mano y `logCaughtError`
// sustituido por un espia (la frontera de registro).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ServerResponse } from 'node:http'

vi.mock('../src/lib/caughtError', () => ({ logCaughtError: vi.fn() }))

import { logCaughtError } from '../src/lib/caughtError'
import { sendJson } from '../src/server/httpJson'

const mockedLog = vi.mocked(logCaughtError)

interface FakeRes {
  writableEnded: boolean
  destroyed: boolean
  writeHead: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

function makeRes(over: Partial<FakeRes> = {}): FakeRes {
  return {
    writableEnded: false,
    destroyed: false,
    writeHead: vi.fn(),
    end: vi.fn(),
    ...over,
  }
}

const asRes = (res: FakeRes) => res as unknown as ServerResponse

beforeEach(() => {
  mockedLog.mockClear()
})

describe('sendJson - camino feliz', () => {
  it('escribe el status y el cuerpo serializado como JSON', () => {
    const res = makeRes()

    sendJson(asRes(res), 200, { ok: true, n: 3 }, 'mi-proxy')

    expect(res.writeHead).toHaveBeenCalledTimes(1)
    expect(res.writeHead.mock.calls[0][0]).toBe(200)
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true, n: 3 }))
  })

  it('declara Content-Type JSON UTF-8 por defecto', () => {
    const res = makeRes()

    sendJson(asRes(res), 200, {}, 'mi-proxy')

    expect(res.writeHead.mock.calls[0][1]).toEqual({ 'Content-Type': 'application/json; charset=utf-8' })
  })

  it('respeta un Content-Type personalizado', () => {
    const res = makeRes()

    sendJson(asRes(res), 502, {}, 'mi-proxy', 'text/plain')

    expect(res.writeHead.mock.calls[0][1]).toEqual({ 'Content-Type': 'text/plain' })
  })

  it('serializa null y valores primitivos sin envolverlos', () => {
    const nulo = makeRes()
    sendJson(asRes(nulo), 204, null, 'mi-proxy')
    expect(nulo.end).toHaveBeenCalledWith('null')

    const texto = makeRes()
    sendJson(asRes(texto), 200, 'hola', 'mi-proxy')
    expect(texto.end).toHaveBeenCalledWith('"hola"')
  })

  it('no registra ningun error si la escritura va bien', () => {
    sendJson(asRes(makeRes()), 200, { ok: true }, 'mi-proxy')
    expect(mockedLog).not.toHaveBeenCalled()
  })
})

describe('sendJson - sockets cerrados y fallos de escritura', () => {
  it('si writableEnded es true NO intenta escribir nada', () => {
    const res = makeRes({ writableEnded: true })

    sendJson(asRes(res), 200, { ok: true }, 'mi-proxy')

    expect(res.writeHead).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
    expect(mockedLog).not.toHaveBeenCalled()
  })

  it('si destroyed es true NO intenta escribir nada', () => {
    const res = makeRes({ destroyed: true })

    sendJson(asRes(res), 200, { ok: true }, 'mi-proxy')

    expect(res.writeHead).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })

  it('si writeHead lanza NO propaga y registra el error con su etiqueta', () => {
    const fallo = new Error('socket cerrado')
    const res = makeRes({ writeHead: vi.fn(() => { throw fallo }) })

    expect(() => sendJson(asRes(res), 200, { ok: true }, 'mi-proxy')).not.toThrow()
    expect(mockedLog).toHaveBeenCalledWith('mi-proxy', 'socket cerrado', fallo)
  })

  it('si end lanza (tras writeHead) NO propaga y registra el error', () => {
    const fallo = new Error('end roto')
    const res = makeRes({ end: vi.fn(() => { throw fallo }) })

    expect(() => sendJson(asRes(res), 200, {}, 'mi-proxy')).not.toThrow()
    expect(res.writeHead).toHaveBeenCalledTimes(1)
    expect(mockedLog).toHaveBeenCalledWith('mi-proxy', 'end roto', fallo)
  })

  it('tambien tolera que lancen un valor no-Error (cadena)', () => {
    const res = makeRes({ writeHead: vi.fn(() => { throw 'cadena cruda' }) })

    expect(() => sendJson(asRes(res), 500, {}, 'otro-proxy')).not.toThrow()
    expect(mockedLog).toHaveBeenCalledWith('otro-proxy', 'cadena cruda', 'cadena cruda')
  })
})
