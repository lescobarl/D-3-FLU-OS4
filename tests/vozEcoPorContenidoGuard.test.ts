// ============================================================
// vozEcoPorContenidoGuard - GUARD del defecto MEDIDO con el escenario inyectado
// ------------------------------------------------------------
// EVIDENCIA (2026-10-07, simulacion inyectada sobre la app real): dos frases del
// guion cayeron SIN fila y SIN rastro (`soy Luis` y un bloque entero). Causa: el
// `onresult` descartaba TODO mientras FLU hablaba (`if (isFluSpeaking()) return`),
// asi que el habla real dicha durante la respuesta de FLU se perdia.
//
// FIX (sin parche): el filtro pasa a ser por CONTENIDO — se descarta SOLO lo que
// es eco del texto que FLU acaba de decir (`isAssistantSpeechEcho`), reutilizando
// el comparador que YA existe (`isAssistantVoiceEcho`).
//
// Nace ROJO (isAssistantSpeechEcho no existia; el gate era por tiempo).
// ============================================================
import { describe, it, expect } from 'vitest'
import { isAssistantSpeechEcho, isAssistantVoiceEcho } from '../src/voice/lib/conversationStream.js'

const evento = (transcript: string, isFinal = true) => ({
  resultIndex: 0,
  results: [{ isFinal, 0: { transcript, confidence: 0.9 }, length: 1 }],
})

const FLU_DICE =
  'Claro que si, vamos a jugar loteria! Preparate para la diversion de hoy con tus amigos'

describe('mientras FLU habla: se descarta el eco, NO el habla real', () => {
  it('el eco de la propia voz de FLU se descarta', () => {
    expect(isAssistantSpeechEcho(evento('vamos a jugar loteria preparate para la diversion'), FLU_DICE)).toBe(true)
  })

  it('el habla real del usuario durante la respuesta se CONSERVA', () => {
    expect(isAssistantSpeechEcho(evento('Okay flu soy Luis'), FLU_DICE)).toBe(false)
    expect(
      isAssistantSpeechEcho(
        evento('bueno empecemos a hacer unas pruebas esto es una prueba para la realizacion'),
        FLU_DICE,
      ),
    ).toBe(false)
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('sin texto escuchado no hay eco (no descarta por vacio)', () => {
    expect(isAssistantSpeechEcho(evento(''), FLU_DICE)).toBe(false)
  })

  it('el comparador de contenido sigue discriminando (caso base conservado)', () => {
    expect(isAssistantVoiceEcho('vamos a jugar loteria preparate para la diversion', FLU_DICE)).toBe(true)
    expect(isAssistantVoiceEcho('agrega cloro a la nota del super', FLU_DICE)).toBe(false)
  })
})
