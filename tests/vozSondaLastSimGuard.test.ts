// ============================================================
// vozSondaLastSimGuard - El instrumento `Identity` lee el campo que ESCRIBEN las vias
// del resolutor (hoy ciego 39/39).
// ------------------------------------------------------------
// MEDIDO (2026-10-10, log del dueno 14:00-14:08): las 39 lineas `Identity` salian
// `lastSim=0.000`. La sonda leia `diagnosis.lastTurnSimilarity` mientras la via
// PRINCIPAL del resolutor escribe `diagnosis.lastSim` (la de limite escribia
// `lastTurnSimilarity`): dos nombres para el mismo dato -> el instrumento no media nada.
//
// REGLA: UN nombre canonico del dato (`lastSim`) y UN dueno de la linea
// (`voiceIdentityResolve.formatIdentityDiagnosis`).
// ============================================================
import { describe, expect, it } from 'vitest'
import { resolveConversationSpeaker } from '../src/voice/lib/voiceIdentity.js'
import { formatIdentityDiagnosis } from '../src/voice/lib/voiceIdentityResolve.js'

/** Vector unitario en `dim` con el componente `i` a 1 (coseno 1 entre iguales). */
function unit(i: number, dim = 8): number[] {
  const out = new Array(dim).fill(0)
  out[i] = 1
  return out
}

describe('sonda lastSim: lee el campo que escriben las vias del resolutor', () => {
  it('(util) la via de LIMITE deja el lastSim REAL en el diagnostico', () => {
    const diagnosis: Record<string, unknown> = {}
    const v = unit(0)
    const resolver = resolveConversationSpeaker as unknown as (arg: Record<string, unknown>) => unknown
    resolver({
      signatureVector: v,
      speakerClusters: [{ label: 'Hablante 1', signature: v }],
      lastSpeaker: 'Hablante 1',
      lastSignature: v,
      atTurnBoundary: true,
      allowNewCluster: true,
      voicedSampleCount: 99999,
      minVoicedSamples: 1,
      minVoicedSamplesForNew: 1,
      diagnosis,
    })
    expect(typeof diagnosis.lastSim, 'el diagnostico expone el campo canonico').toBe('number')
    expect(Number(diagnosis.lastSim), 'la MISMA voz -> similitud alta, no 0').toBeGreaterThan(0.99)
  })

  it('(util) la linea del instrumento imprime el lastSim REAL (no 0.000)', () => {
    const linea = formatIdentityDiagnosis({ label: 'Hablante 1', diagnosis: { reason: 'production-x', lastSim: 0.713 }, lastSpeaker: 'Hablante 1', atTurnBoundary: true, workingClusters: [] })
    expect(linea).toContain('lastSim=0.713')
    expect(linea).not.toContain('lastSim=0.000')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): con el nombre VIEJO la sonda sigue ciega', () => {
    // El campo que el codigo leia antes no lo escribe la via principal: si el
    // diagnostico solo trae `lastTurnSimilarity`, el instrumento imprime 0.000.
    const viejo = formatIdentityDiagnosis({ label: 'Hablante 1', diagnosis: { lastTurnSimilarity: 0.713 } })
    expect(viejo, 'leyendo el nombre viejo quedaria CIEGO').toContain('lastSim=0.000')
  })
})
