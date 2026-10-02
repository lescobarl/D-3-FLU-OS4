// ============================================================
// voiceCommandPhrases.test.ts — Conducta observable del bloque
// de frases del comando 'restablecer colores del avatar'.
// ------------------------------------------------------------
// El modulo es la UNICA fuente de estas frases (resolver por voz,
// catalogo humano y pruebas). Estos casos fijan el contrato del
// dato sin acoplarse a consumidores concretos.
// ============================================================
import { describe, expect, it } from 'vitest'
import { RESET_AVATAR_COLOR_PHRASES } from '../src/voice/lib/voiceCommandPhrases.js'

const phraseList = RESET_AVATAR_COLOR_PHRASES as unknown as string[]

describe('voiceCommandPhrases — RESET_AVATAR_COLOR_PHRASES', () => {
  it('expone un array no vacio', () => {
    expect(Array.isArray(phraseList)).toBe(true)
    expect(phraseList.length).toBeGreaterThan(0)
  })

  it('todas las entradas son cadenas no vacias', () => {
    for (const phrase of phraseList) {
      expect(typeof phrase).toBe('string')
      expect(phrase.trim().length).toBeGreaterThan(0)
    }
  })

  it('las frases estan normalizadas (minusculas y sin espacios en los bordes)', () => {
    for (const phrase of phraseList) {
      expect(phrase).toBe(phrase.toLowerCase())
      expect(phrase).toBe(phrase.trim())
    }
  })

  it('no contiene frases duplicadas', () => {
    expect(new Set(phraseList).size).toBe(phraseList.length)
  })

  it('incluye la forma corta base en espanol', () => {
    expect(phraseList).toContain('restablecer colores')
  })

  it('incluye variantes con el posesivo "del avatar"', () => {
    expect(phraseList).toContain('restablecer colores del avatar')
    expect(phraseList).toContain('restablecer los colores del avatar')
    expect(phraseList).toContain('resetear colores del avatar')
  })

  it('incluye la variante "de flu"', () => {
    expect(phraseList).toContain('restablecer colores de flu')
  })

  it('cubre las conjugaciones "restablece" y "resetea"', () => {
    expect(phraseList).toContain('restablece los colores')
    expect(phraseList).toContain('resetea los colores del avatar')
  })

  it('incluye las formas en ingles', () => {
    expect(phraseList).toContain('reset avatar colors')
    expect(phraseList).toContain('reset flu colors')
    expect(phraseList).toContain('default colors')
  })

  it('incluye la forma "colores por defecto"', () => {
    expect(phraseList).toContain('colores por defecto')
  })

  it('su contenido es exactamente el conjunto declarado (sin frases perdidas ni de mas)', () => {
    const declaradas = [
      'restablecer colores',
      'restablecer colores del avatar',
      'restablecer colores de flu',
      'restablecer los colores del avatar',
      'restablece los colores',
      'restablece los colores del avatar',
      'resetear colores',
      'resetear colores del avatar',
      'resetea los colores del avatar',
      'reset avatar colors',
      'reset flu colors',
      'colores por defecto',
      'default colors',
    ]
    expect(phraseList).toEqual(declaradas)
  })
})
