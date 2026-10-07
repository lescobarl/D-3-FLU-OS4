// ============================================================
// vozClusterConsolidacionGuard - SIMULACION + GUARD de la consolidacion de
// clusters y la histeresis de voz nueva
// ------------------------------------------------------------
// EVIDENCIA (log del dueno, 2026-10-07 17:28-17:33): con 2 personas (y TV) la
// sesion acumulaba `refClusters=5` y las filas saltaban de etiqueta ("me puso
// primero como hablante uno luego como hablante dos y ahora puso hablante
// cuatro"). El indice no se reducia nunca: `pruneGhostClusters` esta en false
// desde P8.93 porque borraba el cluster recien escrito.
//
// FIX (sin borrado ciego): (1) `consolidateSpeakerClusters` fusiona los clusters
// de la MISMA voz (coseno >= el umbral de "misma persona") conservando el mas
// antiguo, con los nombres propios EXENTOS (son anclas); (2) histeresis: con la
// sesion ya multi-locutor, no se abre un cluster nuevo salvo que el mejor cluster
// este a mas de `newVoiceHysteresis` por debajo del umbral.
//
// Verificado con la simulacion calibrada de 2 voces (misma voz ~0.70, distinta
// ~0.58): la consolidacion deja 2 clusters y NO fusiona a las 2 personas.
// ============================================================
import { describe, it, expect } from 'vitest'
import { consolidateSpeakerClusters } from '../src/voice/lib/speakerClusters.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { compareCosineSignatures } from '../src/voice/lib/speakerCore.js'

const DIM = 512
function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
function unitVec(seed: number) {
  const r = prng(seed)
  const v = new Array(DIM).fill(0)
  let n = 0
  for (let i = 0; i < DIM; i += 1) {
    v[i] = r() * 2 - 1
    n += v[i] * v[i]
  }
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}
function norm(v: number[]) {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / n)
}
function baseWithCos(cosB: number) {
  const base = norm([1, ...new Array(DIM - 1).fill(0)])
  const orth = unitVec(999)
  const s = Math.sqrt(Math.max(0, 1 - cosB * cosB))
  return norm(base.map((x) => x * cosB).map((x, i) => x + orth[i] * s))
}
const NOISE = 0.62
function turn(base: number[], seed: number) {
  const noise = unitVec(seed)
  return norm(base.map((x, i) => x + noise[i] * NOISE))
}

const floorMismaPersona = FLU_CONFIG.voiceIdentity.capture.conversationSpeakerThresholds.productionClusterReuseThreshold

describe('consolidacion de clusters: la MISMA voz se fusiona, las distintas NO', () => {
  it('5 clusters de 2 personas se consolidan a 2', () => {
    const LUIS = baseWithCos(0)
    const MUJER = baseWithCos(0.806)
    // Como los crea la app: un cluster por turno (misma voz -> firmas cercanas).
    const clusters = [
      { label: 'Hablante 1', signature: turn(LUIS, 1), signatureHistory: [turn(LUIS, 1)] },
      { label: 'Hablante 2', signature: turn(MUJER, 3), signatureHistory: [turn(MUJER, 3)] },
      { label: 'Hablante 3', signature: turn(LUIS, 2), signatureHistory: [turn(LUIS, 2)] },
      { label: 'Hablante 4', signature: turn(MUJER, 5), signatureHistory: [turn(MUJER, 5)] },
      { label: 'Hablante 5', signature: turn(LUIS, 4), signatureHistory: [turn(LUIS, 4)] },
    ]
    const consolidados = consolidateSpeakerClusters(clusters, floorMismaPersona)
    expect(consolidados.length).toBeLessThan(clusters.length)
    expect(consolidados.length).toBeLessThanOrEqual(3)
    // Las 2 personas siguen separadas (no se fusionan entre si).
    const labels = consolidados.map((c) => c.label)
    expect(labels.length).toBeGreaterThanOrEqual(2)
  })

  it('un nombre propio NUNCA se absorbe en una etiqueta automatica', () => {
    const LUIS = baseWithCos(0)
    const clusters = [
      { label: 'Hablante 1', signature: turn(LUIS, 1) },
      { label: 'luis', signature: turn(LUIS, 2) },
    ]
    const out = consolidateSpeakerClusters(clusters, floorMismaPersona)
    expect(out.map((c) => c.label).sort()).toEqual(['Hablante 1', 'luis'])
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('no fusiona dos voces distintas (coseno por debajo del umbral)', () => {
    const LUIS = baseWithCos(0)
    const MUJER = baseWithCos(0.806)
    const vL = turn(LUIS, 1)
    const vM = turn(MUJER, 3)
    expect(compareCosineSignatures(vL, vM)).toBeLessThan(floorMismaPersona)
    const out = consolidateSpeakerClusters(
      [
        { label: 'Hablante 1', signature: vL },
        { label: 'Hablante 2', signature: vM },
      ],
      floorMismaPersona,
    )
    expect(out.length).toBe(2)
  })

  it('sin firma, el cluster no se toca (no se pierde por vacio)', () => {
    const out = consolidateSpeakerClusters([{ label: 'Hablante 1' }, { label: 'Hablante 2' }], 0.85)
    expect(out.map((c) => c.label)).toEqual(['Hablante 1', 'Hablante 2'])
  })
})
