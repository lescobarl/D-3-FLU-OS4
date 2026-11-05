// ============================================================
// 🧪 Detección de solicitudes SIMPLES (Fase 5) — regresión canta/cantar
// ============================================================
// Bug reportado: "canta las mananitas" NO reproducía la canción, pero
// "reproduce las mananitas" sí.
//
// Causa raíz (confirmada): detectSimpleRequest marcaba "canta las mananitas"
// como SIMPLE porque el regex complexReference NO incluía "canta|cantar"
// (gemini.js). Al ser "simple", el pipeline usaba buildMinimalContractSchema()
// (SIN la propiedad `musica`), por lo que el modelo NO podía emitir
// play_music → la canción nunca sonaba.
//
// FIX aplicado (gemini.js): el regex ahora incluye
//   canta|cantar|toca|tocar|sing
// (además de reproduce|reproducir y musica|cancion|canciones), de modo que
// cualquier turno que pida cantar/tocar música se considera COMPLEJO y recibe
// el schema completo con `musica`.
//
// Este test es la red de regresión:
//   1) canta/cantar/toca/tocar/sing/reproduce → NUNCA simple
//   2) saluditos / confirmaciones sin referencia → sí simple
//   3) buildMinimalContractSchema NO tiene `musica` (documenta el hueco que
//      el fix evita: solo el schema completo permite play_music)
// ============================================================
import { describe, test, expect } from 'vitest'
import { detectSimpleRequest, buildMinimalContractSchema } from '../src/voice/lib/gemini'

describe('detectSimpleRequest — regresión: cantar/tocar música NO es simple', () => {
  const complexCases = [
    ['canta las mananitas', 'canta (verbo de música)'],
    ['canta la cancion de cepillin', 'canta + cancion'],
    ['cantar las mañanitas por favor', 'cantar (infinitivo)'],
    ['toca una cancion', 'toca (verbo de música)'],
    ['tocar las mananitas', 'tocar (infinitivo)'],
    ['sing happy birthday', 'sing (inglés)'],
    ['reproduce las mananitas', 'reproduce'],
    ['reproducir la cancion de cepillin', 'reproducir + cancion'],
    ['pon musica de fondo', 'musica'],
    ['quiero escuchar la cancion de las mananitas', 'cancion'],
    ['ponme una cancion', 'cancion'],
    ['toma nota de la reunion', 'toma nota'],
    ['genera una minuta', 'minuta'],
    ['abre el workspace de finanzas', 'workspace'],
    ['muestrame mi horario de clases', 'horario'],
    ['que clases tengo manana', 'clases'],
    ['cual es mi proxima clase', 'clase'],
    ['ensename mi horario semanal', 'horarios'],
  ]

  for (const [transcript, label] of complexCases) {
    test(`"${transcript}" → COMPLEJO (no simple) — ${label}`, () => {
      expect(detectSimpleRequest({ transcript })).toBe(false)
    })
  }
})

describe('detectSimpleRequest — casos simples de control (sin regresión)', () => {
  const simpleCases = [
    ['hola como estas', 'saludo'],
    ['buenos dias', 'saludo'],
    ['ok flu adelante', 'confirmación'],
    ['gracias', 'agradecimiento'],
    ['esta lloviendo afuera', 'comentario cotidiano'],
    ['cual es la capital de francia', 'pregunta general'],
  ]

  for (const [transcript, label] of simpleCases) {
    test(`"${transcript}" → simple — ${label}`, () => {
      expect(detectSimpleRequest({ transcript })).toBe(true)
    })
  }

  test('turno vacío / sin transcript → NO simple (nunca minimal)', () => {
    expect(detectSimpleRequest({})).toBe(false)
    expect(detectSimpleRequest({ transcript: '' })).toBe(false)
    expect(detectSimpleRequest({ transcript: null as unknown as string })).toBe(false)
  })

  test('texto muy largo (> 20 palabras) → NO simple (pide contexto completo)', () => {
    const long =
      'hola quiero saber cual es la mejor forma de organizar una reunion con todos los participantes y despues generar una minuta con los puntos clave y las decisiones tomadas durante toda la sesion'
    expect(long.split(/\s+/).length).toBeGreaterThan(20)
    expect(detectSimpleRequest({ transcript: long })).toBe(false)
  })

  test('intent con comando explícito → NO simple', () => {
    expect(detectSimpleRequest({ transcript: 'adelante', intent: { comando: 'INICIAR_CONVERSACION' } })).toBe(false)
  })

})

describe('buildMinimalContractSchema — documenta el hueco que evita el fix', () => {
  test('el schema mínimo NO incluye `musica` (por eso canta debía ser COMPLEJO)', () => {
    const schema = buildMinimalContractSchema()
    expect(schema.properties).not.toHaveProperty('musica')
    expect(schema.properties).toHaveProperty('respuesta_voz')
    expect(schema.properties).toHaveProperty('navegacion')
  })

  test('el schema mínimo es el que recibe un turno simple (sin capacidad play_music)', () => {
    // Cadena de causalidad del bug: simple → schema mínimo → sin musica →
    // el modelo no puede emitir play_music → no suena la canción.
    const schema = buildMinimalContractSchema()
    const schemaJson = JSON.stringify(schema)
    expect(schemaJson).not.toContain('play_music')
    expect(schemaJson).not.toContain('musica')
  })
})
