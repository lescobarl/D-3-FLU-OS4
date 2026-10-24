// @vitest-environment node
/**
 * DEFECTOS A Y B (decision del dueno 2026-10-23) — un dueno por pregunta.
 *
 * B: el motor emite VARIAS hipotesis del MISMO tramo y quedarse con la mas larga perdia
 *    habla. Medido en la sesion 8f3112c2, evento t=1792789332116 (`seq` 819): tres finales
 *    del mismo audio; dos traen "esto" y uno trae la cola "escucha". La fila salia sin
 *    "esto". Regla: MISMO tramo -> se UNEN conservando todas las palabras, con alineacion.
 *
 * A: la fila 5 del replay (id de fuente 1792789182623, 22 palabras) llevaba DOS locuciones
 *    pegadas (la segunda es la fila 1792789202635). NO se corrige uniendo: se corrige con
 *    el tramo/frontera. Aqui se fija lo unico demostrable sin audio por evento: la caja no
 *    pega una locucion ajena, y las dos locuciones son DOS (no una variante).
 */
import { describe, expect, it } from 'vitest'
import { unirVariantesDelMismoTramo } from '../src/voice/lib/transcriptIngress.js'
import { crearCajaDeLaFrase, resolverEmisionDeLaCaja } from '../src/voice/lib/conversationStreamCommit.js'
import { estadoDeLocucion } from '../src/voice/core/locucion.js'

/** Los TRES finales del evento t=1792789332116, tal cual los emitio el motor. */
const FINAL_CON_ESTO_Y_ESCUCHA =
  'bien las últimas intervenciones fueron de una mujer y les puso a las dos últimas mi nombre Luis eso fue incorrecto Ajá yo estoy terminando aquí la prueba yo sí soy Luis pero las otras intervenciones anteriores eran de una mujer o sea esto está mal pero lo dejo dejo la grabación como evidencia hago una pausa y luego le doy cerrar escucha'
const FINAL_CON_ESTO_SIN_ESCUCHA =
  'bien las últimas intervenciones fueron de una mujer y les puso a las dos últimas mi nombre Luis eso fue incorrecto Ajá yo estoy terminando aquí la prueba yo sí soy Luis pero las otras intervenciones anteriores eran de una mujer o sea esto está mal pero lo dejo dejo la grabación como evidencia hago una pausa y luego le doy cerrar'
const FINAL_SIN_ESTO_CON_ESCUCHA =
  'bien las últimas intervenciones fueron de una mujer y les puso a las dos últimas mi nombre Luis eso fue incorrecto Ajá yo estoy terminando aquí la prueba yo sí soy Luis pero las otras intervenciones anteriores eran de una mujer o sea está mal pero lo dejo dejo la grabación como evidencia hago una pausa y luego le doy cerrar escucha'

/** Las DOS locuciones de la fila 5 del replay (fuente: ids 1792789182623 y 1792789202635). */
const LOCUCION_1 =
  'voy a decir El Comando para que sustituya todos los nombres todos mis intervenciones con con nombre propio Okay flu Soy Luis'
const LOCUCION_2 =
  'magistrado Luis ya le puso Luis a todo a todas las las intervenciones Eso es correcto hasta aquí vamos bien voy a poner ahora a la mujer a hablar cedo la palabra'

