// @vitest-environment node
// ============================================================
// vozCajaFraseViva — la caja de ULTIMA FRASE del modo PASIVO: completa palabras,
// admite la revision del ASR y no fabrica frases que nadie dijo.
// ------------------------------------------------------------
// Recortado al cortar la tuberia vieja de conversacion (2026-10-25): los casos que
// montaban `handleConversationStreamSync` (filas y cierre del stream) ya no existen.
// En CONVERSACION la frase viva la escribe el modulo; esta caja es la del modo
// pasivo y su unico consumidor es `crearCajaDeLaFrase`. Se conservan los defectos
// medidos que la caja cierra:
//  1. DUPLICACION: la caja mostraba "du dupli duplica" (`colaNuevaTrasSolape` sabia
//     anadir cola pero no COMPLETAR la palabra que crece).
//  2. CONGELAMIENTO: bloqueaba cualquier emision mas corta o corregida mientras el
//     turno estaba abierto.
//  3. FABRICACION: un arranque compartido no es una reentrega.
//  4. La frase CANONICA (cierre/final confirmado) es la unica emision autorizada a
//     SUSTITUIR lo mostrado, y nunca si el boceto ya lleva habla ajena.
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  colaNuevaTrasSolape,
  crearCajaDeLaFrase,
  palabraQueCrece,
  reentregaLoMostrado,
  resolverEmisionDeLaCaja,
} from '../src/voice/lib/conversationStreamCommit.js'

const FRASE =
  'el mismo escenario en donde cuando es una frase larga de repente la borra completa de la transcripcion'

/**
 * Caja REAL con el espejo visible instrumentado (mismo contrato que el hook):
 * una sola instancia para todo el caso, como en produccion.
 * @returns {{ caja: object, mostrado: string[], publishedLiveRef: { current: string } }}
 */
function cajaNueva() {
  const mostrado: string[] = []
  const publishedLiveRef = { current: '' }
  const caja = crearCajaDeLaFrase({
    publishedLiveRef,
    activeTurnIdRef: { current: 1 },
    setLiveTranscript: (valor: string) => mostrado.push(String(valor)),
    scheduleLiveTranscriptUpdate: (valor: string) => mostrado.push(String(valor)),
  })
  return { caja, mostrado, publishedLiveRef }
}

const ultimo = (mostrado: string[]) => mostrado[mostrado.length - 1] || ''

describe('A - completar la palabra que crece, no pegarla', () => {
  it('`palabraQueCrece` distingue el crecimiento del doble legitimo', () => {
    expect(palabraQueCrece('du', 'dupli')).toBe(true)
    expect(palabraQueCrece('dupli', 'duplica')).toBe(true)
    expect(palabraQueCrece('no', 'no')).toBe(false)
    expect(palabraQueCrece('duplica', 'du')).toBe(false)
    expect(palabraQueCrece('la', 'largo')).toBe(true) // mismo arranque: es la MISMA palabra creciendo
  })

  it('colaNuevaTrasSolape reemplaza la ultima palabra, tambien con UNA sola palabra nueva', () => {
    expect(colaNuevaTrasSolape('du', 'dupli')).toBe('dupli')
    expect(colaNuevaTrasSolape('dupli', 'duplica')).toBe('duplica')
    expect(colaNuevaTrasSolape('vamos con la du', 'duplica')).toBe('vamos con la duplica')
  })

  it('la CAJA real: du -> dupli -> duplica muestra "duplica" (no "du dupli duplica")', () => {
    const { caja, mostrado } = cajaNueva()
    for (const texto of ['du', 'dupli', 'duplica']) caja.publicarEnLaCaja(texto)
    expect(ultimo(mostrado)).toBe('duplica')
  })

  it('"no no" se conserva: el doble legitimo no es un prefijo que crece', () => {
    const { caja, mostrado } = cajaNueva()
    caja.publicarEnLaCaja('no')
    caja.publicarEnLaCaja('no no')
    expect(ultimo(mostrado)).toBe('no no')
  })

  it('la caja ya no acumula la parcial pegada: "vamos con la du" + "duplica"', () => {
    const { caja, mostrado } = cajaNueva()
    caja.publicarEnLaCaja('vamos con la du')
    caja.publicarEnLaCaja('duplica')
    expect(ultimo(mostrado)).toBe('vamos con la duplica')
  })
})

