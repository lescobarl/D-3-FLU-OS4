// ============================================================
// 🈯 Local Translate — fallback offline de traducción (OS4)
// ============================================================
// Verifica el módulo localTranslate.js: el diccionario curado que se usa
// SOLO como última red de seguridad cuando, tras los reintentos anti-eco,
// el modelo sigue devolviendo la fuente sin traducir.
import { describe, test, expect } from 'vitest'
import {
  localTranslate,
  buildTranslationFallbackMessage,
} from '../src/voice/lib/localTranslate'

describe('localTranslate — diccionario offline', () => {
  test('el caso real de producción: 你好，我很好，谢谢！ → Hola, estoy muy bien, ¡gracias!', () => {
    expect(localTranslate({ text: '你好，我很好，谢谢！', targetLanguage: 'es' })).toBe(
      'Hola, estoy muy bien, ¡gracias!',
    )
  })

  test('frase multi-turno del anti-echo (ZH_PREV) → traducción española exacta', () => {
    expect(
      localTranslate({
        text: '好的，我们开始用中文交流吧，请问你今天过得怎么样？',
        targetLanguage: 'es',
      }),
    ).toBe('Bien, empecemos a hablar en chino. ¿Cómo estás hoy?')
  })

  test('normalización: espacios/trim/lowercase no rompen la coincidencia', () => {
    expect(localTranslate({ text: '  你好，我很好，谢谢！ ', targetLanguage: 'es' })).toBe(
      'Hola, estoy muy bien, ¡gracias!',
    )
  })

  test('frase no cubierta → null (para que caiga al mensaje de UX mejorado)', () => {
    expect(localTranslate({ text: '这是随机未知的中文内容。', targetLanguage: 'es' })).toBeNull()
  })

  test('destino distinto al de la entrada → null', () => {
    // "你好" existe para es y en, pero no para japonés.
    expect(localTranslate({ text: '你好', targetLanguage: 'ja' })).toBeNull()
  })

  test('texto vacío o solo espacios → null', () => {
    expect(localTranslate({ text: '', targetLanguage: 'es' })).toBeNull()
    expect(localTranslate({ text: '   ', targetLanguage: 'es' })).toBeNull()
  })

  test('zh→en funciona cuando el destino es inglés', () => {
    expect(localTranslate({ text: '你好', targetLanguage: 'en' })).toBe('Hello')
  })
})

describe('buildTranslationFallbackMessage — UX mejorada', () => {
  test('español con fuente → incluye el texto original y NO es el genérico "no pude traducir"', () => {
    const msg = buildTranslationFallbackMessage({
      source: '你好，我很好，谢谢！',
      language: 'es',
    })
    expect(msg).toContain('No pude traducir')
    expect(msg).toContain('你好，我很好，谢谢！')
    expect(msg).not.toBe(
      'Lo siento, no pude traducir la respuesta anterior. Inténtalo de nuevo por favor.',
    )
  })

  test('español sin fuente → mensaje genérico mejorado con invitación a reformular', () => {
    const msg = buildTranslationFallbackMessage({ source: '', language: 'es' })
    expect(msg).toContain('No pude traducir')
    expect(msg).toContain('reformular')
  })

  test('inglés con fuente → incluye el texto original', () => {
    const msg = buildTranslationFallbackMessage({ source: '你好', language: 'en' })
    expect(msg).toContain("couldn't translate")
    expect(msg).toContain('你好')
  })

  test('fuente larga → se recorta con elipsis para no saturar la voz', () => {
    const long = 'X'.repeat(200)
    const msg = buildTranslationFallbackMessage({ source: long, language: 'es' })
    expect(msg).toContain('…')
    expect(msg.length).toBeLessThan(long.length + 40)
  })
})
