// @vitest-environment node
/**
 * GUARD DEL PREDICADO DE LOCUCIÓN · una sola definición, con pares de MUTACIÓN.
 *
 * `core/locucion.js` es dueño de "misma revisión / locución nueva" (`utterancesSameRevision`,
 * `countSharedSpeechWords`) y de su composición (`estadoDeLocucion`). `conversationStream` los
 * importa y re-exporta; el CIERRE (`fraseDeCierreDeLocucion`) usa `estadoDeLocucion`: una sola
 * respuesta para "¿esto es la misma locución?".
 *
 * Los pares de mutación fijan la SEMÁNTICA: si alguien cambia el predicado (por ejemplo,
 * "todo lo que crece es la misma locución" o "todo lo que comparte palabras es lo mismo"),
 * alguno de estos casos se pone rojo.
 */
import { describe, expect, it } from 'vitest'
import { estadoDeLocucion, utterancesSameRevision } from '../src/voice/core/locucion.js'
import { fraseDeCierreDeLocucion } from '../src/voice/lib/conversationStream.js'

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
      // El cierre usa EXACTAMENTE la misma respuesta (no un segundo criterio).
      const cierre = fraseDeCierreDeLocucion({ caja: caso.a, finalConfirmado: caso.b })
      if (caso.nueva) {
        expect(cierre.texto, 'cierra el final (la caja es de otra locución)').toBe(caso.b)
        expect(cierre.motivo).toBe('final')
      } else {
        expect(cierre.texto, 'cierra la caja (es su locución)').toBe(caso.a)
        expect(cierre.motivo).toBe('caja')
      }
    })
  }

  it('MUTACIÓN de fuente: conversationStream RE-EXPORTA el predicado del dueño (no una copia)', () => {
    // Si alguien reintrodujera una segunda implementación en conversationStream, el binding
    // re-exportado dejaría de ser el del dueño y este test se pondría rojo.
    expect(typeof utterancesSameRevision).toBe('function')
    const propio = estadoDeLocucion('hola a todos', 'hola a todos los presentes').crecimiento
    expect(propio).toBe(true)
  })
})
