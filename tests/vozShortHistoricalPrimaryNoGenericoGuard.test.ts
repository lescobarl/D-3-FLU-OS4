// ============================================================
// Guard (nace ROJO) - Defecto 3: turno corto de la MISMA voz del participante
// NOMBRADO debe llevar su NOMBRE, no la etiqueta generica "Hablante N".
// ------------------------------------------------------------
// ESPEC (fluConfig.js, roomCapture): "Cuando hay un participante real con nombre
// propio activo, se siembra como sessionPrimary para que la diarizacion etiquete
// sus turnos con su nombre (no «Hablante N»)."
//
// DEFECTO MEDIDO (log del dueno 2026-10-15 18:18): 45 lineas
//   Identity label="Hablante N" reason=production-short-historical ... prefer="Hablante N"
// con el primario nombrado activo (Match reason=canonical name="luis"). El atajo
// HISTORICO (voz corta) devuelve la etiqueta del cluster ANTES de que las vias del
// primario midan, y la compuerta "registrado" busca `preferSpeaker` (el sticky
// generico) y nunca el `sessionPrimary` (el NOMBRE).
//
// Se ejercita el DUENO UNICO de la decision (resolveConversationSpeaker), no una copia.
// ============================================================
import { describe, it, expect } from 'vitest'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'

// Voz del participante (A), casi la misma (A2 ~0.94) y una voz DISTINTA (B).
const A = [1, 0, 0]
const A2 = [0.94, 0.342, 0]
const B = [0, 1, 0]

/** Escenario real: el cluster ANCLA del nombre ('luis') == la voz del turno. */
function clusters() {
  return [
    { label: 'luis', signature: [...A] },
    { label: 'Hablante 1', signature: [...A2] },
    { label: 'Hablante 2', signature: [...B] },
  ]
}

/** Turno CORTO (1 palabra) de la voz del participante nombrado. */
function turno({ sessionPrimary }: { sessionPrimary: string }) {
  return resolveConversationSpeaker({
    signatureVector: [...A2],
    speakerClusters: clusters(),
    lastSpeaker: 'Hablante 1',
    lastSignature: [...A2],
    preferSpeaker: 'Hablante 1',
    sessionPrimary,
    voicedSampleCount: 30000,
    minVoicedSamples: 12000,
    minVoicedSamplesForNew: 24000,
    utteranceText: 'si',
    sampleRate: 48000,
    atTurnBoundary: true,
    allowNewCluster: true,
    thresholds: {},
  } as never)
}

describe('turno corto de la voz del participante NOMBRADO: se rotula con su NOMBRE', () => {
  it('con sessionPrimary="luis" y coincidencia medida (0.94 >= 0.72) devuelve "luis", no "Hablante 1"', () => {
    expect(turno({ sessionPrimary: 'luis' })).toBe('luis')
  })
})

describe('el detector no es decorativo', () => {
  it('SIN primario nombrado (sessionPrimary vacio) la MISMA voz conserva la etiqueta generica', () => {
    expect(turno({ sessionPrimary: '' })).toBe('Hablante 1')
  })
  it('un nombre propio NO se inventa: la voz de OTRA persona no se rotula con el primario', () => {
    const otra = resolveConversationSpeaker({
      signatureVector: [...B],
      speakerClusters: clusters(),
      lastSpeaker: 'Hablante 2',
      lastSignature: [...B],
      preferSpeaker: 'Hablante 2',
      sessionPrimary: 'luis',
      voicedSampleCount: 30000,
      minVoicedSamples: 12000,
      minVoicedSamplesForNew: 24000,
      utteranceText: 'si',
      sampleRate: 48000,
      atTurnBoundary: true,
      allowNewCluster: true,
      thresholds: {},
    } as never)
    expect(otra).not.toBe('luis')
  })
})
