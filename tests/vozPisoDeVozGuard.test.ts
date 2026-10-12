// ============================================================
// P9.71 - el "piso de voz" de la diarizacion es de VOZ, no de LONGITUD de ventana.
// MEDIDO (auditoria 2026-10-12): `voiceIdWorkerClient.js` pasaba `sourceLength` (longitud)
// como `voicedSampleCount` y `conversationMinVoicedMs: 350` == el minimo del embedder ->
// CUALQUIER ventana aceptada pasaba el piso, incluida una de TV/silencio. El piso de VOZ
// exige contar lo VIVO (`countVoicedSamples`). NACE ROJO: antes se pasaba `sampleCount`.
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countVoicedSamples } from '../src/voice/lib/voicedActivity.js'

describe('P9.71 - el piso de voz es de VOZ, no de longitud de ventana', () => {
  it('silencio -> 0 muestras de voz (el piso lo rechaza)', () => {
    expect(countVoicedSamples(new Float32Array(16000), { sampleRate: 16000 })).toBe(0)
  })

  it('voz (energia) -> cuenta las muestras vivas', () => {
    const v = new Float32Array(16000)
    for (let i = 0; i < v.length; i++) v[i] = 0.5 * Math.sin(i * 0.1)
    expect(countVoicedSamples(v, { sampleRate: 16000 })).toBeGreaterThan(0)
  })

  it('FUENTE: el worker pasa el conteo de VOZ (no `sampleCount`) al resolutor', () => {
    const src = readFileSync(join(process.cwd(), 'src/voice/lib/voiceIdWorkerClient.js'), 'utf8')
    expect(src, 'debe pasar `voiced`').toMatch(/resolveIdentityIdle\(vector, matchPayload, sampleRate, voiced\)/)
    expect(src, 'no debe pasar la longitud').not.toMatch(/resolveIdentityIdle\(vector, matchPayload, sampleRate, sampleCount\)/)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): silencio uniforme no cuenta como voz', () => {
    const ruido = new Float32Array(8000)
    ruido.fill(0.001)
    expect(countVoicedSamples(ruido, { sampleRate: 16000, rmsFloor: 0.01 })).toBe(0)
    const voz = new Float32Array(8000)
    voz.fill(0.2)
    expect(countVoicedSamples(voz, { sampleRate: 16000, rmsFloor: 0.01 })).toBe(8000)
  })
})
