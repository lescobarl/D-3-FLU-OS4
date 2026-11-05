// ============================================================
// geminiContractPayload — el contrato de voz NO debe caer en
// "Gemini: respuesta inválida" (invalid_json) por:
//   a) JSON envuelto con texto alrededor  → lo extrae sin reintentar
//   b) JSON válido pero SIN respuesta_voz → reintenta UNA vez y recupera
//
// Nace ROJO: hoy `generateFluContract` lanza invalid_json al primer intento
// cuando el JSON no trae `respuesta_voz` (p. ej. el modelo devuelve solo
// `acciones`), sin reintentar.
// ============================================================
import { describe, test, expect, vi, afterEach } from 'vitest'
import { generateFluContract } from '../src/voice/lib/gemini'

function okResponse(content: string) {
  const body = JSON.stringify({
    choices: [{ message: { role: 'assistant', content } }],
  })
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async text() {
      return body
    },
    async json() {
      return JSON.parse(body)
    },
  }
}

let calls = 0

function stubSequence(contents: string[]) {
  calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const content = contents[Math.min(calls, contents.length - 1)]
      calls += 1
      return okResponse(content)
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  calls = 0
})

describe('generateFluContract — no cae en "respuesta inválida" por formato', () => {
  test('JSON sin respuesta_voz → reintenta y recupera la respuesta válida', async () => {
    stubSequence([
      JSON.stringify({ acciones: [{ dominio: 'reminder', texto: 'crea una cita' }] }),
      JSON.stringify({ respuesta_voz: 'Listo, creé la cita.', navegacion: { comando: null } }),
    ])

    const result = await generateFluContract({
      apiKey: 'test-key-12345',
      transcript: 'crea una cita',
      language: 'es',
    } as any)

    expect(result.contract.respuesta_voz).toBe('Listo, creé la cita.')
    expect(calls).toBe(2)
  })

  test('JSON envuelto con texto → lo extrae SIN reintentar', async () => {
    stubSequence([
      'Claro, aquí está: {"respuesta_voz":"Hola","navegacion":{"comando":null}} ¡listo!',
    ])

    const result = await generateFluContract({
      apiKey: 'test-key-12345',
      transcript: 'hola',
      language: 'es',
    } as any)

    expect(result.contract.respuesta_voz).toBe('Hola')
    expect(calls).toBe(1)
  })

  test('respuesta no parseable en ambos intentos → invalid_json con bodyPreview', async () => {
    stubSequence(['no soy json', 'tampoco soy json'])

    await expect(
      generateFluContract({ apiKey: 'test-key-12345', transcript: 'hola', language: 'es' } as any),
    ).rejects.toMatchObject({ code: 'invalid_json' })
    expect(calls).toBe(2)
  })
})