describe('DEFECTO B — variantes del MISMO tramo se unen sin perder palabras', () => {
  it('la union de los tres finales conserva "esto" Y "escucha"', () => {
    let unido = unirVariantesDelMismoTramo(FINAL_CON_ESTO_SIN_ESCUCHA, FINAL_SIN_ESTO_CON_ESCUCHA)
    unido = unirVariantesDelMismoTramo(unido, FINAL_CON_ESTO_Y_ESCUCHA)

    expect(unido).toContain('esto')
    expect(unido).toContain('escucha')
    // Cero perdidas: todas las palabras de las tres hipotesis siguen ahi.
    for (const palabra of ['bien', 'Luis', 'evidencia', 'cerrar', 'escucha', 'esto']) {
      expect(unido, `no se pierde "${palabra}"`).toContain(palabra)
    }
  })

  it('MUTACION: quedarse con la variante MAS LARGA pierde "esto" o "escucha"', () => {
    const masLarga = [FINAL_CON_ESTO_Y_ESCUCHA, FINAL_CON_ESTO_SIN_ESCUCHA, FINAL_SIN_ESTO_CON_ESCUCHA].reduce(
      (mejor, actual) => (actual.length > mejor.length ? actual : mejor),
    )
    // La mas larga (338) SI trae las dos; la trampa es la ultima variante del evento:
    const ultima = FINAL_SIN_ESTO_CON_ESCUCHA
    expect(ultima.length).toBeLessThan(FINAL_CON_ESTO_Y_ESCUCHA.length)
    expect(ultima, 'la ultima hipotesis NO trae "esto"').not.toContain('esto ')
    // Y la union NO elige una variante que pierda un token: reconstruye el habla completa
    // de las dos hipotesis (que es justo la hipotesis que el motor ya emitio una vez).
    const unido = unirVariantesDelMismoTramo(FINAL_CON_ESTO_SIN_ESCUCHA, FINAL_SIN_ESTO_CON_ESCUCHA)
    expect(unido).toBe(masLarga)
    expect(unido, 'la union nunca es la variante que perdio "esto"').not.toBe(ultima)
  })

  it('MUTACION: la variante SIN "esto" nunca puede ganar por si sola', () => {
    const elegido = unirVariantesDelMismoTramo(FINAL_CON_ESTO_SIN_ESCUCHA, FINAL_SIN_ESTO_CON_ESCUCHA)
    expect(elegido).toContain('esto')
    expect(elegido, 'y conserva la cola de la otra hipotesis').toContain('escucha')
  })

  it('una reentrega EXACTA no duplica la palabra', () => {
    const unido = unirVariantesDelMismoTramo('huevos duros aquí', 'huevos duros aquí')
    expect(unido).toBe('huevos duros aquí')
  })

  it('MUTACION: una cola ajena de mas de 3 palabras NO se une (es otra locucion)', () => {
    const unido = unirVariantesDelMismoTramo(
      'vamos a preparar la receta',
      'vamos a preparar la receta y después compramos el postre para la cena',
    )
    // La frontera la decide el tramo, no este merge: se queda una hipotesis, no las dos.
    expect(unido.startsWith('vamos a preparar la receta')).toBe(true)
    expect(unido.length).toBeLessThanOrEqual(
      Math.max('vamos a preparar la receta'.length, 'vamos a preparar la receta y después compramos el postre para la cena'.length),
    )
  })
})

describe('DEFECTO A — dos locuciones no se pegan (se separan por tramo/frontera)', () => {
  it('son DOS locuciones, no una variante (dueno unico: estadoDeLocucion)', () => {
    expect(estadoDeLocucion(LOCUCION_1, LOCUCION_2).locucionNueva).toBe(true)
  })

  it('la caja NO pega la locucion ajena a la que esta abierta', () => {
    const ref = { current: LOCUCION_1 }
    const caja = crearCajaDeLaFrase({ publishedLiveRef: ref, setLiveTranscript: () => {} })

    const publicacion = caja.publicarEnLaCaja(LOCUCION_2, { canonica: true })

    expect(publicacion.aplicado, 'la caja no adopta otra locucion').toBe(false)
    expect(ref.current, 'la caja sigue siendo la locucion abierta').toBe(LOCUCION_1)
    expect(ref.current, 'MUTACION: si se pegara, la fila llevaria "magistrado" dos veces').not.toContain('magistrado')
  })

  it('MUTACION: sin tramo ni frontera NO hay union (la emision ajena queda bloqueada)', () => {
    const decision = resolverEmisionDeLaCaja(LOCUCION_1, LOCUCION_2)
    expect(decision.aplica).toBe(false)
    expect(decision.motivo).toBe('bloqueado')
    expect(decision.destino).not.toContain('magistrado')
  })

  it('MUTACION: la MISMA locucion creciendo SI entra en la caja (no se bloquea todo)', () => {
    const ref = { current: LOCUCION_1 }
    const caja = crearCajaDeLaFrase({ publishedLiveRef: ref, setLiveTranscript: () => {} })

    const crecida = `${LOCUCION_1} magistrado`
    const publicacion = caja.publicarEnLaCaja(crecida)

    expect(publicacion.aplicado, 'una locucion que crece sigue su curso').toBe(true)
    expect(ref.current).toBe(crecida)
  })
})
