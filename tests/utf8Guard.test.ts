/**
 * P6.18 - utf8Guard: los ficheros de texto de src/ son UTF-8 valido.
 *
 * MEDIDO en base 27bda1f: 1 fichero de src/ no es UTF-8 valido (src/styles/
 * unified.css) con 12 bytes fuera de UTF-8, todos dentro de COMENTARIOS CSS:
 *   0xED -> 'i' acentuada (5)   0xF3 -> 'o' acentuada (3)
 *   0xF1 -> 'n' con tilde (2)   0x97 -> guion largo, cp1252 (2)
 * Los contextos no dejan duda (son palabras): "Línea separadora", "Pizarrón",
 * "pestañas", "próximos", "viñeta", "sólido", "por día", "multilínea",
 * "SEMANA — columnas por día". Se reescriben a UTF-8 en el sitio equivalente.
 *
 * Por que es un item y no un detalle: un fichero que no es UTF-8 no se puede leer
 * con la herramienta normal. En esta sesion bloqueo lecturas reales (Python
 * reventaba y la consola mostraba "L?nea"). Y el error ESCONDE los demas: el
 * decodificador se para en el primer byte malo, asi que un recuento se queda
 * corto (mi primer numero fue 5; eran 12). Eso es lo que hace que "son solo unos
 * bytes en un comentario" acabe siendo un sitio donde se pierde el tiempo.
 *
 * El guard se prueba con entradas sinteticas (prueba de mutacion: el detector
 * tiene que discriminar, no estar en verde por mirar otra cosa).
 */
import { describe, expect, it } from 'vitest'
import { EXT, esUtf8Valido, ficherosNoUtf8 } from '../scripts/utf8-metric.mjs'

/** Bytes ASCII de un comentario CSS, con o sin los bytes problematicos. */
const COMENTARIO = (cuerpo: number[]) =>
  new Uint8Array([0x2f, 0x2a, 0x20, ...cuerpo, 0x20, 0x2a, 0x2f])

describe('P6.18 utf8Guard - src/ es UTF-8 valido', () => {
  it('el detector distingue valido de invalido (prueba de mutacion)', () => {
    expect(esUtf8Valido(new TextEncoder().encode('/* Línea — día */'))).toBe(true)
    // Los 4 bytes que aparecian, sueltos: latin-1 y el guion de cp1252.
    expect(esUtf8Valido(COMENTARIO([0xed]))).toBe(false)
    expect(esUtf8Valido(COMENTARIO([0xf3]))).toBe(false)
    expect(esUtf8Valido(COMENTARIO([0xf1]))).toBe(false)
    expect(esUtf8Valido(COMENTARIO([0x97]))).toBe(false)
    // Su version bien codificada pasa.
    expect(esUtf8Valido(new TextEncoder().encode('/* Línea */'))).toBe(true)
    expect(esUtf8Valido(new TextEncoder().encode('/* — */'))).toBe(true)
  })

  it('la lista de extensiones no esta vacia y cubre lo que hay en src/', () => {
    expect(EXT.length).toBeGreaterThan(4)
    expect(EXT).toContain('.css')
  })

  it('ningun fichero de texto de src/ tiene bytes fuera de UTF-8', () => {
    const malos = ficherosNoUtf8('src')
    expect(malos, `ficheros no-UTF-8 en src/:\n  ${malos.join('\n  ')}`).toEqual([])
  })
})
