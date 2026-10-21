// ============================================================
// vozVentanaCortaNoAfirmaNombreGuard — en ventana CORTA ningun turno se rotula con un
// NOMBRE PROPIO, aunque la voz coincida con su ancla (MANDATO 2026-10-18).
// ------------------------------------------------------------
// DEROGACION DECLARADA: este guard nacio midiendo lo CONTRARIO (2026-10-15): el atajo
// historico devolvia el nombre del primario en un turno corto. El dueno midio despues en
// su log que esa misma ventana estampaba "Luis" en la voz de la hija (similitud dentro de
// la banda de "misma voz"), y ordeno retirar los nombres de la ventana corta.
//
// REGLA VIGENTE: un nombre propio exige ventana SOSTENIDA y coincidencia contra su ancla
// registrada (`canAssertSpeakerName`); en ventana corta la voz conserva la etiqueta
// ANONIMA estable de su timbre («Hablante N»), que es honesta y no mezcla intervenciones.
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

describe('ventana CORTA: la voz se agrupa por timbre, pero NO se afirma ningun nombre', () => {
  it('con sessionPrimary="luis" y coincidencia 0.94 en 1 palabra, conserva su «Hablante 1»', () => {
    expect(turno({ sessionPrimary: 'luis' })).toBe('Hablante 1')
  })

  it('DETECTOR positivo: la MISMA voz con ventana SOSTENIDA y su ancla registrada SI lleva el nombre', () => {
    const sostenido = resolveConversationSpeaker({
      signatureVector: [...A2],
      speakerClusters: [{ label: 'luis', signature: [...A2] }],
      lastSpeaker: '',
      lastSignature: null,
      sessionPrimary: 'luis',
      voicedSampleCount: 96000,
      minVoicedSamples: 12000,
      sampleRate: 48000,
      utteranceText: 'siguiente carta por favor',
      atTurnBoundary: true,
      allowNewCluster: true,
      thresholds: {},
    } as never)
    expect(sostenido).toBe('luis')
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
