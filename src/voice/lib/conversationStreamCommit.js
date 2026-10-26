/**
 * CAJA de la frase viva del modo PASIVO y las reglas de emisión que la alimentan.
 *
 * Recortado del antiguo `conversationStreamCommit` al cortar la tubería vieja de
 * conversación (2026-10-25): el commit del stream ya no existe; el único consumidor
 * que queda es `crearCajaDeLaFrase`, la caja que escribe el espejo visible de la
 * última frase de la escucha pasiva. En CONVERSACIÓN la frase viva la escribe solo
 * el módulo (`box.updated`); esta caja no participa.
 */
import { stripDiacritics } from './audioMath.js'
import { canonSinTartamudeo } from './speechMerge.js'
import { getTranscriptPolicyCfg } from './fluTranscriptMotor.js'
import { isFragmentOfLocution } from './turnStream.js'
import { countSharedSpeechWords, conservaLasPalabrasDe } from './conversationStream.js'

/**
 * Clave comparable de una palabra de la caja: sin caja ni signos, con el texto original
 * intacto para poder publicar la cola tal cual (el replay midio que la union perdia
 * mayusculas: 'Daniel' -> 'daniel').
 * @param {string} palabra
 * @returns {string}
 */
export function claveDePalabra(palabra) {
  // El plegado de acentos tiene UN dueno (textUtils.stripDiacritics, via audioMath):
  // aqui solo se quitan los signos, para comparar palabras.
  return stripDiacritics(String(palabra || '')).replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Es la MISMA palabra con otra ortografia: iguales, o una es el ARRANQUE de la otra (el
 * ASR completa la palabra: 'prueba' -> 'pruebas', 'tar' -> 'tardo'). Nunca con menos de
 * 3 letras compartidas: 'a'/'al' o 'la'/'las' no son la misma palabra.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function mismaPalabraClave(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const corta = a.length <= b.length ? a : b
  const larga = a.length <= b.length ? b : a
  // POLITICA DE TRANSCRIPCION (una tabla): `transcript.policy.sameWordMinLetters`.
  const minLetras = Number(getTranscriptPolicyCfg().sameWordMinLetters) || 2
  return corta.length >= minLetras && larga.startsWith(corta)
}

/**
 * Comparacion de palabras de la CAJA: misma clave sin distinguir mayusculas (el ASR
 * reescribe "vamos" como "Vamos" en la misma frase).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function mismaPalabraDeLaCaja(a = '', b = '') {
  return mismaPalabraClave(claveDePalabra(a).toLowerCase(), claveDePalabra(b).toLowerCase())
}

/**
 * Palabras comparables de un texto de la caja (clave de palabra, sin vacias).
 * @param {string} texto
 * @returns {string[]}
 */
function palabrasDeLaCaja(texto = '') {
  return String(texto || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) => claveDePalabra(palabra))
    .filter(Boolean)
}

/**
 * El BOCETO no dice nada que la FRASE CANONICA no diga ya: todas sus palabras aparecen
 * en la frase, en orden. Es el caso del canon limpiando el ASR ("puso Cloud Cloud" vs
 * "puso Cloud"): la caja puede ceder sin perder habla. Si el boceto lleva habla AJENA
 * (la locucion siguiente) devuelve false y la caja NO se sustituye: ahi sigue mandando
 * el no-encogimiento.
 * @param {string} mostrado Lo que la caja muestra.
 * @param {string} frase Frase canonica (cierre o final confirmado).
 * @returns {boolean}
 */
function bocetoCubiertoPor(mostrado = '', frase = '') {
  const boceto = palabrasDeLaCaja(mostrado)
  const canonica = palabrasDeLaCaja(frase)
  if (!boceto.length || !canonica.length) return false
  let j = 0
  let ultima = ''
  for (const palabra of boceto) {
    if (ultima && mismaPalabraClave(palabra, ultima)) continue
    while (j < canonica.length && !mismaPalabraClave(palabra, canonica[j])) j += 1
    if (j >= canonica.length) return false
    ultima = canonica[j]
    j += 1
  }
  return true
}

/**
 * La palabra nueva es la MISMA palabra CRECIENDO ("du" -> "dupli" -> "duplica")?
 *
 * Exige prefijo ESTRICTO de >= 2 letras: el doble legitimo ("no no") NO crece (claves
 * iguales) y una palabra distinta que empieza igual ("la" -> "largo") tampoco cuenta
 * como la misma si no comparte la clave completa del arranque.
 *
 * @param {string} mostrada Palabra que la caja ya muestra.
 * @param {string} nueva Primera palabra de la emision.
 * @returns {boolean}
 */
export function palabraQueCrece(mostrada = '', nueva = '') {
  const a = claveDePalabra(mostrada).toLowerCase()
  const b = claveDePalabra(nueva).toLowerCase()
  if (!a || !b || a === b) return false
  if (b.length <= a.length) return false
  return b.startsWith(a)
}

