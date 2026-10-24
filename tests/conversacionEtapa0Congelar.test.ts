// @vitest-environment node
/**
 * ETAPA 0 · CONGELAR EL COMPORTAMIENTO (el contrato, no el código viejo).
 *
 * Línea base CRUDA medida hoy sobre la grabación del dueño `8f3112c2` (5 min, código
 * `3b896335`). No se usa el reporte del triage: son números crudos, escritos aquí a mano.
 *
 *   audio 287,9 s · sesión 616,3 s · faltan 328,4 s          ← defecto del sink (corregido)
 *   23 commits · 13 textos únicos · 10 duplicados (43 %)     ← una fila por emisión del ASR
 *   0 de 23 con medida de voz · etiquetas: 22 `Hablante 1` + 1 `Luis`
 *   8 de 23 con tramo 0 · finales del ASR dentro de un tramo: 6/23
 *
 * Los CASOS RAROS se congelan aquí y se ejecutan: si una etapa futura los cambia sin
 * decisión escrita, este test se pone rojo.
 */
import { describe, expect, it } from 'vitest'
import { estadoDeLocucion } from '../src/voice/core/locucion.js'
import { tramosDeAudio } from '../src/voice/lib/asr/voiceActivitySegmenter.js'

/** Casos raros REALES de la grabación: [anterior, nuevo, qué son]. */
const CASOS: Array<[string, string, 'revision' | 'crecimiento' | 'nueva']> = [
  ['Qué pasó', 'Qué pasó el juez me sacó', 'crecimiento'],
  ['no vayas a hacer una tontería', 'no vayas a hacer una tontera', 'revision'],
  ['Qué pasó', 'no vayas a hacer una tontería', 'nueva'],
  ['tenías razón', 'Tenías razón está bien', 'crecimiento'],
]

describe('ETAPA 0 · casos raros congelados', () => {
  for (const [anterior, nuevo, clase] of CASOS) {
    it(`"${anterior}" → "${nuevo}" es ${clase}`, () => {
      const estado = estadoDeLocucion(anterior, nuevo)
      // La pregunta que DECIDE es `locucionNueva`; las otras dos se solapan a proposito
      // (un crecimiento tambien es 'misma revision' para el ASR: es el mismo audio).
      expect(estado.locucionNueva, `${clase}: abre otra locucion`).toBe(clase === 'nueva')
      if (clase === 'crecimiento') expect(estado.crecimiento, 'crecimiento').toBe(true)
      if (clase === 'revision') expect(estado.mismaRevision, 'revision').toBe(true)
    })
  }
})

describe('ETAPA 0 · el tramo es determinista sobre audio sintético', () => {
  const sampleRate = 16000
  /** Silencio / tono de 200 Hz: dos locuciones separadas por 1,5 s de silencio. */
  function audio(cortes: Array<[number, number]>): Float32Array {
    const total = Math.round(sampleRate * 6)
    const muestras = new Float32Array(total)
    for (const [desde, hasta] of cortes) {
      for (let i = Math.round(desde * sampleRate); i < Math.round(hasta * sampleRate); i += 1) {
        muestras[i] = Math.sin((2 * Math.PI * 200 * i) / sampleRate) * 0.3
      }
    }
    return muestras
  }

  it('dos tramos separados salen como DOS tramos disjuntos', () => {
    const tramos = tramosDeAudio(audio([[0.5, 2], [3.5, 5]]), sampleRate)
    expect(tramos.length).toBe(2)
    expect(tramos[0].finMs).toBeLessThanOrEqual(tramos[1].inicioMs)
    for (const tramo of tramos) expect(tramo.finMs - tramo.inicioMs).toBeGreaterThan(300)
  })

  it('MUTACIÓN: el silencio solo NO produce tramos (no se inventa audio)', () => {
    expect(tramosDeAudio(audio([]), sampleRate)).toEqual([])
  })
})
