// @vitest-environment node
/**
 * ETAPA 1 · FIXTURE DEL TRAMO.
 *
 * El tramo de la locución sale de la **ventana con voz** de este turno
 * (`tramoDelTurno` → `ventanaConVoz`), no de restar contadores. Se fija con audio
 * sintético determinista: silencio + voz + silencio → el tramo cubre SOLO la voz; sin voz
 * no hay tramo válido (se declara, no se inventa).
 */
import { describe, expect, it } from 'vitest'
import { tramoDelTurno } from '../src/voice/core/tramo.js'
import { ventanaConVoz } from '../src/voice/lib/voicedActivity.js'

const RATE = 16000

/** Audio de `segundos` con un tono de 200 Hz entre `desde` y `hasta` (segundos). */
function audio(segundos: number, desde: number, hasta: number): Float32Array {
  const total = Math.round(segundos * RATE)
  const muestras = new Float32Array(total)
  if (hasta > desde) {
    for (let i = Math.round(desde * RATE); i < Math.round(hasta * RATE); i += 1) {
      muestras[i] = Math.sin((2 * Math.PI * 200 * i) / RATE) * 0.35
    }
  }
  return muestras
}

describe('ETAPA 1 · el tramo es la ventana con voz, no la resta de contadores', () => {
  it('silencio + voz + silencio: el tramo cubre SOLO la voz', () => {
    const ventana = audio(3, 1, 2) // 1 s de voz en el segundo 1..2
    const tramo = tramoDelTurno({ chunks: [ventana], totalSamples: ventana.length, sinceSample: 0, sampleRate: RATE })

    expect(tramo.tramoValido).toBe(true)
    const inicioMs = (tramo.audioStartSample / RATE) * 1000
    const finMs = (tramo.audioEndSample / RATE) * 1000
    // El tramo arranca dentro del segundo de voz y no se lleva el silencio entero.
    expect(inicioMs).toBeGreaterThanOrEqual(900)
    expect(inicioMs).toBeLessThanOrEqual(1200)
    expect(finMs).toBeGreaterThanOrEqual(1900)
    expect(finMs).toBeLessThanOrEqual(2200)
  })

  it('MUTACIÓN: sin voz no hay tramo válido (se declara, no se inventa)', () => {
    const silencio = audio(2, 0, 0)
    const tramo = tramoDelTurno({ chunks: [silencio], totalSamples: silencio.length, sinceSample: 0, sampleRate: RATE })
    expect(tramo.tramoValido).toBe(false)
  })

  it('MUTACIÓN: sin audio no hay tramo (ni ceros silenciosos)', () => {
    const tramo = tramoDelTurno({ chunks: [], totalSamples: 0, sinceSample: 0, sampleRate: RATE })
    expect(tramo.tramoValido).toBe(false)
    expect(tramo.audioEndSample - tramo.audioStartSample).toBe(0)
  })

  it('la ventana respeta la marca de inicio del turno (no mide audio previo)', () => {
    // 4 s de audio: voz en 0..1 s (turno anterior) y voz en 3..4 s (este turno).
    const muestras = audio(4, 0, 1)
    for (let i = Math.round(3 * RATE); i < muestras.length; i += 1) {
      muestras[i] = Math.sin((2 * Math.PI * 200 * i) / RATE) * 0.35
    }
    const marca = Math.round(2.5 * RATE)
    const tramo = tramoDelTurno({ chunks: [muestras], totalSamples: muestras.length, sinceSample: marca, sampleRate: RATE })
    expect(tramo.tramoValido).toBe(true)
    expect(tramo.audioStartSample, 'el tramo empieza DESPUES de la marca del turno').toBeGreaterThanOrEqual(marca)
  })

  it('ventanaConVoz devuelve bordes en muestras y avisa si hay voz', () => {
    const ventana = audio(2, 0.5, 1.5)
    const { inicio, fin, hayVoz } = ventanaConVoz(ventana, { sampleRate: RATE })
    expect(hayVoz).toBe(true)
    expect(inicio).toBeGreaterThan(0)
    expect(fin).toBeLessThanOrEqual(ventana.length)
    expect(fin - inicio).toBeGreaterThanOrEqual(Math.round(0.8 * RATE))
  })
})