/**
 * La emisión **REENTREGA lo mostrado EN ORDEN y sigue con más palabras**? Entonces es la
 * MISMA locución creciendo (el ASR la vuelve a entregar entera), no una palabra que se
 * completa.
 *
 * Existe porque una palabra CORTA de la caja es ARRANQUE de la primera palabra de la
 * reentrega ("mi" -> "mientras", "la" -> "largo") y la rama de `palabraQueCrece` pegaba la
 * emisión ENTERA detrás. Defecto medido en d4c1c8f3 (commit #13 de la fila):
 * caja "…el menjurje en mi" + emisión "…el menjurje en mi pla"
 * -> "... el menjurje en mientras vamos a preparar el menjurje en mi pla" (bloque duplicado,
 * 4 valores de caja y la fila duplicada). Cuando esto es cierto, la decisión vuelve al
 * alineado de cola (`(A)`/`(B)`), que completa la última palabra y añade SOLO lo que falta.
 *
 * @param {string[]} mostradas Palabras que la caja muestra.
 * @param {string[]} nuevas Palabras de la emisión.
 * @returns {boolean}
 */
export function reentregaLoMostrado(mostradas = [], nuevas = []) {
  if (!mostradas.length || !nuevas.length) return false
  // REENTREGA = la emision repite la locucion DESDE EL PRINCIPIO, coincidiendo en todas las
  // palabras mostradas MENOS la ultima (la que puede estar creciendo). NO exige que la
  // emision sea MAS LARGA: "… hablando de un" reentregada como "… hablando de" es la MISMA
  // locucion, y tomarla por "la ultima palabra creciendo" pegaba la emision ENTERA detras de
  // la caja, que la mostraba dos veces (medido en cec7281d: 238 -> 471 chars, el bloque
  // "unidad de medida actualizada" repetido).
  // Con UNA sola palabra mostrada no hay locucion que reentregar: ahi manda el crecimiento
  // de esa palabra ("du" -> "dupli"), y por eso se devuelve false.
  if (mostradas.length < 2) return false
  if (nuevas.length < mostradas.length - 1) return false
  const clavesMostradas = mostradas.map(claveDePalabra)
  const clavesNuevas = nuevas.map(claveDePalabra)
  const comparables = Math.min(clavesMostradas.length - 1, clavesNuevas.length)
  for (let i = 0; i < comparables; i += 1) {
    if (!mismaPalabraClave(clavesMostradas[i], clavesNuevas[i])) return false
  }
  return true
}

/**
 * Cola NUEVA de una emision: alinea el FINAL de lo mostrado con un tramo de la emision
 * nueva (el ASR reentrega la cola y sigue) y devuelve SOLO lo que viene DESPUES de ese
 * tramo, con el texto CRUDO de la emision (mas la letra que completa la ultima palabra
 * si la emision trae la version larga). Sin solape fiable no se inventa nada: '' =
 * no hay nada genuino que anadir (bloquear). Nunca quita texto de lo mostrado.
 * @param {string} mostrado
 * @param {string} nuevo
 * @returns {string}
 */
/** La emision ARRANCA con la cola de lo mostrado (reentrega genuina, no otra hipotesis). */
function arrancaConLaColaDe(mostradas = [], nuevas = []) {
  const max = Math.min(mostradas.length, nuevas.length)
  for (let k = max; k >= 1; k -= 1) {
    let igual = true
    for (let j = 0; j < k; j += 1) {
      if (claveDePalabra(mostradas[mostradas.length - k + j]) !== claveDePalabra(nuevas[j])) {
        igual = false
        break
      }
    }
    if (igual) return true
  }
  return false
}

/** Palabras iguales desde el principio (dueno: `countSharedSpeechWords`, conversationStream). */
function palabrasCompartidasAlArranque(mostradas = [], nuevas = []) {
  return countSharedSpeechWords(mostradas.join(' '), nuevas.join(' '))
}

/**
 * La emision empieza con un TRAMO de lo mostrado (>=2 palabras) cuya PRIMERA palabra
 * coincide EXACTA. Una palabra que solo "crece" ("prepara" vs "preparar") no es una
 * reentrega: es otra hipotesis del mismo audio (medido: "vamos a preparar la receta" +
 * "prepara la receta completa..." fabricaba "vamos a preparar la receta completa...").
 */
function empiezaConTramoExacto(mostradas = [], nuevas = []) {
  if (nuevas.length < 2 || !mostradas.length) return false
  const primera = claveDePalabra(nuevas[0])
  for (let i = 0; i < mostradas.length; i += 1) {
    if (claveDePalabra(mostradas[i]) !== primera) continue
    let k = 1
    while (
      k < nuevas.length &&
      i + k < mostradas.length &&
      mismaPalabraClave(claveDePalabra(mostradas[i + k]), claveDePalabra(nuevas[k]))
    ) {
      k += 1
    }
    if (k >= 2) return true
  }
  return false
}

