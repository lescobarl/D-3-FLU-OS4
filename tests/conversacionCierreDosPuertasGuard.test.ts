// BARRERA: cierre-dos-puertas
/**
 * conversacionCierreDosPuertasGuard — la locución cierra por DOS puertas, no tres.
 *
 * El cierre de una locución abierta solo puede llegar por voz medida DISTINTA
 * (partición, Caso 1+3) o por silencio medido ≥ `silenceCloseMs`. La tercera
 * puerta (un `final` del ASR cerrando la locución anterior en el acto) quedó
 * RETIRADA: un final MARCA la frase completa pero no cierra, y el texto ajeno
 * no cierra por sí solo (se retiene como pendiente).
 *
 * Mide la frontera REAL y cuenta los `return { cerrar: true }`: deben ser DOS.
 * FALSIFICACIÓN: una tercera puerta re-introducida sube el conteo a 3 y el
 * guard falla.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decidirFrontera } from '../src/voice/conversation/frontera.ts'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports.ts'

const FRONTERA = readFileSync(
  join(process.cwd(), 'src/voice/conversation/frontera.ts'),
  'utf8',
)
const INGESTA = readFileSync(
  join(process.cwd(), 'src/voice/conversation/ingesta.ts'),
  'utf8',
)

/** Puertas de cierre de la frontera: cada `return { cerrar: true }`. */
function puertasDeCierre(src: string): number {
  return (src.match(/return\s*\{\s*cerrar:\s*true/g) ?? []).length
}

describe('conversación — el cierre tiene SOLO dos puertas', () => {
  it('frontera.ts devuelve EXACTAMENTE dos cierres: voz medida y silencio medido', () => {
    expect(puertasDeCierre(FRONTERA)).toBe(2)
    expect(FRONTERA).toContain("causa: 'voz'")
    expect(FRONTERA).toContain("entrada.textoAjeno ? 'frontera' : 'silencio'")
  })

  it('la puerta del final de frase quedó retirada del módulo entero', () => {
    expect(FRONTERA).not.toContain('finalDeFrase')
    expect(INGESTA).not.toContain('finalDeFrase')
  })

  it('la frontera real decide: voz distinta cierra ya; el texto ajeno no cierra sin silencio', () => {
    expect(
      decidirFrontera({
        medida: { hayVoz: true, silencioMs: 0 },
        textoAjeno: false,
        abierta: true,
        cambioVoz: true,
      }),
    ).toEqual({ cerrar: true, causa: 'voz' })
    // Con voz presente en la medida no se cierra por tiempo: la voz gana.
    expect(
      decidirFrontera({
        medida: { hayVoz: true, silencioMs: 0 },
        textoAjeno: false,
        abierta: true,
      }),
    ).toEqual({ cerrar: false, causa: null })
    // El texto ajeno por sí solo NO cierra (era la tercera puerta).
    expect(
      decidirFrontera({
        medida: { hayVoz: false, silencioMs: 200 },
        textoAjeno: true,
        abierta: true,
      }),
    ).toEqual({ cerrar: false, causa: null })
    // Solo el silencio medido cierra; el texto ajeno elige la causa.
    expect(
      decidirFrontera({
        medida: { hayVoz: false, silencioMs: CONVERSACION_CONFIG.silenceCloseMs },
        textoAjeno: true,
        abierta: true,
      }),
    ).toEqual({ cerrar: true, causa: 'frontera' })
    expect(
      decidirFrontera({
        medida: { hayVoz: false, silencioMs: CONVERSACION_CONFIG.silenceCloseMs },
        textoAjeno: false,
        abierta: true,
      }),
    ).toEqual({ cerrar: true, causa: 'silencio' })
    expect(
      decidirFrontera({
        medida: { hayVoz: true, silencioMs: 0 },
        textoAjeno: false,
        abierta: false,
      }),
    ).toEqual({ cerrar: false, causa: null })
  })

  it('FALSIFICACIÓN: una tercera puerta re-introducida sube el conteo y falla', () => {
    const conTerceraPuerta =
      FRONTERA + "\nif (entrada.finalDeFrase) return { cerrar: true, causa: 'frontera' }"
    expect(puertasDeCierre(conTerceraPuerta)).toBe(3)
    expect(puertasDeCierre(FRONTERA)).toBe(2)
  })
})