// DEFECTO MEDIDO EN d4c1c8f3 (commit #13): la caja mostraba la locucion DOS VECES. La rama
// de "palabra que crece" confundia la ultima palabra CORTA de la caja ("mi") con el arranque
// de la primera palabra de una REENTREGA ("mientras") y pegaba la emision entera detras.
describe('A2 - reentrega de la MISMA locucion: no se pega entera detras', () => {
  it('`reentregaLoMostrado` distingue la reentrega del crecimiento de una palabra', () => {
    expect(
      reentregaLoMostrado(
        'mientras vamos a preparar el menjurje en mi'.split(' '),
        'mientras vamos a preparar el menjurje en mi pla'.split(' '),
      ),
    ).toBe(true)
    // Crecimiento puro de la ultima palabra (la que la caja tiene a medias): NO es reentrega.
    expect(reentregaLoMostrado(['du'], ['dupli'])).toBe(false)
    expect(reentregaLoMostrado(['vamos con la du'], ['duplica'])).toBe(false)
  })

  it('el par REAL del defecto no duplica el bloque', () => {
    const mostrado = 'mientras vamos a preparar el menjurje en mi'
    const emision = 'mientras vamos a preparar el menjurje en mi pla'
    expect(colaNuevaTrasSolape(mostrado, emision)).toBe(emision)
  })

  it('la CAJA real: la locucion crece sin repetirse (5 interinos seguidos)', () => {
    const { caja, mostrado } = cajaNueva()
    const SECUENCIA = [
      'mientras vamos a preparar el',
      'mientras vamos a preparar el menjurje',
      'mientras vamos a preparar el menjurje en mi',
      'mientras vamos a preparar el menjurje en mi plato',
      'mientras vamos a preparar el menjurje en mi plato de Hello',
    ]
    for (const texto of SECUENCIA) caja.publicarEnLaCaja(texto)

    expect(ultimo(mostrado)).toBe(SECUENCIA[SECUENCIA.length - 1])
    // Ninguna publicacion puede contener el bloque dos veces.
    for (const valor of mostrado) {
      const palabras = String(valor).toLowerCase().split(/\s+/).filter(Boolean)
      const bloque = palabras.slice(0, 3).join(' ')
      expect(String(valor).toLowerCase().split(bloque).length - 1, `"${valor}" repite el bloque`).toBe(1)
    }
  })

  it('CONTROL: el crecimiento de una palabra y el doble legitimo siguen igual', () => {
    expect(colaNuevaTrasSolape('du', 'dupli')).toBe('dupli')
    expect(colaNuevaTrasSolape('dupli', 'duplica')).toBe('duplica')
    expect(colaNuevaTrasSolape('vamos con la du', 'duplica')).toBe('vamos con la duplica')
    expect(colaNuevaTrasSolape('hola du', 'hola duplica ahora')).toBe('hola duplica ahora')
  })
})

describe('B - revision de la MISMA locucion (el ASR corrige el inicio)', () => {
  it('una revision MAS CORTA no encoge la caja (mandato 2026-10-21)', () => {
    const { caja, mostrado } = cajaNueva()
    const MOSTRADO = 'no se como se comporta la diarizacion en la caja de la frase viva'
    const REVISION = 'no se como se comporta la transcripcion en la caja de la frase' // corrige y no crece
    caja.publicarEnLaCaja(MOSTRADO)
    expect(ultimo(mostrado)).toBe(MOSTRADO)

    caja.publicarEnLaCaja(REVISION)
    expect(ultimo(mostrado), 'la caja no puede decrecer').toBe(MOSTRADO)
  })

  it('una revision MAS LARGA de la misma locucion si actualiza la caja', () => {
    const { caja, mostrado } = cajaNueva()
    const MOSTRADO = 'no se como se comporta la diarizacion en la caja de la frase viva'
    const CRECIDA = `${MOSTRADO} y ademas corrige el tramo`
    caja.publicarEnLaCaja(MOSTRADO)
    caja.publicarEnLaCaja(CRECIDA)
    expect(ultimo(mostrado)).toBe(CRECIDA)
  })

  it('un texto AJENO y mas corto sigue bloqueado (jamas se sustituye lo que no deriva)', () => {
    const { caja, mostrado } = cajaNueva()
    caja.publicarEnLaCaja(FRASE)
    caja.publicarEnLaCaja('vale pues si claro')
    expect(ultimo(mostrado)).toBe(FRASE)
  })

  it('un TROZO contiguo de lo mostrado sigue sin aplicarse (no encoge la caja)', () => {
    const { caja, mostrado } = cajaNueva()
    caja.publicarEnLaCaja(FRASE)
    caja.publicarEnLaCaja('de la transcripcion')
    expect(ultimo(mostrado)).toBe(FRASE)
  })
})

describe('C - vaciado legitimo y frontera de turno (sin arrastrar la frase vieja)', () => {
  it('tras el vaciado la locucion siguiente entra sola', () => {
    const { caja, mostrado } = cajaNueva()
    caja.publicarEnLaCaja('voy a poner a la mujer')
    expect(ultimo(mostrado)).toBe('voy a poner a la mujer')

    caja.vaciarLaCaja()
    expect(ultimo(mostrado), 'el vaciado limpia el espejo').toBe('')

    caja.publicarEnLaCaja('no lo voy a preparar al 100%')
    expect(ultimo(mostrado), 'la locucion nueva no se pega a la vieja').toBe('no lo voy a preparar al 100%')
    expect(ultimo(mostrado).toLowerCase()).not.toContain('mujer')
  })

  it('un turno DISTINTO no hereda el boceto aunque comparta arranque', () => {
    const { caja, mostrado } = cajaNueva()
    caja.publicarEnLaCaja('vamos a preparar la receta', { turnId: 1 })
    caja.publicarEnLaCaja('vamos a preparar la cena', { turnId: 2 })
    // Frontera por identidad: la caja parte del texto del turno nuevo, no de la union.
    expect(caja.turnoActual()).toBe(2)
    expect(ultimo(mostrado)).toBe('vamos a preparar la cena')
  })
})

