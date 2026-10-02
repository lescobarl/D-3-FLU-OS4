// ============================================================
// transcriptConfig.test.ts — Conducta de formatStreamSttUiStatus
// ------------------------------------------------------------
// Etiqueta UI del motor de transcripcion: traduce el estado crudo
// del STT a { label, tone } para la interfaz. Se fija la
// precedencia (listening manda) y la normalizacion del estado.
// ============================================================
import { describe, expect, it } from 'vitest'
import { formatStreamSttUiStatus } from '../src/voice/lib/transcriptConfig.js'

describe('transcriptConfig — formatStreamSttUiStatus', () => {
  it('sin escucha activa devuelve STT off / fallback', () => {
    expect(formatStreamSttUiStatus('', { listening: false })).toEqual({
      label: 'STT off',
      tone: 'fallback',
    })
  })

  it('sin listening por defecto tambien devuelve STT off', () => {
    expect(formatStreamSttUiStatus('error')).toEqual({ label: 'STT off', tone: 'fallback' })
  })

  it('cuando NO escucha, ignora un estado de error', () => {
    expect(formatStreamSttUiStatus('error', { listening: false })).toEqual({
      label: 'STT off',
      tone: 'fallback',
    })
  })

  it('escuchando con estado "error" devuelve STT error / error', () => {
    expect(formatStreamSttUiStatus('error', { listening: true })).toEqual({
      label: 'STT error',
      tone: 'error',
    })
  })

  it('recorta espacios antes de comparar el estado', () => {
    expect(formatStreamSttUiStatus('  error  ', { listening: true })).toEqual({
      label: 'STT error',
      tone: 'error',
    })
  })

  it('escuchando con estado vacio devuelve Chrome / ok', () => {
    expect(formatStreamSttUiStatus('', { listening: true })).toEqual({
      label: 'Chrome',
      tone: 'ok',
    })
  })

  it('escuchando con estado undefined devuelve Chrome / ok', () => {
    expect(formatStreamSttUiStatus(undefined, { listening: true })).toEqual({
      label: 'Chrome',
      tone: 'ok',
    })
  })

  it('escuchando con un estado cualquiera devuelve Chrome / ok', () => {
    expect(formatStreamSttUiStatus('running', { listening: true })).toEqual({
      label: 'Chrome',
      tone: 'ok',
    })
  })

  it('coacciona a cadena un estado no textual', () => {
    expect(formatStreamSttUiStatus(123 as unknown as string, { listening: true })).toEqual({
      label: 'Chrome',
      tone: 'ok',
    })
  })

  it('un valor truthy no booleano en listening cuenta como escuchando', () => {
    expect(formatStreamSttUiStatus('error', { listening: 1 as unknown as boolean })).toEqual({
      label: 'STT error',
      tone: 'error',
    })
  })

  it('devuelve exactamente las claves label y tone', () => {
    const out = formatStreamSttUiStatus('error', { listening: true })
    expect(Object.keys(out).sort()).toEqual(['label', 'tone'])
  })

  it('no muta el objeto de opciones recibido', () => {
    const options = { listening: true }
    formatStreamSttUiStatus('error', options)
    expect(options).toEqual({ listening: true })
  })
})
