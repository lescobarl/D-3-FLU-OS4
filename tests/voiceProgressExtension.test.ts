/**
 * voiceProgressExtension — el comparador de revisión ASR que EXIGE crecimiento.
 *
 * Anexo B, invariante 14: `isProgressiveExtension` y `spokenUtteranceRevision`
 * son reglas DISTINTAS a propósito. Este fichero fija el comportamiento de la
 * primera con el caso real del log (residuo "tas de cafe"): una emisión que crece
 * respecto de la anterior es la MISMA locución, y por eso no se pela su prefijo.
 *
 * El guard del ingress que vivía aquí (que finales e interims usaran la MISMA
 * función) se retiró con la tubería vieja de conversación (corte 2026-10-25): ese
 * ingress ya no existe. En el módulo nuevo la decisión del texto de un turno tiene
 * dueño en `src/voice/conversation/texto.ts` y se mide en `conversacionProducto`.
 */
import { describe, expect, it } from 'vitest'
import { isProgressiveExtension } from '../src/voice/lib/conversationStream'

describe('voiceProgressExtension — crecimiento real de la misma emisión', () => {
  it('reconoce la extensión progresiva del caso real del log', () => {
    expect(
      isProgressiveExtension('busca en la web recetas de cafe', 'busca en la web rece'),
    ).toBe(true)
    expect(isProgressiveExtension('busca en la web recetas', 'cuéntame la capital')).toBe(false)
  })

  it('un texto que NO crece nunca es extensión progresiva (aunque comparta arranque)', () => {
    expect(isProgressiveExtension('busca en la web recetas', 'busca en la web recetas')).toBe(false)
    expect(isProgressiveExtension('busca en la web', 'busca en la web recetas de cafe')).toBe(false)
    expect(isProgressiveExtension('', 'busca en la web rece')).toBe(false)
  })
})
