// ============================================================
// vozRendimientoVozGuard - GUARD del degradador MEDIDO (P9.6.2)
// ------------------------------------------------------------
// ANALISIS 2026-10-07 (peticion del dueno: "hay momentos que se alenta"):
//   (2) src/voice/lib/speakerClusters.js flattenChunksWindow copiaba el buffer
//       ENTERO (hasta 30 s = 11250 chunks = ~1,44 M muestras) y luego tomaba su
//       cola; esa copia corria en cada tick y en cada commit.
//
// FIX (sin ruta nueva): la ventana se calcula ANTES y se copian SOLO sus muestras.
//
// Corte 2026-10-26 (feature/conversacion-modulo-nuevo): la seccion P9.6 (1) de
// este guard se retiro con su dueno (turnIdentityPipeline.js, BORRADO en el
// commit 365eeef5). Quedan VIVOS el contrato de la ventana y su prueba de
// mutacion: flattenChunksWindow sigue consumido por src/voice/core/tramo.js,
// useFluVoiceAssistant.js y voiceIdentity.js.
// ============================================================
import { describe, it, expect } from 'vitest'
import { flattenChunksWindow } from '../src/voice/lib/speakerClusters.js'

describe('P9.6 (2) - la ventana de audio copia SOLO la ventana', () => {
  it('con un buffer saturado de 30 s no copia el buffer entero', () => {
    const chunks = Array.from({ length: 11250 }, (_, i) => {
      const c = new Float32Array(128)
      c[0] = i
      return c
    })
    const w = flattenChunksWindow(chunks, {
      totalSamples: 1_440_000,
      sinceSample: 0,
      maxSamples: 86_400, // 1.8 s
      minSamples: 43_200,
    })
    expect(w.length).toBe(86_400)
    expect(w.buffer.byteLength, 'no debe copiar los 30 s (5,76 MB)').toBeLessThan(86_400 * 4 * 2)
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('la ventana sigue siendo la COLA real del buffer (no recorta contenido)', () => {
    const chunks = [new Float32Array(10).fill(1), new Float32Array(10).fill(2), new Float32Array(10).fill(3)]
    const w = flattenChunksWindow(chunks, { totalSamples: 30, sinceSample: 0, maxSamples: 12, minSamples: 0 })
    expect(w.length).toBe(12)
    expect(Array.from(w).slice(-10).every((v) => v === 3)).toBe(true)
  })
})
