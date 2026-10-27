// @vitest-environment node
/**
 * GUARD DEL PREDICADO DE LOCUCIÓN · una sola definición, con pares de MUTACIÓN.
 *
 * `core/locucion.js` es dueño de "misma revisión / locución nueva" (`utterancesSameRevision`,
 * `countSharedSpeechWords`) y de su composición (`estadoDeLocucion`). Corte 2026-10-26: el
 * acoplamiento con el CIERRE viejo (`fraseDeCierreDeLocucion`, conversationStream.js) se
 * retira con la tubería vieja; el consumidor VIVO que delega en el dueño es
 * `core/tramoDeLocucion.js` (importa `estadoDeLocucion` de `locucion.js`).
 *
 * Los pares de mutación fijan la SEMÁNTICA: si alguien cambia el predicado (por ejemplo,
 * "todo lo que crece es la misma locución" o "todo lo que comparte palabras es lo mismo"),
 * alguno de estos casos se pone rojo.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { estadoDeLocucion } from '../src/voice/core/locucion.js'

describe('predicado de locución: semántica fijada con pares de mutación', () => {
  const casos: Array<{ a: string; b: string; nueva: boolean; porque: string }> = [
    {
      a: 'voy a decir el comando para que sustituya todos los nombres',
      b: 'magistrado Luis ya le puso Luis a todo a las intervenciones',
      nueva: true,
      porque: 'dos locuciones sin palabras en común son locuciones DISTINTAS',
    },
    {
      a: 'quiero que me expliques con calma',
      b: 'quiero que me expliques con calma todos los pasos',
      nueva: false,
      porque: 'el dictado que crece sigue siendo la misma locución',
    },
    {
      a: 'no vayas a hacer una tontería',
      b: 'no vayas a hacer una tontera',
      nueva: false,
      porque: 'una revisión del ASR (typo) es la misma locución',
    },
    {
      a: 'vamos a comer',
      b: 'a comer vamos',
      nueva: true,
      porque: 'compartir palabras NO es la misma locución (el orden manda)',
    },
    {
      a: 'hola a todos',
      b: 'hola a todos',
      nueva: false,
      porque: 'el mismo texto es la misma locución',
    },
    {
      a: 'papás de pollo frito coreano picante',
      b: 'Es algo extraño porque muchos de ustedes creo',
      nueva: true,
      porque: 'el caso real del cierre: la caja tenía la SIGUIENTE locución',
    },
  ]

  for (const caso of casos) {
    it(`${caso.porque}`, () => {
      expect(estadoDeLocucion(caso.a, caso.b).locucionNueva).toBe(caso.nueva)
    })
  }

  it('MUTACIÓN de fuente: el consumidor vivo DELEGA en el dueño (no re-implementa el predicado)', () => {
    // Si alguien reintrodujera una segunda implementación del predicado en el consumidor
    // vivo, dejaría de importar al dueño y este test se pondría rojo.
    const consumidor = readFileSync(join(process.cwd(), 'src/voice/core/tramoDeLocucion.js'), 'utf8')
    expect(consumidor, 'el consumidor usa el predicado del dueno').toContain('estadoDeLocucion')
    expect(consumidor, 'y lo importa del dueno (core/locucion.js)').toContain("from './locucion.js'")
    const propio = estadoDeLocucion('hola a todos', 'hola a todos los presentes').crecimiento
    expect(propio).toBe(true)
  })
})