/**
 * La emision CONTINUA lo mostrado (misma locucion), no es otra hipotesis del mismo audio.
 * Tres formas legitimas:
 *  (a) empieza con TODO lo mostrado (extension) o lo mostrado empieza con ella;
 *  (b) comparte un arranque largo (>=3 palabras): misma frase con la cola revisada;
 *  (c) reentrega la COLA de lo mostrado al principio de la emision.
 * Un bloque INTERIOR compartido con OTRO arranque no es continuacion: unirlo fabricaba
 * una frase que nadie dijo ("vamos a preparar la receta" + "prepara la receta completa").
 */
function empiezaComoLoMostrado(mostradas = [], nuevas = []) {
  if (!mostradas.length || !nuevas.length) return false
  const comunes = palabrasCompartidasAlArranque(mostradas, nuevas)
  if (comunes >= Math.min(mostradas.length, nuevas.length)) return true
  if (comunes >= 3) return true
  if (comunes >= 1 && nuevas[comunes]) {
    // La primera palabra que DIVERGE: si la de la emision es la misma creciendo (o al
    // reves), es la misma frase (la ultima palabra mostrada se completa).
    const mostradaDivergente = mostradas[comunes] ? claveDePalabra(mostradas[comunes]) : ''
    const nuevaDivergente = claveDePalabra(nuevas[comunes])
    if (
      mostradaDivergente &&
      (nuevaDivergente.startsWith(mostradaDivergente) || mostradaDivergente.startsWith(nuevaDivergente))
    ) {
      return true
    }
    if (comunes >= 2) return true
  }
  return arrancaConLaColaDe(mostradas, nuevas) || empiezaConTramoExacto(mostradas, nuevas)
}

