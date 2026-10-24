// @vitest-environment node
/**
 * GUARD DE EQUIVALENCIA · el cierre usa la MISMA definición de "otra locución" que la etapa 2.
 *
 * `fraseDeCierreDeLocucion` no puede importar `core/locucion.js` (sería un ciclo:
 * locucion → conversationStream → locucion), así que usa el predicado del que
 * `estadoDeLocucion` se compone (`utterancesSameRevision`). Este guard fija que la condición
 * del cierre (`!utterancesSameRevision`) ES `estadoDeLocucion(...).locucionNueva`: si alguien
 * cambia una de las dos, el test se pone rojo.
 */
import { describe, expect, it } from 'vitest'
import { estadoDeLocucion } from '../src/voice/core/locucion.js'
import { utterancesSameRevision } from '../src/voice/lib/conversationStream.js'

const PARES: Array<[string, string]> = [
  ['voy a decir el comando para que sustituya todos los nombres', 'magistrado Luis ya le puso Luis a todo a las intervenciones'],
  ['quiero que me expliques con calma', 'quiero que me expliques con calma todos los pasos'],
  ['no vayas a hacer una tontería', 'no vayas a hacer una tontera'],
  ['Es algo extraño porque muchos de ustedes creo', 'papás de pollo frito coreano picante y estas son creo que de caramelo'],
]

describe('sin texto no hay estado (y el cierre ni compara)', () => {
  it('texto vacio: estadoDeLocucion no inventa estado y el cierre no llega a la condicion', () => {
    // `estadoDeLocucion('', x)` devuelve TODO false a proposito (no hay estado que decidir).
    // `fraseDeCierreDeLocucion` exige `mostrada && confirmada` antes de comparar, asi que la
    // equivalencia solo se aplica cuando los DOS textos existen.
    expect(estadoDeLocucion('', 'texto sin anterior')).toEqual({
      mismaRevision: false,
      crecimiento: false,
      locucionNueva: false,
    })
  })
})

describe('cierre y estado de locución: MISMA definición, un solo dueño', () => {
  for (const [anterior, nuevo] of PARES) {
    it(`"${anterior.slice(0, 28)}" → "${nuevo.slice(0, 28)}"`, () => {
      // La condición del cierre (que la caja sea de OTRA locución) es exactamente
      // `locucionNueva` del estado: no hay una segunda definición que pueda divergir.
      expect(!utterancesSameRevision(anterior, nuevo)).toBe(estadoDeLocucion(anterior, nuevo).locucionNueva)
    })
  }
})
