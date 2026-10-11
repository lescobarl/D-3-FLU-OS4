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
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('la sonda no rompe el flujo si el rele falla (nunca lanza)', async () => {
    setVoiceProbeEnabled(true)
    expect(() => voiceProbe('x', { a: 1 })).not.toThrow()
    await settle()
  })
})
