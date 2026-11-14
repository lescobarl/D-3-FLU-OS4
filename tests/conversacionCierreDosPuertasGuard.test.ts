// BARRERA: cierre-dos-puertas
/**
 * conversacionCierreDosPuertasGuard — la locución cierra por DOS puertas, no tres.
 *
 * El cierre de una locución abierta solo puede llegar por voz medida DISTINTA
 * (partición, Caso 1+3) o por TIEMPO. El tiempo tiene DOS medidas del mismo
 * eje: el silencio —VAD medido (>= `silenceCloseMs`, puerta de abajo) o
 * confirmación del final (silencio de RELOJ >= `finalCloseConfirmMs` desde el
 * final del ASR aplicado, sin voz en el camino)— o el TOPE de duración
 * (`maxLocutionMs`, causa `maximo`): la frase que sigue ganando voz se parte a
 * los 12 s para que el respaldo transcriba ventanas medibles (contrato ASR
 * local §5-quinquies). El final MARCA la frase y ARMA la ventana del silencio,
 * pero no cierra por contenido (mandato 2026-10-30). La tercera puerta (un
 * `final` del ASR cerrando la locución anterior en el acto) quedó RETIRADA: el
 * texto ajeno no cierra por sí solo (se retiene como pendiente).
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
  it('frontera.ts devuelve EXACTAMENTE dos cierres: voz medida y TIEMPO medido', () => {
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
        finalDesdeMs: 10_000,
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

  it('la confirmación del final adelanta la puerta del silencio, pero el final por sí solo NO cierra', () => {
    const confirmado = Number(CONVERSACION_CONFIG.finalCloseConfirmMs)
    expect(confirmado).toBeGreaterThan(0)
    expect(confirmado).toBeLessThan(CONVERSACION_CONFIG.silenceCloseMs)
    // Final aplicado + silencio de reloj suficiente SIN voz: cierra por silencio
    // aunque el VAD todavía no haya medido `silenceCloseMs`.
    expect(
      decidirFrontera({
        medida: { hayVoz: false, silencioMs: 0 },
        textoAjeno: false,
        abierta: true,
        finalDesdeMs: confirmado,
      }),
    ).toEqual({ cerrar: true, causa: 'silencio' })
    // La ventana a la mitad NO cierra: el silencio no confirmó todavía.
    expect(
      decidirFrontera({
        medida: { hayVoz: false, silencioMs: 0 },
        textoAjeno: false,
        abierta: true,
        finalDesdeMs: confirmado - 1,
      }),
    ).toEqual({ cerrar: false, causa: null })
    // Sin marca de final (entrada ausente) la puerta 2 solo mide el VAD.
    expect(
      decidirFrontera({
        medida: { hayVoz: false, silencioMs: 0 },
        textoAjeno: false,
        abierta: true,
      }),
    ).toEqual({ cerrar: false, causa: null })
    // Con el umbral apagado (<= 0) la ventana de confirmación no existe.
    expect(
      decidirFrontera(
        {
          medida: { hayVoz: false, silencioMs: 0 },
          textoAjeno: false,
          abierta: true,
          finalDesdeMs: 10_000,
        },
        { minSilenceMs: 900, silenceCloseMs: 3500, finalCloseConfirmMs: 0 },
      ),
    ).toEqual({ cerrar: false, causa: null })
  })

  it('FALSIFICACIÓN: una tercera puerta re-introducida sube el conteo y falla', () => {
    const conTerceraPuerta =
      FRONTERA + "\nif (entrada.finalDeFrase) return { cerrar: true, causa: 'frontera' }"
    expect(puertasDeCierre(conTerceraPuerta)).toBe(3)
    expect(puertasDeCierre(FRONTERA)).toBe(2)
  })
})
