// ============================================================
// vozSondaDatosGuard - GUARD de la SONDA unica de diagnostico de voz
// ------------------------------------------------------------
// Para no volver a depurar a ciegas: cada evento emite UNA linea
// `VozProbe <tag> {json}` que permite reconstruir la sesion.
//
// Corte 2026-10-26 (feature/conversacion-modulo-nuevo): los casos del ESCRITOR
// DE LA FILA emitiendo `row` y de la SONDA DE IDENTIDAD por preflight se
// retiraron con sus duenos: conversationTurnRow.ts (BORRADO; el escritor nuevo
// del modulo no emite `row`) y turnSpeakerPreflight.js (huerfano tras el commit
// 365eeef5). Quedan VIVOS el contrato de la sonda en si (encendida emite JSON
// parseable, apagada no emite) y su detector: voiceProbe lo siguen consumiendo
// useFluVoiceAssistant.js (identity/asrRaw/asrFinal), useSessionSpeakerClusters.js
// (clusters/anchors), fluTranscriptPause.js (srGap) y speakerIdentityRegister.js.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../src/lib/clientLogRelay', () => ({ relayLog: vi.fn() }))

import { relayLog } from '../src/lib/clientLogRelay'
import { voiceProbe, setVoiceProbeEnabled, isVoiceProbeEnabled } from '../src/voice/lib/voiceProbe'

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const probeCalls = () =>
  (relayLog as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
    (c) => c[1] === 'VozProbe',
  )

describe('sonda de datos de voz', () => {
  beforeEach(() => {
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
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('la sonda no rompe el flujo si el rele falla (nunca lanza)', async () => {
    setVoiceProbeEnabled(true)
    expect(() => voiceProbe('x', { a: 1 })).not.toThrow()
    await settle()
  })
})
