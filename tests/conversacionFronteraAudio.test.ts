// @vitest-environment node
/**
 * FRONTERA DE LOCUCIÓN — pruebas del DUEÑO ÚNICO (`src/voice/core/tramoDeLocucion.js`).
 *
 * Aquí solo se mide el módulo: (1) el detector VAD devuelve la posición del fin de habla y
 * (2) el predicado exige las DOS evidencias (quietud de la línea + texto ajeno). El
 * comportamiento de la tubería (una locución = una fila, final tardío, dos ids) se mide en
 * `tests/conversacionFronteraArnes.test.ts` con el ingress, el commit y la caja REALES.
 */
import { describe, expect, it } from 'vitest'
import { crearDetectorDeFronteras, hayFronteraDeAudio } from '../src/voice/core/tramoDeLocucion.js'

const LOCUCION_1 =
  'voy a decir El Comando para que sustituya todos los nombres todos mis intervenciones con con nombre propio Okay flu Soy Luis'
const LOCUCION_2 =
  'magistrado Luis ya le puso Luis a todo a todas las intervenciones Eso es correcto hasta aqui vamos bien'

const sampleRate = 16000
/** Silencio / tono de 200 Hz: dos locuciones separadas por 1,5 s de silencio. */
function audio(cortes: Array<[number, number]>, segundos = 6): Float32Array {
  const total = Math.round(sampleRate * segundos)
  const muestras = new Float32Array(total)
  for (const [desde, hasta] of cortes) {
    for (let i = Math.round(desde * sampleRate); i < Math.round(hasta * sampleRate); i += 1) {
      muestras[i] = Math.sin((2 * Math.PI * 200 * i) / sampleRate) * 0.3
    }
  }
  return muestras
}

describe('detector de fronteras de audio (dueño único: tramoDeLocucion)', () => {
  it('devuelve la posición (en muestras) donde el segmentador cerró la voz', () => {
    const detector = crearDetectorDeFronteras({ sampleRate })
    const bloque = audio([[0.5, 2], [3.5, 5]])

    let primera = 0
    for (let i = 0; i < bloque.length; i += sampleRate / 2) {
      const marca = detector.push(bloque.subarray(i, Math.min(bloque.length, i + sampleRate / 2)))
      if (!primera && marca > 0) primera = marca
    }

    expect(primera, 'hay una frontera de audio').toBeGreaterThan(0)
    // La primera locución acaba antes del silencio: la frontera cae entre 2 s y 3,5 s.
    expect(primera).toBeGreaterThan(Math.round(sampleRate * 2))
    expect(primera).toBeLessThanOrEqual(Math.round(sampleRate * 3.5))
  })

  it('MUTACIÓN: sin voz no hay frontera (no se inventa silencio)', () => {
    const detector = crearDetectorDeFronteras({ sampleRate })
    detector.push(audio([]))
    expect(detector.frontera()).toBe(0)
  })
})

describe('hayFronteraDeAudio — dos evidencias, ni una menos', () => {
  it('línea ABIERTA + quietud + texto ajeno = frontera', () => {
    expect(
      hayFronteraDeAudio({ lineaAbierta: LOCUCION_1, texto: LOCUCION_2, quietaMs: 1200, minQuietaMs: 900 }),
    ).toBe(true)
  })

  it('MUTACIÓN: sin la quietud mínima NO hay frontera (el ASR reinicia a media frase)', () => {
    expect(
      hayFronteraDeAudio({ lineaAbierta: LOCUCION_1, texto: LOCUCION_2, quietaMs: 200, minQuietaMs: 900 }),
    ).toBe(false)
  })

  it('la MISMA locución creciendo no es frontera', () => {
    expect(
      hayFronteraDeAudio({
        lineaAbierta: 'vamos a preparar la receta',
        texto: 'vamos a preparar la receta de pan',
        quietaMs: 2000,
        minQuietaMs: 900,
      }),
    ).toBe(false)
  })

  it('sin línea abierta no hay nada que cerrar', () => {
    expect(hayFronteraDeAudio({ lineaAbierta: '', texto: LOCUCION_2, quietaMs: 5000, minQuietaMs: 900 })).toBe(false)
  })

  it('sin texto no hay frontera (no se cierra por el reloj solo)', () => {
    expect(hayFronteraDeAudio({ lineaAbierta: LOCUCION_1, texto: '', quietaMs: 5000, minQuietaMs: 900 })).toBe(false)
  })
})
