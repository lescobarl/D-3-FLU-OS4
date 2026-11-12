// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { construirFila, fusionarVoz, resolverEtiqueta } from '../src/voice/conversation/fila'
import { detectListeningControl } from '../src/voice/lib/audioMath'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'
import {
  SPEAKER_ID_PENDING,
  SPEAKER_ID_UNIDENTIFIED,
  labelToSpeakerId,
  resolveRowSpeakerLabel,
} from '../src/voice/lib/conversationRow'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore'

const UUID = '11111111-1111-4111-8111-111111111111'
const X = FLU_CONFIG.voiceIdentity.labels.pendingSpeaker
const XX = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker

/** Etiqueta VISIBLE de una fila del módulo (dueño único: resolveRowSpeakerLabel). */
const visible = (speakerName: string): string =>
  resolveRowSpeakerLabel({
    speakerName,
    meta: { origin: 'conversation-module' },
  })

const filaBase = (inicio: number, fin: number, texto: string) => ({
  locutionId: UUID,
  sessionId: '10fdae4b-6611-47d1-882b-6c705185168d',
  turnId: '3636a0c4-1b95-43fa-a331-b6427468fc9f',
  inicio,
  fin,
  sampleRate: 48000,
  texto,
  idioma: 'es' as const,
  overlap: false,
  final: true,
  reason: 'silencio' as never,
  voz: {
    nombre: '',
    nombreConfirmado: false,
    hablante: 'Hablante 2',
    continuidad: true,
    etiquetaVoz: '',
  },
  etiquetaAnterior: 'Luis',
  semillaEtiqueta: XX,
  esEtiquetaAnonima: isAutoSpeakerLabel,
  pendienteEtiqueta: X,
  nombresPorEtiqueta: new Map(),
  firma: null,
})

describe('turno y hablante: los 4 casos reales', () => {
  it('1) la medida anónima de la mujer gana a la continuidad de Luis', () => {
    const resuelta = resolverEtiqueta({
      voz: { nombre: '', nombreConfirmado: false, hablante: 'Hablante 2', continuidad: true },
      anterior: 'Luis',
      semilla: XX,
      esEtiquetaAnonima: isAutoSpeakerLabel,
      pendiente: X,
    })
    // La agrupación interna es la de su voz; la VISTA nunca cae en Luis y
    // conserva `Hablante N` (voz medida desconocida, regla 7).
    expect(resuelta.etiqueta).toBe('Hablante 2')
    expect(resuelta.etiqueta).not.toBe('Luis')
    expect(visible(resuelta.etiqueta)).toBe('Hablante 2')
  })

  it('2) X (espera) y XX (no identificado) no se mezclan', () => {
    expect(X).toBe('Hablante X')
    expect(XX).toBe('Hablante XX')
    expect(visible('Hablante X')).toBe(X)
    expect(visible('Hablante XX')).toBe(XX)
    expect(visible('Hablante 2')).toBe('Hablante 2')
    expect(visible('Luis')).toBe('Luis')
    // Claves de voz DISTINTAS: una fila en espera no es la no identificada.
    expect(labelToSpeakerId(X)).toBe(SPEAKER_ID_PENDING)
    expect(labelToSpeakerId(XX)).toBe(SPEAKER_ID_UNIDENTIFIED)
    expect(labelToSpeakerId(X)).not.toBe(labelToSpeakerId(XX))
    expect(labelToSpeakerId('Hablante 2')).toBe('speaker_2')
    expect(labelToSpeakerId(XX)).not.toMatch(/^speaker_name_/)
  })

  it('3) un tramo de 1 muestra NO pierde su texto: fila XX (medida insuficiente)', () => {
    const corto = construirFila({
      ...filaBase(5296383, 5296384, 'mucho'),
      voz: {
        nombre: '',
        nombreConfirmado: false,
        hablante: '',
        continuidad: false,
        medidaInsuficiente: true,
      },
    })
    expect(corto.descarte).toBeNull()
    expect(corto.fila?.texto).toBe('mucho')
    expect(corto.fila?.etiqueta).toBe(XX)
  })

  it('4) "hago un silencio" no es orden de control', () => {
    expect(detectListeningControl('hago un silencio', FLU_CONFIG.voiceCommands)).toBeNull()
    // El comando real sigue existiendo: solo casa exacto.
    expect(detectListeningControl('cerrar escucha', FLU_CONFIG.voiceCommands)).not.toBeNull()
  })

  it('la transición visible es X → XX → N → nombre, sin mezclarse', () => {
    expect(visible(X)).toBe(X)
    expect(visible(XX)).toBe(XX)
    expect(visible('Hablante 7')).toBe('Hablante 7')
    expect(visible('Luis')).toBe('Luis')
  })

  it('una identidad positiva borra el insuficiente de un intento temprano', () => {
    // La medida temprana de 1,5 s puede caer en una pausa; si el cierre mide
    // voz, la fila NO puede quedarse en XX (defecto medido 2026-11-11).
    const medido = fusionarVoz(
      { insuficiente: true },
      { vozId: 'voz-1', hablante: 'Hablante 1', vector: [1, 0] },
    )
    expect(medido.insuficiente).toBe(false)
    expect(medido.hablante).toBe('Hablante 1')
    // Sin identidad positiva, el estado insuficiente se conserva.
    expect(fusionarVoz({ insuficiente: true }, { continuidad: true }).insuficiente).toBe(true)
  })
})
