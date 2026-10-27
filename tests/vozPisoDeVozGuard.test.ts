// ============================================================
// P9.71 - el "piso de voz" de la diarizacion es de VOZ, no de LONGITUD de ventana.
// MEDIDO (auditoria 2026-10-12): `voiceIdWorkerClient.js` pasaba `sourceLength` (longitud)
// como `voicedSampleCount` y `conversationMinVoicedMs: 350` == el minimo del embedder ->
// CUALQUIER ventana aceptada pasaba el piso, incluida una de TV/silencio. El piso de VOZ
// exige contar lo VIVO (`countVoicedSamples`). NACE ROJO: antes se pasaba `sampleCount`.
//
// REANCLA DE LA FUENTE (corte 2026-10-26): el resolutor idle (`resolveIdentityIdle`) se
// retiro con la diarizacion en idle (tuberia vieja); su expectativa aqui quedaba atada al
// dueno muerto. El dueno vivo del piso es el embebedor del PRODUCTO
// (`crearEmbebedorProducto`, src/voice/conversation/adapters.ts): recorta la ventana de
// VOZ con el dueno unico (`selectVoicedWindow`) ANTES de embeder
// (`embedAudioForDiarization`), de modo que la longitud de la captura nunca atraviese el
// piso. El guard se reancla a esa fuente; la conducta (contar muestras vivas) no cambia.
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countVoicedSamples } from '../src/voice/lib/voicedActivity.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

describe('P9.71 - el piso de voz es de VOZ, no de longitud de ventana', () => {
  it('silencio -> 0 muestras de voz (el piso lo rechaza)', () => {
    expect(countVoicedSamples(new Float32Array(16000), { sampleRate: 16000 })).toBe(0)
  })

  it('voz (energia) -> cuenta las muestras vivas', () => {
    const v = new Float32Array(16000)
    for (let i = 0; i < v.length; i++) v[i] = 0.5 * Math.sin(i * 0.1)
    expect(countVoicedSamples(v, { sampleRate: 16000 })).toBeGreaterThan(0)
  })

  it('FUENTE: el embebedor del producto mide la ventana de VOZ (nunca la captura cruda)', () => {
    const src = readFileSync(join(process.cwd(), 'src/voice/conversation/adapters.ts'), 'utf8')
    expect(src, 'el piso de voz: la ventana la recorta el dueno unico').toMatch(/selectVoicedWindow\(muestras, \{ sampleRate \}\)/)
    expect(src, 'solo la ventana de VOZ se embebe').toMatch(/embedAudioForDiarization\(ventanaVoz, sampleRate\)/)
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

// ============================================================
// P9.72 - UN SOLO DUENO del umbral de voz (el del VAD del ASR).
// MEDIDO (auditoria 2026-10-12): `voicedRmsFloor: 0.01` (config propia) era MAS permisivo que
// `transcript.asr.vad.energyThreshold` (0.02) -> TV/ambiente contaba como voz. Prueba RELACIONAL
// (no fija el valor de calibracion: lo lee del dueno unico) y NACE ROJA contra el umbral propio.
// ============================================================
describe('P9.72 - el piso de voz por defecto es el del dueno unico (VAD)', () => {
    const floor = Number((FLU_CONFIG as never as { transcript: { asr: { vad: { energyThreshold: number } } } }).transcript.asr.vad.energyThreshold)

    function rmsTone(rms: number, n = 16000) {
        const a = new Float32Array(n)
        const amp = rms * Math.SQRT2
        for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * 180 * i) / 16000)
        return a
    }

    it('por DEBAJO del umbral del VAD no cuenta como voz; por ENCIMA si', () => {
        const debajo = countVoicedSamples(rmsTone(floor * 0.7), { sampleRate: 16000 })
        const encima = countVoicedSamples(rmsTone(floor * 1.3), { sampleRate: 16000 })
        console.log(`  umbral (VAD)=${floor} · debajo=${debajo} · encima=${encima}`)
        expect(debajo, 'el piso no puede ser mas permisivo que el VAD').toBe(0)
        expect(encima).toBeGreaterThan(0)
    })

    it('no hay un segundo umbral de voz en la config del embedder', () => {
        const emb = (FLU_CONFIG as never as { voiceIdentity: { capture: { embedding: Record<string, unknown> } } }).voiceIdentity.capture.embedding
        console.log(`  claves del embedding: ${Object.keys(emb).join(', ')}`)
        expect(Object.keys(emb), 'un dato = una clave: sin `voicedRmsFloor`').not.toContain('voicedRmsFloor')
    })
})
