// ============================================================
// cierreRealYCaraUnicaGuard - P4 (cierre real: silencio O cambio de hablante) y P5 (una voz = una
// clave). La simulacion de 30 hablantes/600 filas (tests/cajaConversacionSim.test.ts) midio
// nombrePerdido=13 y nombreAjeno=3 con la voz partida en dos claves.
// ============================================================
import { describe, expect, it } from 'vitest'

import { resolveSrGapTrigger } from '../src/voice/lib/fluTranscriptPause.js'
import { registerVoiceName, rememberVoiceVector, resetVoiceDirectory, resolveVoiceName } from '../src/voice/lib/speakerDirectory.js'

/**
 * Predicado del contrato del cierre: si la fila se cierra, el motivo es SILENCIO o CAMBIO DE
 * HABLANTE. Cualquier otra puerta (p. ej. 'sin contenido nuevo' o 'turno viejo') NO vale.
 */
export function puertaDeCierreValida(r: { fire: boolean; reason: string }): boolean {
  return !r.fire || r.reason === 'sr-silence' || r.reason === 'sr-speaker-change'
}

describe('P4 - cierre real: las DOS puertas (silencio O cambio de hablante), en fluTranscriptPause', () => {
  it('el CAMBIO DE HABLANTE cierra aunque no haya pasado el silencio', () => {
    const r = resolveSrGapTrigger({ speakerChanged: true, hasOpenLine: true, sinceLastResultMs: 0 })
    expect(r.fire, 'cambia el hablante y la fila se cierra').toBe(true)
    expect(r.reason).toBe('sr-speaker-change')
  })

  it('el SILENCIO cierra', () => {
    const r = resolveSrGapTrigger({ hasOpenLine: true, sinceLastResultMs: 999999 })
    expect(r.fire).toBe(true)
    expect(r.reason).toBe('sr-silence')
  })

  it('sin silencio y sin cambio de hablante NO cierra (no se vacia a mitad del dictado)', () => {
    const r = resolveSrGapTrigger({ hasOpenLine: true, sinceLastResultMs: 0 })
    expect(r.fire).toBe(false)
    expect(r.reason).toBe('sr-active')
  })

  it('sin locucion viva no cierra ni por cambio de hablante (no hay nada que cerrar)', () => {
    const r = resolveSrGapTrigger({ speakerChanged: true, hasOpenLine: false, sinceLastResultMs: 999999 })
    expect(r.fire).toBe(false)
  })
})

describe('PRUEBA DE DETECTOR (el marcador no es decorativo)', () => {
  it('acepta las DOS puertas y RECHAZA cualquier otro motivo de cierre', () => {
    expect(puertaDeCierreValida(resolveSrGapTrigger({ hasOpenLine: true, sinceLastResultMs: 999999 }))).toBe(true)
    expect(puertaDeCierreValida(resolveSrGapTrigger({ speakerChanged: true, hasOpenLine: true }))).toBe(true)
    expect(puertaDeCierreValida({ fire: true, reason: 'sr-live-turn-stale' }), 'un cierre sin silencio ni cambio de hablante').toBe(false)
    expect(puertaDeCierreValida({ fire: true, reason: 'sin-contenido-nuevo' }), 'un cierre por "no hay nada nuevo"').toBe(false)
  })
})

describe('P5 - el nombre NO se propaga a otra clave (regresion medida en su corrida del 15: 5 claves y TODO salia como Luis)', () => {
  it('nombrar una clave NO nombra otra clave', () => {
    resetVoiceDirectory()
    rememberVoiceVector('voz-b', [1, 0, 0, 0])
    registerVoiceName('voz-a', 'Luis', { vector: [0.99, 0.01, 0, 0] })
    expect(resolveVoiceName('voz-b'), 'otra voz no hereda el nombre').toBe('')
  })
  it('la clave nueva tampoco hereda un nombre ajeno', () => {
    resetVoiceDirectory()
    registerVoiceName('voz-a', 'Luis', { vector: [1, 0, 0, 0] })
    rememberVoiceVector('voz-b', [0.99, 0.01, 0, 0])
    expect(resolveVoiceName('voz-b')).toBe('')
  })
})