export function colaNuevaTrasSolape(mostrado, nuevo) {
  // La reentrega vive SIEMPRE al final de lo mostrado: se alinea contra la COLA (ventana
  // acotada) y la cola a anadir no puede estar ya ahi (nada se duplica ni se infla).
  const VENTANA = 160
  const crudas = String(mostrado || '').trim().split(/\s+/).filter(Boolean)
  const crudasNuevas = String(nuevo || '').trim().split(/\s+/).filter(Boolean)
  if (!crudas.length || !crudasNuevas.length) return ''
  // (0) COMPLETAR LA ULTIMA PALABRA, no pegarla (medido 2026-10-21: la caja mostraba
  // "du dupli duplica"). El ASR hace CRECER la palabra que la caja ya tiene: se
  // REEMPLAZA la ultima palabra por la forma completa y el resto de la emision se
  // anade detras. Antes el caso de UNA sola palabra se descartaba arriba
  // (`crudasNuevas.length < 2`) y la caja se quedaba con la parcial hasta el final.
  // GUARDA (medido d4c1c8f3): si la emision REENTREGA lo mostrado en orden y sigue, no
  // hay palabra creciendo sino la MISMA locucion mas larga. Sin esta guarda, la palabra
  // corta del borde ("mi") se tomaba por el arranque de la primera palabra de la
  // reentrega ("mientras") y la locucion entera se pegaba detras (bloque duplicado).
  if (
    !reentregaLoMostrado(crudas, crudasNuevas) &&
    palabraQueCrece(crudas[crudas.length - 1], crudasNuevas[0])
  ) {
    return crudas.slice(0, -1).concat(crudasNuevas).join(' ')
  }
  if (crudasNuevas.length < 2) return ''
  // REENTREGA GENUINA: la emision debe CONTINUAR lo mostrado (mismo arranque o reentrega
  // de la cola). Un bloque INTERIOR compartido con otro arranque es otra HIPOTESIS del
  // mismo audio: unirlo fabricaba una frase que nadie dijo (medido: "vamos a preparar la
  // receta" + "prepara la receta completa con..." -> "vamos a preparar la receta completa").
  if (!empiezaComoLoMostrado(crudas, crudasNuevas)) return ''
  const mostrar = String(mostrado)
  const colaDeLoMostrado = crudas.slice(-VENTANA)
  const clavesMostradas = colaDeLoMostrado.map(claveDePalabra)
  const clavesNuevas = crudasNuevas.map(claveDePalabra)

  /** El tramo de palabras YA esta en la cola de lo mostrado (reentrega: no se aNade). */
  const yaMostrado = (palabras) => {
    if (!palabras.length) return true
    for (let i = 0; i + palabras.length <= clavesMostradas.length; i += 1) {
      let igual = true
      for (let j = 0; j < palabras.length; j += 1) {
        if (clavesMostradas[i + j] !== palabras[j]) { igual = false; break }
      }
      if (igual) return true
    }
    return false
  }

  /** La cola es GENUINA: no entera ya en lo mostrado y no ARRANCA con un tramo ya mostrado
   *  (la reentrega "creciente" de la misma cola repetiria el texto: medido en el replay). */
  const colaGen = (palabras) => {
    if (!palabras.length) return false
    if (yaMostrado(palabras)) return false
    const arranque = palabras.slice(0, Math.min(6, palabras.length))
    return arranque.length < 2 || !yaMostrado(arranque)
  }

  // (A) El SUFIJO de lo mostrado se reentrega dentro de la emision nueva: se anade lo que
  // viene DESPUES de ese tramo (mas la letra que completa la ultima palabra si viene larga).
  const tope = Math.min(60, clavesMostradas.length)
  let fin = -1
  let largo = 0
  for (let p = clavesNuevas.length - 1; p >= 0; p -= 1) {
    if (!mismaPalabraClave(clavesMostradas[clavesMostradas.length - 1], clavesNuevas[p])) continue
    let k = 1
    while (
      k < tope &&
      k < clavesMostradas.length &&
      p - k >= 0 &&
      mismaPalabraClave(clavesMostradas[clavesMostradas.length - 1 - k], clavesNuevas[p - k])
    ) k += 1
    if (k > largo) { largo = k; fin = p }
  }
  if (fin >= 0 && (largo >= 2 || largo === clavesMostradas.length)) {
    const crudaMostrada = colaDeLoMostrado[colaDeLoMostrado.length - 1]
    const crudaNueva = crudasNuevas[fin]
    const completacion = crudaNueva.length > crudaMostrada.length &&
      crudaNueva.toLowerCase().startsWith(crudaMostrada.toLowerCase())
      ? crudaNueva.slice(crudaMostrada.length)
      : ''
    const cola = clavesNuevas.slice(fin + 1)
    if (colaGen(cola)) {
      // COSTURA ANTI-TARTAMUDEO (medido d4c1c8f3): la cola puede ARRANCAR repitiendo la
      // palabra del borde que la caja YA muestra ("…dijo cla Cloud" + "…dijo cla Cloud
      // Cloud de que" -> la caja acumulaba "Cloud Cloud" y el duplicado se commiteaba).
      // Esa primera palabra NO es nueva: se descarta (la caja ya la tiene). La palabra
      // corta de enfasis ("…dijo no no pasa") sobrevive: solo se descarta de 4 letras
      // o mas (misma regla que `collapseAdjacentWordRepeat`, dueño del canon).
      const primeraColaA = crudasNuevas[fin + 1]
      const mismaA = mismaPalabraClave(
        String(crudaMostrada || '').toLowerCase(),
        String(primeraColaA || '').toLowerCase(),
      )
      if (mismaA && primeraColaA.length >= 4) {
        const restoA = crudasNuevas.slice(fin + 2)
        return restoA.length ? `${mostrar}${completacion} ${restoA.join(' ')}` : `${mostrar}${completacion}`
      }
      return `${mostrar}${completacion} ${crudasNuevas.slice(fin + 1).join(' ')}`
    }
    if (!cola.length && completacion) return `${mostrar}${completacion}`
  }

  // (B) La emision ARRANCA reentregando un tramo de lo mostrado (trozo INTERIOR, P11.16) y
  // sigue: se anade su cola nueva. Con menos de 2 palabras de tramo no se inventa la union.
  let mejorK = 0
  // Posicion del tramo reentregado dentro de lo mostrado: sin ella no se puede saber si la
  // reentrega llega al FINAL de la caja o se queda a mitad (otra hipotesis del audio).
  let mejorI = 0
  for (let i = 0; i < clavesMostradas.length; i += 1) {
    let k = 0
    while (
      k < clavesNuevas.length &&
      i + k < clavesMostradas.length &&
      mismaPalabraClave(clavesMostradas[i + k], clavesNuevas[k])
    ) k += 1
    if (k > mejorK) {
      mejorK = k
      mejorI = i
    }
  }
  if (mejorK >= 2) {
    // GENUINA O HIPOTESIS: solo se une cuando la emision CONTINUA lo mostrado. Dos formas:
    // (1) el tramo reentregado llega al FINAL de la caja (reentrega de la cola + habla
    // nueva), o (2) la palabra que la caja muestra JUSTO DESPUES del tramo es la que la
    // emision reescribe/crece (costura del ASR: la caja pego una parcial y el ASR la
    // completa). Un tramo INTERIOR con otra cola es otra HIPOTESIS del mismo audio: unirla
    // fabricaba una frase que nadie dijo (medido: "vamos a ver si es cie | lo que nos dijo"
    // + "vamos a ver si es cie | esta todo resuelto" -> "es cie lo que nos dijo esta todo
    // resuelto", que no se dijo).
    const restoMostrado = colaDeLoMostrado[mejorI + mejorK]
    const primeraPalabraNueva = crudasNuevas[mejorK]
    const llegaAlFinalDeLaCaja = mejorI + mejorK === clavesMostradas.length
    const continuaLaPalabra =
      Boolean(restoMostrado) &&
      Boolean(primeraPalabraNueva) &&
      (mismaPalabraDeLaCaja(restoMostrado, primeraPalabraNueva) ||
        palabraQueCrece(restoMostrado, primeraPalabraNueva))
    if (!llegaAlFinalDeLaCaja && !continuaLaPalabra) return ''
    const cola = clavesNuevas.slice(mejorK)
    if (colaGen(cola)) {
      // COSTURA ANTI-TARTAMUDEO (medido d4c1c8f3): la cola puede ARRANCAR con la
      // palabra que la caja YA muestra al final ("…dijo cla Cloud" + "…dijo Cloud
      // de que" -> la cola "Cloud de que" reentrega el "Cloud" mostrado). Pasa
      // cuando la caja pego antes una parcial ("cla", ASR 205) y por eso el
      // alineado del sufijo (A) no ve la reentrega: la caja acumulaba "cla Cloud
      // Cloud" y el duplicado se commiteaba en la fila. Esa primera palabra NO es
      // nueva: si es la MISMA que la ultima mostrada se descarta (la caja ya la
      // tiene), y si la COMPLETA (el ASR la oyo a medias: "cla" -> "Cloud") se
      // sustituye la parcial por la forma completa de la emision. El doble
      // legitimo de la emision ("…dijo no no pasa") sobrevive: solo se resuelve
      // la palabra que la caja ya muestra.
      const ultimaMostrada = colaDeLoMostrado[colaDeLoMostrado.length - 1]
      const primeraCola = crudasNuevas[mejorK]
      const misma = mismaPalabraClave(
        String(ultimaMostrada || '').toLowerCase(),
        String(primeraCola || '').toLowerCase(),
      )
      if (misma) {
        if (primeraCola.length > ultimaMostrada.length) {
          return crudas.slice(0, -1).concat([primeraCola], crudasNuevas.slice(mejorK + 1)).join(' ')
        }
        // Palabra corta de enfasis ("no no"): la emision la repite a proposito y se
        // conserva (misma guarda que el canon: solo se descarta de 4 letras o mas).
        if (primeraCola.length >= 4) {
          const resto = crudasNuevas.slice(mejorK + 1)
          return resto.length ? `${mostrar} ${resto.join(' ')}` : ''
        }
        return `${mostrar} ${crudasNuevas.slice(mejorK).join(' ')}`
      }
      return `${mostrar} ${crudasNuevas.slice(mejorK).join(' ')}`
    }
  }
  return ''
}

