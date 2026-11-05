/**
 * geminiExtractJson — Hito #6: el contrato de Gemini no debe caer en
 * "respuesta inválida" (invalid_json) cuando el modelo envuelve el JSON con
 * texto o deja una coma final.
 *
 * Nace ROJO: hoy `extractJson` solo acepta JSON puro o en fence ```json.
 */
import { describe, expect, it } from 'vitest'
import { extractJson } from '../src/voice/lib/gemini'

describe('extractJson — tolerar JSON envuelto/ruido (#6)', () => {
  it('JSON puro y en fence siguen funcionando', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('JSON con texto alrededor (causa real de "respuesta inválida")', () => {
    expect(extractJson('Claro, aquí está la cita: {"titulo":"cita","hora":"10:00"} ¡listo!')).toEqual({
      titulo: 'cita',
      hora: '10:00',
    })
  })

  it('JSON con coma final', () => {
    expect(extractJson('{"a":[1,2,]}')).toEqual({ a: [1, 2] })
  })

  it('devuelve null si de verdad no hay JSON', () => {
    expect(extractJson('no hay json aquí')).toBeNull()
  })
})