// La FRASE CANONICA (un final de SEGMENTO confirmado por el ASR o el CIERRE del turno) es
// la unica emision autorizada a SUSTITUIR lo que la caja muestra. Sin esta transferencia la
// fila y la caja divergian (d4c1c8f3: fila con "Cloud de que ya", caja con el interino
// fabricado). El limite es el habla AJENA: si el boceto ya lleva la locucion siguiente, la
// caja no cede y manda el no-encogimiento.
describe('F - la frase canonica sustituye el boceto cuando el boceto no aporta habla', () => {
  it('un final confirmado MAS LARGO entra en la caja aunque no derive del interino', () => {
    const { caja, publishedLiveRef } = cajaNueva()
    // Interino FABRICADO: la caja encadena el arranque viejo con una cola posterior.
    caja.publicarEnLaCaja('vamos a ver si es cie lo que nos dijo esta todo resuelto')
    const canonico = 'vamos a ver si es cierto lo que nos dijo Cloud de que ya esta todo resuelto'
    const r = caja.publicarEnLaCaja(canonico, { canonica: true })
    expect(r.aplicado).toBe(true)
    expect(publishedLiveRef.current, 'la caja termina con la frase de la fila').toBe(canonico)
  })

  it('el canon MAS CORTO entra si el boceto solo repite sus palabras (tartamudeo)', () => {
    const { caja, publishedLiveRef } = cajaNueva()
    caja.publicarEnLaCaja('puso Cloud Cloud')
    caja.publicarEnLaCaja('puso Cloud', { canonica: true })
    expect(publishedLiveRef.current, 'la caja cede el tartamudeo, no encoge el habla').toBe('puso Cloud')
  })

  it('NO cede si el boceto lleva habla AJENA (la locucion siguiente ya empezo)', () => {
    const { caja, publishedLiveRef } = cajaNueva()
    const conHablaAjena = 'la locucion completa y ademas empiezo a contar otra cosa distinta'
    caja.publicarEnLaCaja(conHablaAjena)
    caja.publicarEnLaCaja('la locucion completa', { canonica: true })
    expect(publishedLiveRef.current, 'el habla nueva no se borra del espejo').toBe(conHablaAjena)
  })

  it('MUTACION: sin el sello `canonica` el canon MAS CORTO no entra (manda el no-encogimiento)', () => {
    const { caja, publishedLiveRef } = cajaNueva()
    caja.publicarEnLaCaja('puso Cloud Cloud')
    caja.publicarEnLaCaja('puso Cloud')
    expect(publishedLiveRef.current).toBe('puso Cloud Cloud')
  })
})

// D2 del plan (Fase 2): la caja NO fabrica una frase que nadie dijo. Un ARRANQUE
// compartido no es una reentrega: si la emision reescribe la COLA (otra hipotesis del mismo
// audio), unirla pegaba "vamos a ver si es cie" + "esta todo resuelto". La reentrega de la
// COLA de lo mostrado y su continuacion SI se anade (ahi la emision continua, no reescribe).
describe('G - la caja no fabrica con un arranque compartido', () => {
  it('arranque compartido + cola AJENA NO se aplica (ni solape ni revision)', () => {
    const mostrado = 'vamos a ver si es cie lo que nos dijo'
    const otraHipotesis = 'vamos a ver si es cie esta todo resuelto'
    expect(colaNuevaTrasSolape(mostrado, otraHipotesis)).toBe('')
    // El dueño de la emision NO puede sustituir la caja por compartir el arranque.
    expect(resolverEmisionDeLaCaja(mostrado, otraHipotesis).aplica).toBe(false)
    expect(resolverEmisionDeLaCaja(mostrado, otraHipotesis).motivo).toBe('bloqueado')
  })

  it('arranque compartido de DOS palabras + frase distinta mas larga NO sustituye la caja', () => {
    // Caso literal de la auditoria (2026-10-23): solo comparten "vamos a".
    const caja = 'vamos a preparar la receta'
    const otra = 'vamos a comprar el helado en la tienda'
    expect(resolverEmisionDeLaCaja(caja, otra).aplica).toBe(false)
  })

  it('la reentrega de la COLA con continuacion SI se anade', () => {
    expect(colaNuevaTrasSolape('vamos a preparar la receta', 'preparar la receta con el horno')).toBe(
      'vamos a preparar la receta con el horno',
    )
  })
})