/**
 * Prefijo COMUN de palabras de dos textos (misma clave de palabra).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
function prefijoComunDePalabras(a = [], b = []) {
  let comun = 0
  while (comun < a.length && comun < b.length && mismaPalabraDeLaCaja(a[comun], b[comun])) comun += 1
  return comun
}

/**
 * La emision llega al FINAL de lo mostrado (su ultima palabra es la ultima o la penultima)?
 *
 * Es la condicion que permite una revision MAS CORTA sin perder el tramo: el ASR re-reconoce
 * la locucion hasta su final (re-segmenta o corrige palabras), no se queda a mitad.
 * @param {string[]} mostradas
 * @param {string[]} nuevas
 * @returns {boolean}
 */
function alcanzaElFinalDeLoMostrado(mostradas = [], nuevas = []) {
  const ultima = nuevas[nuevas.length - 1]
  if (!ultima) return false
  return mostradas.slice(-2).some((palabra) => mismaPalabraDeLaCaja(palabra, ultima))
}

/**
 * La emision COMPARTE UN TRAMO de lo mostrado DESPUES del arranque (>=2 palabras seguidas que
 * la caja ya tenia). Es lo que separa "misma locucion, mejor hipotesis" de "otra frase que
 * empieza igual":
 *  - "porque a los tal vez" -> "porque tal vez tu papa necesita" comparte "tal vez" (SI),
 *  - "vamos a preparar la receta" -> "vamos a comprar otra cosa" no comparte nada salvo el
 *    saludo "vamos a" (NO): es otra frase y la caja no se sustituye.
 * @param {string[]} mostradas Palabras de lo mostrado.
 * @param {string[]} nuevas Palabras de la emision.
 * @param {number} comun Longitud del prefijo comun ya calculado.
 * @returns {boolean}
 */
