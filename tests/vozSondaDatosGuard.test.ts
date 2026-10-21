// ============================================================
// vozSondaDatosGuard - GUARD de la SONDA unica de diagnostico de voz
// ------------------------------------------------------------
// Para no volver a depurar a ciegas: cada evento emite UNA linea
// `VozProbe <tag> {json}` que permite reconstruir
//   asrFinal (que recibio el ASR) -> commit -> row (que quedo) + identity + clusters.
//
// Se comprueba con detector (encendida emite; apagada no emite nada) y que el
// ESCRITOR DE LA FILA emite su propio evento `row` (era justo el dato que faltaba
// en todos los logs anteriores: la etiqueta FINAL que quedo en la fila).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../src/lib/clientLogRelay', () => ({ relayLog: vi.fn() }))

import { relayLog } from '../src/lib/clientLogRelay'
import { voiceProbe, setVoiceProbeEnabled, isVoiceProbeEnabled } from '../src/voice/lib/voiceProbe'
import { scheduleTurnSpeakerPreflight, resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow'
import { useIntegrationStore } from '../src/store/integrationStore'

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const probeCalls = () =>
  (relayLog as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
    (c) => c[1] === 'VozProbe',
  )

describe('sonda de datos de voz', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
    ;(relayLog as unknown as { mockClear: () => void }).mockClear()
  })

  it('encendida emite JSON parseable; apagada no emite nada', async () => {
    setVoiceProbeEnabled(true)
    expect(isVoiceProbeEnabled()).toBe(true)
    voiceProbe('row', { text: 'hola', speaker: 'luis' })
    await settle()
    const calls = probeCalls()
    expect(calls.length).toBe(1)
    const payload = String(calls[0][2]).replace(/^row /, '')
    expect(JSON.parse(payload)).toEqual({ text: 'hola', speaker: 'luis' })

    setVoiceProbeEnabled(false)
    voiceProbe('row', { text: 'no debe salir' })
    await settle()
    expect(probeCalls().length).toBe(1)
  })

  it('el ESCRITOR DE LA FILA emite el evento row con la etiqueta FINAL', async () => {
    setVoiceProbeEnabled(true)
    commitUserTurnRow({ text: 'hola hola como estan', speakerName: 'Hablante 1', turnId: 5 })
    await settle()
    const rows = probeCalls().filter((c) => String(c[2]).startsWith('row '))
    expect(rows.length).toBe(1)
    const data = JSON.parse(String(rows[0][2]).replace(/^row /, ''))
    expect(data).toMatchObject({ action: 'added', speaker: 'Hablante 1', turnId: 5 })
    expect(String(data.text)).toContain('hola hola')
  })

  it('la sonda de identidad lleva turno, regla, ventana y pares PRE-decision (se reconstruye sin cruzar lineas)', async () => {
    // DEFECTO MEDIDO (2026-10-18): la linea `identity` solo traia name/reason de la VIA
    // ('resolved-idle'), sin turno, sin la regla que decidio y sin similitudes, asi que
    // el escenario del dueno no se podia recrear con sus propios datos.
    setVoiceProbeEnabled(true)
    resetTurnSpeakerPreflights()
    scheduleTurnSpeakerPreflight(
      7,
      () =>
        Promise.resolve({
          speakerId: 'speaker_1',
          speakerName: 'Hablante 1',
          signatureVector: [1, 0],
          inputClusters: [{ label: 'luis', signature: [1, 0] }],
          workingClusters: [{ label: 'Hablante 1', signature: [1, 0] }],
          diagnosis: { reason: 'production-first-cluster', lastSim: 0, bestSim: 0.74, bestLabel: 'luis' },
          audioMs: 2100,
          voicedSampleCount: 48000,
          evidence: false,
          reason: 'resolved-idle',
          atTurnBoundary: true,
        }),
      {},
    )
    await settle()
    const identity = probeCalls().filter((c) => String(c[2]).startsWith('identity '))
    expect(identity.length).toBe(1)
    const data = JSON.parse(String(identity[0][2]).replace(/^identity /, ''))
    expect(data).toMatchObject({
      turn: 7,
      reason: 'resolved-idle',
      decision: 'production-first-cluster',
      name: 'Hablante 1',
      boundary: true,
      ms: 2100,
      voiced: 48000,
      bestSim: 0.74,
      bestLabel: 'luis',
    })
    expect(data.pares[0]).toMatchObject({ label: 'luis', sim: 1 })
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('la sonda no rompe el flujo si el rele falla (nunca lanza)', async () => {
    setVoiceProbeEnabled(true)
    expect(() => voiceProbe('x', { a: 1 })).not.toThrow()
    await settle()
  })
})