function comparteTramoTrasElArranque(mostradas = [], nuevas = [], comun = 0) {
  const desde = Math.max(1, Number(comun) || 0)
  for (let i = desde; i + 1 < mostradas.length; i += 1) {
    for (let j = 0; j + 1 < nuevas.length; j += 1) {
      if (mismaPalabraClave(mostradas[i], nuevas[j]) && mismaPalabraClave(mostradas[i + 1], nuevas[j + 1])) {
        return true
      }
    }
  }
  return false
}

/**
 * DUENO UNICO de "esta emision entra en la caja, y como" (2026-10-21).
 *
 * Tres desenlaces, una sola regla:
 *  - `revision`: la emision DERIVA de lo mostrado (arranque estable de >=2 palabras, o el
 *    prefijo corto cuando la caja apenas tiene unas pocas), NO es un trozo contiguo (el ASR
 *    a medias no aporta y no puede recortar) y no baja del prefijo ya confirmado. Corrige o
 *    completa el MISMO tramo, asi que REEMPLAZA: anadirla duplicaria el tramo corregido.
 *    Si es mas corta, tiene que llegar al FINAL de lo mostrado (re-reconocio el tramo
 *    entero); asi una frase nueva que solo comparte el arranque no se lleva la caja.
 *  - `solape`: la emision reentrega la COLA (o un trozo interior) y sigue con habla nueva;
 *    se anade la cola genuina (`colaNuevaTrasSolape`, que sigue siendo su dueno).
 *  - `bloqueado`: texto ajeno o trozo puro; la caja no se toca ("jamas se sustituye" para
 *    lo que no deriva de lo mostrado).
 *
 * @param {string} mostrado Lo que la caja muestra ahora.
 * @param {string} nuevo Emision del ASR.
 * @returns {{ aplica: boolean, destino: string, motivo: "revision"|"solape"|"bloqueado" }}
 */
export function resolverEmisionDeLaCaja(mostrado = '', nuevo = '') {
  const mostradas = String(mostrado || '').trim().split(/\s+/).filter(Boolean)
  const nuevas = String(nuevo || '').trim().split(/\s+/).filter(Boolean)
  const bloqueado = { aplica: false, destino: String(mostrado || ''), motivo: 'bloqueado' }
  if (!nuevas.length) return bloqueado
  // La COLA GENUINA la decide `colaNuevaTrasSolape` (su dueno). Se calcula una vez.
  const union = colaNuevaTrasSolape(mostrado, nuevo)
  const unionAplica = Boolean(union) && union.length > String(mostrado || '').length
  const solape = () => ({ aplica: true, destino: union, motivo: 'solape' })
  if (mostradas.length) {
    const comun = prefijoComunDePalabras(mostradas, nuevas)
    // EXTENSION PURA: la caja YA es el arranque de la emision (ninguna palabra mostrada se
    // corrige). Manda la UNION, que conserva la grafia de la caja (el replay midio que
    // reemplazar perdia mayusculas: "Daniel" -> "daniel"); solo si no hay cola que anadir
    // se sigue evaluando como revision.
    if (comun === mostradas.length && unionAplica) return solape()
    // ARRANQUE ESTABLE: >=2 palabras compartidas, o el prefijo corto ya existente cuando la
    // caja apenas tiene unas pocas (glue del arranque del turno: "te las" -> "te lo escribe").
    // Numeros en UNA tabla (`FLU_CONFIG.transcript.policy`), no repartidos por el pipeline.
    const politica = getTranscriptPolicyCfg()
    const arranqueEstable =
      comun >= (Number(politica.boxStablePrefixWords) || 2) ||
      (mostradas.length <= (Number(politica.boxShortBoxMaxWords) || 4) &&
        comun >= (Number(politica.boxShortBoxPrefixWords) || 1))
    const noEsTrozo = !isFragmentOfLocution(nuevo, mostrado)
    const noEncojeBajoLoConfirmado = nuevas.length >= comun
    // NINGUNA sustitucion puede perder palabras de la caja (solo acumula).
    const conservaLaCaja = conservaLasPalabrasDe(mostrado, nuevo)
    const crece = nuevas.length >= mostradas.length
    // EXTENSION de lo mostrado (la emision empieza por las MISMAS palabras): es la misma
    // locucion creciendo ("no" -> "no no"), asi que no necesita un tramo adicional.
    const esExtensionDeLoMostrado =
      crece && mostradas.every((palabra, i) => mismaPalabraDeLaCaja(palabra, nuevas[i]))
    if (
      arranqueEstable &&
      noEsTrozo &&
      noEncojeBajoLoConfirmado &&
      // MISMO TRAMO OBLIGATORIO (auditoria 2026-10-23): compartir el arranque no basta para
      // sustituir la caja; hace falta un tramo MAS ALLA del arranque, salvo que la emision
      // sea la MISMA locucion creciendo palabra a palabra.
      conservaLaCaja &&
      (esExtensionDeLoMostrado || comparteTramoTrasElArranque(mostradas, nuevas, comun)) &&
      (crece || alcanzaElFinalDeLoMostrado(mostradas, nuevas))
    ) {
      return { aplica: true, destino: String(nuevo), motivo: 'revision' }
    }

    // HIPOTESIS MAS COMPLETA (medido 7fce0045: la caja se quedo 10,7 s en "porque a los tal
    // vez" mientras el ASR decia "porque tal vez tu papa necesita..." — 80 emisiones dentro
    // sin entrar). Si la emision es MAS LARGA, arranca con la MISMA primera palabra y COMPARTE
    // UN TRAMO de lo mostrado mas alla del arranque, es la hipotesis VIGENTE de la MISMA
    // locucion y la caja la muestra (se REEMPLAZA, no se une). El tramo compartido es la
    // guarda contra "otra frase que empieza igual" ("vamos a preparar la receta" vs "vamos a
    // comprar otra cosa": solo comparten "vamos a" -> NO se sustituye).
    if (
      comun >= 1 &&
      nuevas.length > mostradas.length &&
      noEsTrozo &&
      comparteTramoTrasElArranque(mostradas, nuevas, comun)
    ) {
      return { aplica: true, destino: String(nuevo), motivo: 'revision' }
    }
  }
  if (unionAplica) return solape()
  return bloqueado
}

/**
 * CAJA de la frase viva ("ultima frase"): UNICO escritor de `publishedLiveRef` y de su
 * espejo visible. UNA sola regla (`publicarEnLaCaja`):
 *   - la caja vacia o una emision identica no cambian nada;
 *   - emision que YA contiene lo mostrado -> se aplica la emision (crece);
 *   - emision mas corta o que no contiene lo mostrado -> se ANADE la cola nueva
 *     (alineada con el final de lo mostrado) o se BLOQUEA: nunca se sustituye.
 * El vaciado legitimo (cierre confirmado / parrafo nuevo / reset de sesion) es
 * `vaciarLaCaja`: NO lo decide la regla de acumulacion.
 * @param {{ publishedLiveRef?: { current: string }, activeTurnIdRef?: { current: number | string | null }, cancelLiveTranscriptUpdate?: Function, scheduleLiveTranscriptUpdate?: Function, setLiveTranscript?: Function }} deps
 * @returns {{ publicarEnLaCaja: Function, vaciarLaCaja: Function, turnoActual: () => number | string | null }} `turnoActual`
 *   es el turno que sostiene el boceto (null si la caja esta vacia).
 */
export function crearCajaDeLaFrase(deps = {}) {
  const { publishedLiveRef, cancelLiveTranscriptUpdate, scheduleLiveTranscriptUpdate, setLiveTranscript } = deps
  const escribirVisible = (texto, inmediato) => {
    const valor = String(texto || '')
    // ESCRITURA INMEDIATA (vaciado o publicacion sin debounce): primero se CANCELA el
    // update perezoso pendiente. Sin esto, un debounce programado ANTES del vaciado
    // escribia su texto viejo DESPUES y la ultima frase "volvia a ponerse" (defecto
    // medido por el dueno 2026-10-18: la caja tardaba en limpiarse y reaparecia texto).
    if (inmediato) {
      if (typeof cancelLiveTranscriptUpdate === 'function') cancelLiveTranscriptUpdate()
      if (typeof setLiveTranscript === 'function') {
        setLiveTranscript(valor)
        return
      }
    }
    if (!valor) {
      if (typeof setLiveTranscript === 'function') setLiveTranscript('')
      return
    }
    if (typeof scheduleLiveTranscriptUpdate === 'function') {
      scheduleLiveTranscriptUpdate(valor)
      return
    }
    if (typeof setLiveTranscript === 'function') setLiveTranscript(valor)
  }
  const leer = () => String(publishedLiveRef?.current || '')
  // TURNO DEL BOCETO: a que locucion pertenece lo que la caja muestra. La caja solo
  // acumula dentro de la MISMA locucion; un turno distinto parte limpio.
  // `undefined` = TODAVIA NO SE PUBLICO NADA (identidad desconocida). Es distinto de `null`,
  // que es un turno SIN id: asi null -> 5 SI marca frontera (antes `null` significaba a la vez
  // "sin publicar" y "sin id", y un commit sin turno no partia la caja; auditoria 2026-10-23).
  let turnoDelBoceto
  const publicarEnLaCaja = (texto = '', opciones = {}) => {
    const nuevo = String(texto || '')
    const mostrado = leer()
    if (!nuevo || nuevo === mostrado) {
      return { aplicado: false, destino: mostrado, previo: mostrado.length }
    }
    // EL TURNO DE LA CAJA SIEMPRE EXISTE (auditoria 2026-10-23): si el llamador no lo pasa, se
    // toma el turno VIVO del motor. Con `null` la caja no marcaba frontera y una locucion de
    // otro turno podia heredar el boceto.
    const turnoActivo = opciones.turnId ?? deps.activeTurnIdRef?.current ?? null
    // FRONTERA POR IDENTIDAD: lo mostrado pertenece a OTRO turno -> no se hereda ni se
    // fusiona por texto (evita "se borra y luego vuelve a poner" al cruzar locuciones).
    const cambioDeTurno =
      Boolean(mostrado) && turnoDelBoceto !== undefined && turnoDelBoceto !== turnoActivo
    let destino = nuevo
    if (!cambioDeTurno) {
      if (mostrado) {
        // EXCEPCION DECLARADA (SOLO FRASE CANONICA): el CIERRE del turno y la
        // CONFIRMACION del ASR entregan la frase canonica de la locucion, y la caja la
        // ADOPTA aunque no derive de lo mostrado. Dos motivos medidos:
        //  1) el boceto puede ser un texto FABRICADO (d4c1c8f3: la caja mostraba
        //     "... es cie ... esta todo resuelto" sin "Cloud de que ya" mientras la fila
        //     si lo llevaba), y
        //  2) la frase canonica puede ser MAS CORTA que el boceto porque el canon quita
        //     el tartamudeo ("puso Cloud Cloud" -> "puso Cloud").
        // Adoptarla es lo que mantiene caja = fila (B.3). Se admite cuando crece, cuando
        // es la MISMA revision (correccion del mismo tramo) o cuando el boceto es solo un
        // ECO de la frase. Si el boceto ya lleva habla AJENA (la locucion siguiente)
        // ninguna se cumple y no se toca: ahi el no-encogimiento sigue mandando.
        if (
          opciones.canonica &&
          (nuevo.length >= mostrado.length || bocetoCubiertoPor(mostrado, nuevo)) &&
          // La frase canonica SUSTITUYE: no puede comerse palabras de la caja. La unica
          // perdida legitima es el TARTAMUDEO, que el canon colapsa ("Cloud Cloud" -> "Cloud");
          // se compara contra la caja ya canonizada. Defecto medido 2026-10-23: la canonica
          // perdio "esto" y "escucha" en medio/final de la locucion.
          conservaLasPalabrasDe(canonSinTartamudeo(mostrado), nuevo)
        ) {
          destino = nuevo
        } else {
        // UN SOLO CRITERIO (2026-10-21): la emision solo entra si DERIVA de lo mostrado.
        // El dueno unico de esa decision es `resolverEmisionDeLaCaja` (revision del mismo
        // tramo o cola genuina); aqui solo se aplica. Se decide ANTES de la union porque
        // una REVISION no se "anade": se reemplaza. Antes se anadia su cola y la caja
        // duplicaba el tramo corregido ("...la diarizacion... transcripcion...").
        const decision = resolverEmisionDeLaCaja(mostrado, nuevo)
        // LA CAJA NO ENCOGE DENTRO DE LA MISMA LOCUCION (mandato 2026-10-21): una
        // revision puede corregir/completar, pero nunca reducir lo ya mostrado. El
        // unico encogimiento legitimo es el VACIADO del cierre (`vaciarLaCaja`). Antes
        // `resolverEmisionDeLaCaja` devolvia revisiones mas cortas y 5 se aplicaron en
        // la sesion real (64->63, 147->104, 50->41, 80->64, 10->8).
        if (decision.aplica && decision.destino.length < mostrado.length) {
            return { aplicado: false, destino: mostrado, previo: mostrado.length }
        }
        if (decision.aplica) destino = decision.destino
        else return { aplicado: false, destino: mostrado, previo: mostrado.length }
        }
      }
    }
    turnoDelBoceto = turnoActivo
    if (publishedLiveRef) publishedLiveRef.current = destino
    escribirVisible(destino, Boolean(opciones.inmediato))
    return { aplicado: true, destino, previo: cambioDeTurno ? 0 : mostrado.length }
  }
  // Vaciado legitimo (cierre confirmado / arranque / parada / reset de sesion). Por
  // defecto vacia tambien el espejo visible; `{ visible: false }` solo resetea la MEMORIA
  // (el ancla del parrafo nuevo) y deja la ultima frase en pantalla: borrarla era el
  // "borra y luego vuelve a poner" medido por el dueno.
  const vaciarLaCaja = (opciones = {}) => {
    if (publishedLiveRef) publishedLiveRef.current = ''
    // `undefined` = no se publico nada desde el vaciado (identidad desconocida provisional).
    turnoDelBoceto = undefined
    if (opciones.visible !== false) escribirVisible('', true)
  }
  return {
    publicarEnLaCaja,
    vaciarLaCaja,
    // Contrato publico: `null` = turno desconocido (el sentinel interno es `undefined`).
    turnoActual: () => (turnoDelBoceto === undefined ? null : turnoDelBoceto),
  }
}
