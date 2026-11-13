/**
 * INGESTA del módulo CONVERSACIÓN: audio, drenaje del ASR y cierre pendiente.
 *
 * Mide con el VAD inyectado, corta el tramo y evalúa la frontera; el flujo de
 * texto (eco, revisión, pendientes) vive en `texto.ts`. No escribe filas: pide
 * el cierre a la sesión.
 */
import { decidirFrontera } from './frontera.ts'
import { perteneceALineaAbierta } from './fusion.ts'
import { continuaLaFrase } from '../core/locucion.js'
import { crearFlujoTexto } from './texto.ts'
import type { FlujoTexto } from './texto.ts'
import type { Pendientes } from './cola.ts'
import type { BufferAsr, RegistroTramos } from './tramos.ts'
import type { Sesion } from './sesion.ts'
import { decidirIdentidad, plantillasDeSesion } from './identidad.ts'
import type { IdentidadDecidida } from './identidad.ts'
import { colaDeMuestras, retenerCola, vozMsDeMuestras } from './muestras.ts'
import { fusionarVoz, ultimaFilaPorFin } from './fila.ts'
import { registrarMedidaVoz } from './sesion.ts'
import { asrEmpujaAudio, CONVERSACION_CONFIG } from './ports.ts'
import { logCaughtError } from '../../lib/caughtError.ts'
import type {
  ConfiguracionConversacion,
  IdiomaLocucion,
  MotivoCierre,
  TramoMuestreado,
} from './ports.ts'
import type {
  AsrIngestado,
  BloqueAudio,
  DependenciasConversacion,
  InstantaneaConversacion,
  LocucionAbierta,
  TextoDeReentrega,
  TramoAudio,
} from './tipos.ts'

/** Aplica la identidad de voz a la locución abierta (dueño único del payload). */
function conIdentidadVoz(locucion: LocucionAbierta, identidad: IdentidadDecidida): LocucionAbierta {
  return {
    ...locucion,
    voz: fusionarVoz(locucion.voz, {
      vozId: identidad.vozId,
      hablante: identidad.hablante,
      continuidad: identidad.continuidad,
      ...(identidad.insuficiente ? { insuficiente: true } : {}),
    }),
    continuidadVoz: identidad.continuidad,
  }
}

/** Superficie de ingesta que consume el motor. */
export type Ingesta = Readonly<{
  ingestaAudio(bloque: BloqueAudio): Promise<InstantaneaConversacion>
  ingestaAsr(entrada: AsrIngestado): Promise<InstantaneaConversacion>
  drenarResultadosAsr(forzar?: boolean): Promise<void>
  cerrarPendienteAsr(): Promise<void>
  finalizarPendientes(motivo: MotivoCierre): Promise<void>
}>

/**
 * Crea la ingesta de la sesión.
 * @param opciones Puertos, config, sesión y retenes de la cola.
 * @returns Las operaciones de audio y ASR que el motor serializa.
 */
export function crearIngesta({
  dependencias,
  configuracion,
  sesion,
  tramos,
  pendientes,
  bufferAsr,
  encolar,
}: {
  dependencias: Pick<
    DependenciasConversacion,
    | 'reloj'
    | 'id'
    | 'vad'
    | 'asr'
    | 'ultimoTextoDicho'
    | 'config'
    | 'registro'
    | 'embebedor'
    | 'anclasBase'
  >
  configuracion: ConfiguracionConversacion
  sesion: Sesion
  tramos: RegistroTramos
  pendientes: Pendientes
  bufferAsr: BufferAsr
  /** Reentrada a la cola ÚNICA: la medida temprana muta el estado al resolverse. */
  encolar: <T>(tarea: () => Promise<T>) => Promise<T>
}): Ingesta {
  const estado = sesion.estado
  /**
   * Único dueño del motivo `turnoYaEscrito`; lo consumen la ingesta y el stop.
   * @revisor CREAR NUEVO — el motivo tenía dueño inline en ingesta y el stop
   *   necesitaba el mismo hecho sin duplicar el literal.
   */
  const contarReentrega: (
    locutionId: Parameters<Sesion['contarDescarte']>[1],
    tramo: Parameters<Sesion['contarDescarte']>[2],
  ) => void = (locutionId, tramo) => {
    sesion.contarDescarte('turnoYaEscrito', locutionId, tramo)
  }

  /**
   * Marca el fin de audio cubierto por una medida de voz SIN retroceder: el
   * freno del re-embed compara contra este valor, así que lo ya medido no se
   * vuelve a medir. Único escritor de `medidoHastaPorTramo` (el tramo abierto
   * es una clave más); los lectores conservan su defecto propio.
   * @revisor CREAR NUEVO — cinco sitios escribían el mapa con su propio
   *   `Math.max` (o sin él) y uno podía retroceder el fin medido; una sola
   *   transición deja la monotonía en un dueño.
   * @param tramoId Tramo medido.
   * @param fin Fin del audio cubierto por la medida.
   */
  function marcarMedido(tramoId: string, fin: number): void {
    const medido =
      estado.medidoHastaPorTramo.get(tramoId) ?? Number.NEGATIVE_INFINITY
    if (fin > medido) estado.medidoHastaPorTramo.set(tramoId, fin)
  }

  const flujo: FlujoTexto = crearFlujoTexto({
    dependencias,
    configuracion,
    sesion,
    tramos,
    pendientes,
    contarReentrega,
    // Puerta ÚNICA de reentrega: la MISMA que usa el volcado del stop.
    esReentrega: esReentregaDeLaFila,
    // Dueño único del tramo sintético de un texto sin tramo vivo.
    tramoParaTexto: tramoSinteticoParaTexto,
    // El audio acompaña al texto: la fusión de un pendiente atribuye SU tramo
    // a la medida de la locución que cierra.
    sumarAudioAtribuido,
  })

  /**
   * Tramo de un resultado que no trae id: el vigente al PROCESAR (la cola ya
   * ingirió el audio) y, si no hay ninguno abierto, el último medido, que
   * destina el final tardío del tramo ya cerrado.
   */
  function tramoVigente(): string {
    // El último tramo COMMITEADO no es "vigente": un final tardío atribuido a
    // él se ignora por insert-only y la frase se pierde. Sin tramo vivo, el
    // texto tardío recibe un tramo sintético y abre SU locución.
    return estado.tramoAudio?.tramoId || estado.abierta?.locutionId || ''
  }

  /**
   * Dueño ÚNICO de «este texto es la reentrega de una fila ya escrita». Mismo
   * turno y misma frase (exacta, continuación o reemisión solapada) sobre una
   * ventana que toca la fila; una frase nueva no entra.
   *
   * La reemisión del final retenido ENTRE turnos no se resuelve aquí: el módulo
   * nunca deduplica por texto entre turnos (repetición legítima tras pausa
   * conserva su fila, decisión D11); el producto no re-compone resultados que ya
   * cubrió una fila commiteada.
   * @param entrada Resultado del ASR con su turno y tramo.
   * @param tramoId Tramo resuelto para el resultado.
   * @returns true si debe contarse como `turnoYaEscrito` y no escribir.
   */
  function esReentregaDeLaFila(entrada: TextoDeReentrega, tramoId: string): boolean {
    const textoEntrante = String(entrada.texto || '').trim()
    if (!textoEntrante) return false
    const previa =
      (tramoId ? estado.filas.get(tramoId) : undefined) ??
      ultimaFilaPorFin(estado.filas.values())
    if (!previa) return false
    const turno = entrada.turnId ? String(entrada.turnId).trim() : estado.turnoActual
    if (previa.turnId !== turno) return false
    const tramoEntrante = tramos.resolver(tramoId, entrada.tramo)
    const solapa = Boolean(tramoEntrante && tramoEntrante.inicio <= previa.tramo.fin)
    const exacta = String(previa.texto || '').trim() === textoEntrante
    if (!solapa && !exacta) return false
    return exacta || continuaLaFrase(previa.texto, textoEntrante)
  }

  /**
   * Tramo sintético para un texto tardío cuya locución ya cerró: el ASR puede
   * entregar el final después de que el VAD cortó y de que el tramo real venció.
   * Sin él, el texto se atribuye a un tramo commiteado y se pierde.
   */
  function tramoSinteticoParaTexto(): string {
    const ultimo = estado.ultimoTramoId ? tramos.vigente(estado.ultimoTramoId) : null
    const tramoId = dependencias.id.uuid()
    tramos.sintetico({ tramoId, turnId: estado.turnoActual, ultimo })
    estado.ultimoTramoId = tramoId
    return tramoId
  }

  /**
   * Abre una locución vacía sobre un tramo ya sonoro (caparazón de ruido).
   * Es el ÚNICO ensamblado de apertura de este flujo; el dueño
   * (`abrirLocucion` en el módulo de cierre) aplica los defaults.
   * @param tramoId Id del tramo.
   * @param tramo Ventana medida del tramo.
   * @param turnId Turno vigente.
   * @param idioma Idioma del tramo.
   */
  function abrirCaparazon(
    tramoId: string,
    tramo: Pick<TramoMuestreado, 'inicio' | 'fin' | 'sampleRate'>,
    turnId: string,
    idioma: IdiomaLocucion,
    partidaDeVoz = false,
  ): void {
    sesion.abrirLocucion({ tramoId, texto: '', tramo, turnId, idioma, voz: {}, partidaDeVoz })
  }

  /** Retiene el PCM del tramo para la voz de un pendiente que abre tarde. */
  function retenerTramo(
    tramoId: string,
    inicio: number,
    fin: number,
    muestras: Float32Array,
    sampleRate: number,
  ): void {
    tramos.retener(
      tramoId,
      { inicio, fin, muestras },
      configuracion.maxSegundosVozRetenida * sampleRate,
    )
  }

  /**
   * ¿El audio del tramo VIVO alimenta la medida de la locución abierta?
   *
   * Sí cuando es SU tramo (mismo id) y también cuando su TEXTO ya se le
   * atribuyó (`tramosDeLaAbierta`): la frase sigue tras una pausa interna y el
   * tramo nuevo es su continuación. MEDIDO 2026-11-13 18:44: la locución
   * 4d84debd abrió como caparazón, el VAD cortó en la muestra 2681984, el
   * primer texto se atribuyó al tramo vivo y `sumarAudioAtribuido` sumó sus
   * primeros 0,75 s; el resto del comando (hasta la muestra 2873760) quedó
   * fuera de la abierta. La medida del cierre vio 240 ms (< 350) y la fila
   * cerró «Hablante XX» sin `vozId`, así que el nombre no alcanzó a las filas
   * anteriores ni a las posteriores de esa voz.
   * @param abierta Locución abierta.
   * @returns true si el bloque de audio del tramo vivo pertenece a la abierta.
   * @revisor CREAR NUEVO — predicado único del audio vivo que alimenta la
   *   medida de la abierta; extiende el criterio `suyo` existente con los
   *   tramos atribuidos por texto. Dos copias de la condición divergirían.
   */
  function elTramoVivoEsDeLaAbierta(abierta: LocucionAbierta): boolean {
    const vivo = estado.tramoAudio
    if (!vivo) return true
    return (
      vivo.tramoId === abierta.locutionId ||
      estado.tramosDeLaAbierta.has(vivo.tramoId)
    )
  }

  /**
   * Suma al PCM de la locución abierta el audio de un tramo cuyo TEXTO se le
   * atribuyó (la frase sigue tras una pausa interna). El audio sigue a la
   * atribución del texto: el tramo de una voz DISTINTA no continúa la frase y
   * no entra aquí. Sin esto la medida se quedaba con el primer tramo (240 ms
   * de voz medidos en 89a0d948/263adae9) y nunca alcanzaba el piso de voz: la
   * fila nacía temporal y su medida no llegaba jamás.
   *
   * Lo ya retenido se suma UNA vez; la continuación EN VIVO del mismo tramo la
   * aporta `elTramoVivoEsDeLaAbierta` en cada bloque (medido 18:44: sin ella el
   * habla posterior a la atribución nunca entraba en la medida).
   * @param tramoId Tramo atribuido a la locución abierta (distinto del suyo).
   */
  function sumarAudioAtribuido(tramoId: string): void {
    const abierta = estado.abierta
    if (!abierta || estado.tramosDeLaAbierta.has(tramoId)) return
    const tramo = tramos.resolver(tramoId)
    if (!tramo) return
    const bloques = tramos.muestras(tramoId, tramo)
    if (!bloques || bloques.length === 0) return
    estado.tramosDeLaAbierta.add(tramoId)
    const tope = configuracion.maxSegundosVozRetenida * abierta.sampleRate
    for (const bloque of bloques) {
      estado.muestrasAbierta = retenerCola(estado.muestrasAbierta, bloque, tope)
    }
    // El fin de la frase es el del ÚLTIMO audio atribuido: el hueco siguiente se
    // mide contra lo que de verdad sonó, no contra el primer tramo (con
    // `abierta.fin` viejo un tramo posterior daba un hueco falso de >5 s).
    if (tramo.fin > abierta.fin) {
      estado.abierta = { ...abierta, fin: tramo.fin }
    }
  }

  /**
   * Verifica el cambio de hablante MIDIENDO la cola de la locución abierta
   * (`minSegundosVozMedida` de los últimos PCM retenidos) y la pasa por la
   * decisión de identidad del módulo (`decidirIdentidadSesion`). Solo una
   * decisión con evidencia suficiente y de OTRA voz confirma el cambio y parte
   * el tramo en dos locuciones, cada una con su fila y su etiqueta. Síncrono y
   * en la cola ÚNICA: el texto del evento se atribuye a la voz nueva.
   *
   * @param tramoId Tramo que destina el resultado (resuelto por el módulo).
   * @returns El tramo de la voz nueva si hubo partición; null si no cambió.
   */
  async function verificarCambioVoz(tramoId: string): Promise<string | null> {
    const embebedor = dependencias.embebedor
    const abierta = estado.abierta
    if (!embebedor || !abierta) return null
    // Sin medida aplicada no hay qué comparar (la medida temprana sigue su curso).
    const vozIdAbierta = String(abierta.voz.vozId || '').trim()
    if (!vozIdAbierta) return null
    // La ventana se compara contra la plantilla de la MISMA voz abierta (no
    // contra la última voz de la sesión, que puede ser otra).
    const plantillaAbierta = estado.plantillasVoz.get(vozIdAbierta)
    if (!plantillaAbierta || plantillaAbierta.vector.length === 0) return null
    const ventana = Math.round(configuracion.minSegundosVozMedida * abierta.sampleRate)
    if (ventana <= 0) return null

    // El audio de la voz entrante puede vivir en OTRO tramo: el VAD cortó y el
    // hablante nuevo arrancó después del silencio. Se mide SU tramo retenido,
    // no la cola de la locución abierta (que es la voz anterior).
    const mismotramo = abierta.locutionId === tramoId
    let bloques: readonly Float32Array[]
    let finAlMedir: number
    let sampleRate: number
    if (mismotramo) {
      const medidoAbierta =
        estado.medidoHastaPorTramo.get(abierta.locutionId) ?? 0
      if (abierta.fin - medidoAbierta < ventana) return null
      bloques = estado.muestrasAbierta
      finAlMedir = abierta.fin
      sampleRate = abierta.sampleRate
    } else {
      const entrante = tramos.resolver(tramoId)
      if (!entrante) return null
      // FRENO DEL TRAMO AJENO: con el VAD cortado dentro de la frase, CADA
      // resultado del ASR llega con el tramo nuevo y sin freno cada interino
      // re-embebía la MISMA ventana (un embed por resultado, esperado en línea
      // en la cola ÚNICA: la transcripción se alentaba letra por letra, medido
      // 2026-11-12). El tramo se embebe UNA vez por ventana; solo se re-embebe
      // cuando CRECIÓ otra ventana completa de audio nuevo.
      const medidoHasta =
        estado.medidoHastaPorTramo.get(tramoId) ?? Number.NEGATIVE_INFINITY
      if (entrante.fin - medidoHasta < ventana) return null
      bloques = tramos.muestras(tramoId, entrante) ?? []
      finAlMedir = entrante.fin
      sampleRate = entrante.sampleRate
    }
    // Se copia SOLO la cola que se mide. Antes se concatenaba el búfer entero
    // (hasta 30 s) para luego quedarse con la ventana: 104 copias completas en
    // la sesión 8149df78, 11.712.064 muestras copiadas en 74 s de audio.
    const cola = colaDeMuestras(bloques, ventana)
    if (cola.length < ventana) return null
    let vector: readonly number[] | null = null
    try {
      vector = await embebedor.medir(cola, sampleRate)
    } catch (error) {
      logCaughtError('conversacion.voz.cambio.fallo', error, {
        sessionId: estado.sessionId ?? '',
        locutionId: abierta.locutionId,
      })
      return null
    }
    const vigente = estado.abierta
    if (!vector || !vigente) return null
    // La ventana del tramo ajeno queda cubierta por esta medida: el siguiente
    // resultado solo re-embebe si el tramo creció otra ventana. Un fallo del
    // embebedor NO sella (vector null): la próxima entrega reintenta.
    if (!mismotramo) marcarMedido(tramoId, finAlMedir)
    if (mismotramo && vigente.locutionId !== tramoId) return null
    // La identidad de la ventana la decide SU dueño (`decidirIdentidad`, el
    // mismo que etiqueta las filas): la ventana es la MISMA voz si la mejor
    // plantilla de la sesión es la de la voz abierta. Aquí vivía una segunda
    // comparación privada contra la plantilla abierta — otro dueño, sin
    // duración: en la sesión 753c2361 (19:01:38 y 19:02:02) partió en dos la
    // voz de la dueña con ventanas cortas que la medida del MISMO audio
    // declaró un solo hablante.
    const identidad = decidirIdentidadSesion(
      vector,
      embebedor,
      vozMsDeMuestras(cola, sampleRate),
    )
    const mismaVoz = identidad.continuidad && identidad.vozId === vozIdAbierta
    if (mismaVoz) {
      // Misma voz: la etiqueta se conserva y el tramo continuo NO cambia
      // de etiqueta; el contador avanza hasta el fin medido y la cadena de
      // voces distintas se rompe (la confirmación arranca de cero).
      if (mismotramo) marcarMedido(tramoId, finAlMedir)
      estado.contadorCambioVoz = 0
      estado.candidatoCambioVoz = null
      return null
    }
    // La ventana no alcanza para una identidad (`vozMs < minNuevaVozMs`): NO es
    // evidencia de cambio. DEFECTO MEDIDO (sesión 753c2361): las dos
    // particiones falsas midieron 1050 y 900 ms de VOZ con `minNewSpeakerMs`
    // 1500; el cálculo privado anterior ignoraba la duración y partía con la
    // ventana corta. La ventana queda sellada para no re-embeber el mismo audio.
    if (identidad.insuficiente) {
      if (mismotramo) marcarMedido(tramoId, finAlMedir)
      estado.contadorCambioVoz = 0
      estado.candidatoCambioVoz = null
      return null
    }
    // CONFIRMACIÓN del cambio (Caso 1+3): UNA ventana distinta no parte la
    // fila (el embebedor tartamudea en la frontera de un tramo); se exigen
    // `confirmacionesCambioVoz` ventanas SEGUIDAS. La primera distinta sella
    // el fin medido: la siguiente ventana sale de audio NUEVO, nunca del
    // mismo tramo contado dos veces.
    estado.contadorCambioVoz += 1
    if (estado.contadorCambioVoz < (configuracion.confirmacionesCambioVoz || 2)) {
      // RETENCIÓN (definición correcta): la primera ventana sospechosa NO se
      // queda en la fila anterior. Se guarda su límite y el texto que había
      // ANTES de ella; si la segunda confirma, A cierra con ese texto y la
      // ventana (texto incluido) pasa al hablante nuevo.
      const entrante = mismotramo ? null : tramos.resolver(tramoId)
      const limite = mismotramo
        ? finAlMedir - cola.length
        : entrante?.inicio ?? finAlMedir - cola.length
      if (mismotramo) marcarMedido(tramoId, finAlMedir)
      estado.candidatoCambioVoz = {
        limite,
        textoAntes: String(estado.abierta?.texto || ''),
      }
      return null
    }
    estado.contadorCambioVoz = 0
    const candidato = estado.candidatoCambioVoz
    estado.candidatoCambioVoz = null
    const actual = estado.abierta
    if (candidato && actual && String(actual.texto || '') !== candidato.textoAntes) {
      // A se queda con lo que dijo ANTES de la ventana sospechosa; el texto
      // acumulado que llega después se recorta contra esta fila y va a B.
      estado.abierta = { ...actual, texto: candidato.textoAntes }
    }
    if (mismotramo) {
      const limite = candidato?.limite ?? finAlMedir - cola.length
      if (limite <= abierta.inicio || limite >= abierta.fin) return null
      return partirLocucionPorCambioDeVoz(
        {
          tramoId: dependencias.id.uuid(),
          inicio: limite,
          fin: finAlMedir,
          sampleRate: abierta.sampleRate,
          silencioPrevioMs: 0,
          retenerVentana: true,
          recortarAnterior: limite,
        },
        cola,
        vector,
      )
    }
    const entrante = tramos.resolver(tramoId)
    if (!entrante) return null
    const limite = candidato?.limite ?? entrante.inicio
    if (limite < 0 || limite >= entrante.fin) return null
    const tramoRegistrado = tramos.vigente(tramoId)
    return partirLocucionPorCambioDeVoz(
      {
        tramoId,
        inicio: limite,
        fin: entrante.fin,
        sampleRate: entrante.sampleRate,
        silencioPrevioMs: tramoRegistrado?.silencioPrevioMs ?? 0,
        retenerVentana: false,
        recortarAnterior: null,
      },
      cola,
      vector,
    )
  }

  /** Decisión de la puerta de VOZ. El dueño de la condición es `frontera.ts`. */
  function fronteraPorVoz() {
    return decidirFrontera({
      medida: { hayVoz: true, silencioMs: 0 },
      textoAjeno: false,
      abierta: true,
      cambioVoz: true,
    })
  }

  /**
   * Aplica al tramo recién abierto la identidad de la voz medida.
   * @param vector Vector que sostiene la voz nueva.
   * @returns false si no hay embebedor o locución abierta.
   */
  function aplicarIdentidadAlTramoAbierto(
    vector: readonly number[],
    vozMs: number,
  ): boolean {
    const embebedor = dependencias.embebedor
    const recien = estado.abierta
    if (!embebedor || !recien) return false
    const identidad = decidirIdentidadSesion(
      vector,
      embebedor,
      // La evidencia de identidad es la VOZ medida, no la duración del tramo.
      vozMs,
    )
    registrarMedidaVoz(estado, vector, identidad)
    estado.abierta = conIdentidadVoz(recien, identidad)
    return true
  }

  /**
   * Parte la locución abierta por cambio de voz (Caso 1+3): la anterior cierra
   * con causa 'voz' (dueño `frontera.ts`) y la voz nueva abre SU locución.
   *
   * Sirve a los dos cortes reales:
   *  - MISMA ventana (`recortarAnterior`): el VAD NO cortó; el tramo se parte en
   *    el inicio de la cola medida y la voz nueva reusa esa ventana.
   *  - TRAMO DISTINTO: el VAD cortó; la voz nueva ya tiene su tramo y su audio
   *    retenido, así que se abre sobre él sin recortar la locución anterior.
   *
   * @param datos Tramo a abrir, ventana medida y si hay que recortar la anterior.
   * @param vector Vector de la ventana (voz nueva).
   * @returns El `tramoId` de la voz nueva si partió; null si no se pudo.
   */
  async function partirLocucionPorCambioDeVoz(
    datos: Readonly<{
      tramoId: string
      inicio: number
      fin: number
      sampleRate: number
      silencioPrevioMs: number
      retenerVentana: boolean
      recortarAnterior: number | null
    }>,
    ventana: Float32Array,
    vector: readonly number[],
  ): Promise<string | null> {
    const abierta = estado.abierta
    if (!abierta) return null
    const frontera = fronteraPorVoz()
    if (!frontera.cerrar) return null
    const turno = abierta.turnId
    const idioma = abierta.idioma
    const finalAnterior = abierta.final
    // 1. La locución anterior cierra: recortada a la ventana medida si el corte
    //    ocurrió dentro de su audio; tal cual si el VAD ya la había cortado.
    //
    //    INVARIANTE (medido 2026-11-08 02:28:26 en la sesión del dueño): una muestra
    //    de audio pertenece a UNA locución. Entonces `anterior.fin` NO puede quedar
    //    detrás del inicio de la voz nueva: la anterior cerró con fin=6.603.904 y la
    //    nueva abrió en 6.340.736 → 263.168 muestras (5,5 s) en DOS locuciones, y esa
    //    locución nueva salió con un tramo de 23,1 s en 6,5 s de reloj. Se acota al
    //    inicio de la nueva: el tramo de la anterior nunca llega a su audio.
    const finAnterior =
      datos.recortarAnterior === null
        ? Math.min(abierta.fin, datos.inicio)
        : datos.recortarAnterior
    const anterior = finAnterior === abierta.fin ? abierta : { ...abierta, fin: finAnterior }
    estado.abierta = anterior
    await sesion.cerrarLocucion(
      anterior,
      'system',
      frontera.causa ?? 'voz',
      finalAnterior,
    )
    // 2. La voz nueva abre SU locución sobre su tramo y su audio.
    const nuevo: TramoAudio = {
      tramoId: datos.tramoId,
      inicio: datos.inicio,
      fin: datos.fin,
      sampleRate: datos.sampleRate,
      turnId: turno,
      silencioPrevioMs: datos.silencioPrevioMs,
    }
    estado.tramoAudio = nuevo
    estado.ultimoTramoId = datos.tramoId
    tramos.registrar(nuevo)
    if (datos.retenerVentana) {
      retenerTramo(datos.tramoId, datos.inicio, datos.fin, ventana, datos.sampleRate)
    }
    abrirCaparazon(
      datos.tramoId,
      { inicio: datos.inicio, fin: datos.fin, sampleRate: datos.sampleRate },
      turno,
      idioma,
      // TODO caparazón de partición de voz lleva la marca, se haya recortado
      // la anterior dentro de su audio o la haya cortado el VAD: la línea
      // acumulada del producto re-incluye el texto ya commiteado y el recorte
      // de prefijo de la fila anterior debe disparar SIEMPRE.
      true,
    )
    // 3. Identidad de la voz nueva con el MISMO vector (etiqueta perezosa).
    if (
      !aplicarIdentidadAlTramoAbierto(
        vector,
        vozMsDeMuestras(ventana, datos.sampleRate),
      )
    ) {
      return null
    }
    estado.muestrasAbierta = [ventana]
    marcarMedido(datos.tramoId, datos.fin)
    dependencias.registro.registrar('conversacion.locucion.partida', {
      sessionId: estado.sessionId ?? '',
      locutionId: datos.tramoId,
      anterior: abierta.locutionId,
      limite: datos.inicio,
      turnId: turno,
    })
    return datos.tramoId
  }

  /**
   * Tramo al que PERTENECE un texto del ASR (problema 1/3: el texto se colgaba
   * del tramo de audio más reciente aunque la frase abierta fuera otra, y la
   * frase acababa partida en dos filas).
   *
   * El texto es de la locución ABIERTA cuando el tramo que trae no es el suyo
   * pero la frase sigue viva: el texto la CONTINÚA (dueño `continuaLaFrase`:
   * revisión del ASR o crecimiento; el reconocedor reemite la frase completa
   * tras una pausa interna) y NO hay silencio medido ≥ `silenceCloseMs` antes
   * del tramo entrante.
   * El hueco de índices no decide: con `abierta.fin` viejo un tramo posterior
   * da un hueco grande aunque la frase siga y no haya pausa real. Dentro de la
   * ventana medida la pausa del VAD no parte la frase: partirla por el silencio
   * mínimo de 900 ms duplicaba la fila (medido en la sesión 89a0d948/263adae9:
   * dos finales del mismo enunciado, 300 y 330 caracteres).
   * Sin texto previo manda el hueco mínimo (la locución aún no afirma nada) y,
   * fuera de la ventana de cierre, manda el tramo: el texto abre otra locución.
   * @param tramoId Tramo que declaró (o al que se destinó) el resultado.
   * @param texto Texto del resultado.
   * @returns El `tramoId` de destino, ya atribuido.
   */
  function tramoDestinoDeTexto(
    tramoId: string,
    texto: string,
    silencioEntranteMs?: number,
  ): string {
    const abierta = estado.abierta
    if (!abierta) return tramoId
    const previo = String(abierta.texto || '').trim()
    const textoLimpio = String(texto || '').trim()
    // CAPARAZÓN VACÍO: la locución abierta por audio aún no tiene texto. El
    // primer texto que llega ES su frase: se atribuye a ELLA (y su audio se
    // suma), no se cierra descartada. Sin esto el final de la frase encontraba
    // un caparazón nuevo y el texto acababa pendiente/perdido.
    if (!previo && textoLimpio) {
      if (tramoId) sumarAudioAtribuido(tramoId)
      return abierta.locutionId
    }
    if (abierta.locutionId === tramoId) {
       // MISMO TRAMO con audio VIVO: es una revisión. Sin audio vivo, el VAD ya
       // cortó pero la locución sigue ABIERTA: el texto solo pertenece a ella si
       // la CONTINÚA; una frase ajena queda pendiente (no se pega ni la cierra).
       if (estado.tramoAudio?.tramoId === tramoId) return tramoId
       if (!textoLimpio || !continuaLaFrase(previo, textoLimpio)) return ''
       // El VAD cortó el tramo vivo, pero la frase siguió y el ASR entrega su
       // final más tarde. El audio de esa continuación quedó registrado en el
       // último tramo SIN atribuir: se suma aquí. Sin esto la locución medía y
       // filtraba solo el primer tramo (medido 2026-11-11: 49 s de texto sobre
       // 3,5 s de audio → `vozMs` 480 y `Hablante XX` con habla de sobra).
       const ultimo = estado.ultimoTramoId
       if (
         ultimo &&
         ultimo !== abierta.locutionId &&
         !estado.tramosDeLaAbierta.has(ultimo)
       ) {
         const tramoContinuacion = tramos.resolver(ultimo)
         if (tramoContinuacion && tramoContinuacion.fin > abierta.fin) {
           sumarAudioAtribuido(ultimo)
         }
       }
       return tramoId
     }
     // Sin tramo vigente: el texto entra en la abierta SOLO si la CONTINÚA. Un
     // texto ajeno sin tramo se retiene como pendiente (no se pega a A ni la
     // cierra): la frontera sigue siendo silencio o voz distinta.
     if (!tramoId) {
       return textoLimpio && continuaLaFrase(previo, textoLimpio)
         ? abierta.locutionId
         : ''
     }
     const tramo = tramos.resolver(tramoId)
     // Tramo no registrado: el texto conserva SU id. Si no continúa la abierta,
     // `procesarResultadoAsr` lo retiene como pendiente (no se pega ni se pierde).
     if (!tramo) return textoLimpio ? tramoId : ''
    // El silencio que decide la frontera es el MEDIDO antes del tramo entrante,
    // no el hueco de índices: con `abierta.fin` viejo el hueco puede ser enorme
    // aunque no haya pausa real (frase continua cruzando tramos).
    const silencioPrevioMs =
      tramos.vigente(tramoId)?.silencioPrevioMs ??
      (Number.isFinite(silencioEntranteMs) ? Number(silencioEntranteMs) : 0)
    const destino = perteneceALineaAbierta({
      locucionId: abierta.locutionId,
      textoAbierto: previo,
      trozo: textoLimpio,
      tramoVigente: { ...tramo, tramoId, silencioPrevioMs },
      silenceCloseMs: configuracion.silenceCloseMs,
    })
      ? abierta.locutionId
      : tramoId
    // El audio acompaña al texto: la evidencia de voz de la fila es la de TODO
    // el audio que produjo su frase, no solo el del primer tramo.
    if (destino === abierta.locutionId) sumarAudioAtribuido(tramoId)
    return destino
  }

  /**
   * Drena los resultados del `AsrPort` en orden; el tramo se fija al drenar.
   * @param forzar `true` solo en el volcado inicial del stop: procesa lo YA
   *   aceptado antes de congelar; sin él, un stop en curso no ingiere nada.
   */
  async function drenarResultadosAsr(forzar = false): Promise<void> {
    if (estado.cerrando && !forzar) return
    for (const crudo of bufferAsr.drenar()) {
      const tramoOrigen = crudo.tramoId || tramoVigente()
      // La VOZ se verifica sobre el tramo ENTRANTE (su audio retenido), aunque
      // sea otro tramo por corte del VAD. Si parte, el texto va a la voz nueva.
      const tramoVoz = (await verificarCambioVoz(tramoOrigen)) ?? tramoOrigen
      const tramoDestino = tramoDestinoDeTexto(tramoVoz, crudo.texto)
      await flujo.procesarResultadoAsr({ ...crudo, tramoId: tramoDestino })
    }
  }

  /** Cierra lo abierto si el ASR avisó de un estado terminal (watchdog/error). */
  async function cerrarPendienteAsr(): Promise<void> {
    if (estado.cerrando || !estado.cierreAsrPendiente) return
    const motivo = estado.cierreAsrPendiente
    estado.cierreAsrPendiente = null
    if (estado.abierta) {
      const locucion = estado.abierta
      await sesion.cerrarLocucion(locucion, motivo, 'asr', locucion.final)
      // La línea cerró: la frase retenida se abre YA con su turno y su hora, en
      // vez de esperar al siguiente evento (o al stop, que la sellaba tarde).
      await flujo.flushPendientes()
    }
  }

  /** Ingesta un bloque de audio: mide, corta el tramo y evalúa la frontera. */
  async function ingestaAudio(bloque: BloqueAudio): Promise<InstantaneaConversacion> {
    sesion.exigirActiva()
    // Tras el stop no se abre nada nuevo: el micrófono puede seguir entregando
    // bloques, pero la sesión ya está cerrada.
    if (estado.cerrando) return sesion.snapshot()
    await drenarResultadosAsr()
    await cerrarPendienteAsr()

    const sampleRate = Number(bloque.sampleRate)
    const inicio = Number(bloque.inicio)
    const fin =
      bloque.fin === undefined ? inicio + bloque.muestras.length : Number(bloque.fin)
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error(`sampleRate invalido: ${bloque.sampleRate}`)
    }
    if (!Number.isFinite(inicio) || inicio < 0) {
      throw new Error(`indice de muestra invalido: ${bloque.inicio}`)
    }
    if (!Number.isFinite(fin) || fin <= inicio) {
      throw new Error(`tramo de audio invalido: [${inicio}, ${fin}]`)
    }
    // Caso 5 (INGESTA): un bloque validado está ENTREGADO, con voz o sin ella.
    // El criterio es entregadas >= 0,98N de la sesión. Único dueño del contador.
    estado.totalMuestrasEntregadas += bloque.muestras.length
    // ANCLA muestra↔reloj (hora de VOZ): el PRIMER bloque entregado fija la
    // correspondencia entre índice de muestra y reloj. Todo tramo de la sesión se
    // fecha con ella, aunque su fila se escriba minutos después (stop).
    if (!estado.anclaAudio) {
      estado.anclaAudio = { muestra: inicio, ms: dependencias.reloj.ahora(), sampleRate }
    }
    if (estado.tramoAudio && estado.tramoAudio.sampleRate !== sampleRate) {
      throw new Error(
        `sampleRate inconsistente en el tramo ${estado.tramoAudio.tramoId}: ${estado.tramoAudio.sampleRate} != ${sampleRate}`,
      )
    }
     if (bloque.turnId) estado.turnoActual = String(bloque.turnId).trim()
     // El pendiente NO se abre al ingerir audio: espera al siguiente resultado
     // del ASR (con el turno vigente) o al stop. Abrirlo aquí commiteaba una
     // frase antes de que el usuario terminara la pausa.

     const medida =
      bloque.medida ??
      (dependencias.vad
        ? dependencias.vad.medir(bloque.muestras, sampleRate)
        : null)
    if (!medida) throw new Error('falta medida VAD: sin medida no hay frontera')

    if (!estado.tramoAudio) {
      if (medida.hayVoz) {
        const tramoId = dependencias.id.uuid()
        const nuevo: TramoAudio = {
          tramoId,
          inicio,
          fin,
          sampleRate,
          turnId: estado.turnoActual,
          silencioPrevioMs: estado.silencioPendienteMs,
        }
        estado.silencioPendienteMs = 0
        estado.tramoAudio = nuevo
        estado.ultimoTramoId = tramoId
        tramos.registrar(nuevo)
        retenerTramo(tramoId, inicio, fin, bloque.muestras, sampleRate)
        // CAPARAZÓN: una locución ABIERTA sin texto (ruido/eco que abrió sesión)
        // no puede quedarse con la voz que arranca ahora. Si entre su último
        // audio y este tramo ya había silencio de cierre (>= silenceCloseMs), se
        // cierra como sinTexto: nada se pierde y la voz nueva se mide sobre SU
        // audio. Si el hueco es menor, se conserva (la frase sigue en curso).
        const huecoMs =
          ((inicio - (estado.abierta?.fin ?? inicio)) / sampleRate) * 1000
        const fronteraCaparazon = decidirFrontera({
          medida: { hayVoz: false, silencioMs: huecoMs },
          textoAjeno: false,
          abierta: true,
        })
        if (
          estado.abierta &&
          !String(estado.abierta.texto).trim() &&
          fronteraCaparazon.cerrar
        ) {
          await sesion.cerrarLocucion(
            estado.abierta,
            'system',
            fronteraCaparazon.causa ?? 'silencio',
            false,
          )
        }
        if (!estado.abierta) {
          abrirCaparazon(
            tramoId,
            { inicio, fin, sampleRate },
            estado.turnoActual,
            estado.idiomaActual,
          )
        }
        if (dependencias.asr && asrEmpujaAudio(estado.motorAsr)) {
          dependencias.asr.empujarAudio(bloque.muestras, sampleRate)
        }
      }
    } else {
      const finPrevio = estado.tramoAudio.fin
      const actualizado: TramoAudio = {
        ...estado.tramoAudio,
        fin: Math.max(estado.tramoAudio.fin, fin),
      }
      estado.tramoAudio = actualizado
      tramos.registrar(actualizado)
      retenerTramo(actualizado.tramoId, inicio, fin, bloque.muestras, sampleRate)
      if (estado.abierta && elTramoVivoEsDeLaAbierta(estado.abierta)) {
        estado.abierta = { ...estado.abierta, fin: actualizado.fin }
      }
      if (dependencias.asr && asrEmpujaAudio(estado.motorAsr)) {
        dependencias.asr.empujarAudio(bloque.muestras, sampleRate)
      }
      if (!medida.hayVoz && medida.silencioMs >= configuracion.minSilenceMs) {
        const candidato =
          actualizado.fin - Math.round((medida.silencioMs * sampleRate) / 1000)
        const finHabla = candidato > actualizado.inicio ? candidato : finPrevio
        const cortado: TramoAudio = { ...actualizado, fin: finHabla }
        tramos.registrar(cortado)
        if (estado.abierta && elTramoVivoEsDeLaAbierta(estado.abierta)) {
          estado.abierta = { ...estado.abierta, fin: cortado.fin }
        }
        estado.silencioPendienteMs = medida.silencioMs
        estado.tramoAudio = null
        // MANDATO DEL DUEÑO (2026-10-30): el final NO cierra por contenido. La
        // locución cortada sigue abierta y cierra SOLO por la puerta de abajo:
        // silencio (5 s), cambio de voz (partición), texto ajeno o fin de sesión.
      }
    }

    const abierta = estado.abierta
    if (abierta) {
      // Solo el audio que PERTENECE a la locución abierta alimenta EN VIVO su
      // medida: su propio tramo o el tramo cuyo TEXTO ya se le atribuyó (la
      // frase sigue tras una pausa interna). El de un tramo ajeno se retiene
      // para ESE tramo y entra en la locución únicamente si su TEXTO se
      // atribuye a ella (continuación de la frase: `sumarAudioAtribuido`).
      // Sumar en vivo el audio de otra voz contaminaba la medida y acuñaba
      // etiquetas falsas (problema 3).
      const suyo = elTramoVivoEsDeLaAbierta(abierta)
      if (suyo) {
        estado.muestrasAbierta = retenerCola(
          estado.muestrasAbierta,
          bloque.muestras,
          configuracion.maxSegundosVozRetenida * sampleRate,
        )
      }
      lanzarMedidaSiCorresponde(abierta, sampleRate)
    }
    // La locución VIGENTE al evaluar la frontera: la anterior pudo cerrarse en
    // el bloque de arriba (caparazón) y `estado.abierta` cambia.
    const vigente = estado.abierta
    if (vigente) {
      // CONFIRMACIÓN DEL FINAL (puerta 2 adelantada): la marca la arma el flujo
      // de texto al aplicar el final. Cada bloque CON voz la rearma (la persona
      // sigue hablando: la ventana no puede disparar a media frase); sin voz,
      // la frontera compara el reloj contra el tope declarado.
      if (medida.hayVoz && estado.confirmacionFinalDesdeMs !== null) {
        estado.confirmacionFinalDesdeMs = dependencias.reloj.ahora()
      }
      const finalDesdeMs =
        estado.confirmacionFinalDesdeMs === null
          ? undefined
          : Math.max(0, dependencias.reloj.ahora() - estado.confirmacionFinalDesdeMs)
      const frontera = decidirFrontera(
        {
          medida,
          textoAjeno: false,
          abierta: true,
          ...(finalDesdeMs === undefined ? {} : { finalDesdeMs }),
        },
        {
          minSilenceMs: CONVERSACION_CONFIG.minSilenceMs,
          silenceCloseMs: CONVERSACION_CONFIG.silenceCloseMs,
          // El umbral vive en la tabla del plan; la configuracion inyectada lo
          // declara (o lo apaga con <= 0) en las pruebas.
          finalCloseConfirmMs: Number(configuracion.finalCloseConfirmMs) || 0,
        },
      )
      if (frontera.cerrar) {
        // Cierre ÚNICO por frontera: la puerta de texto funde lo retenido antes
        // del silencio en la locución que cierra (una fila, un insert).
        await flujo.cerrarPorFrontera(frontera)
        // Lo NO fundido (voz distinta, audio anterior) se abre EN EL ACTO con su
        // propio tramo y su hora de voz. Dejarlo para el stop lo sellaba minutos
        // después, con el reloj del cierre (defecto medido 2026-11-12).
        await flujo.flushPendientes()
      }
    }
    return sesion.snapshot()
  }

  /** Ingesta un resultado del ASR por su tramo (regla 3). */
  async function ingestaAsr(entrada: AsrIngestado): Promise<InstantaneaConversacion> {
    sesion.exigirActiva()
    // El stop YA empezó: el reconocedor puede entregar un final tardío («cerrando»)
    // después de que el usuario cortó la escucha. Ese texto no entra: la sesión
    // está cerrada y solo se vuelca lo que ya estaba aceptado antes del stop.
    if (estado.cerrando) {
      sesion.contarDescarte('huerfano', String(entrada.tramoId || '').trim() || null, entrada.tramo ?? null)
      return sesion.snapshot()
    }
    // El reloj mide el SILENCIO DEL ASR, no el de la fila: cualquier resultado
    // (final o intermedio) prueba que el reconocedor sigue vivo. No se mueve a
    // `texto.ts`: al moverlo a "solo resultados de la línea abierta" se cortó una
    // wake que llegaba como intermedio tras un final sin wake (medido 2026-11-10
    // 20:58:37.707: srGap 3,510 s antes de la revisión "Okay flu Platícame...").
    // La visibilidad del pendiente la resuelve la caja (`textoPendiente`).
    estado.ultimoResultadoMs = dependencias.reloj.ahora()
    await drenarResultadosAsr()
    await cerrarPendienteAsr()
     let tramoId = String(entrada.tramoId || '').trim() || tramoVigente()
     // Texto VACÍO sin locución abierta: es el único huérfano real.
     if (!String(entrada.texto || '').trim() && !estado.abierta) {
       sesion.contarDescarte('huerfano', tramoId || null, entrada.tramo ?? null)
       return sesion.snapshot()
     }
     // Un tramo COMMITEADO no es "vigente": el texto tardío se atribuiría a la
    // fila ya escrita y se ignoraría. Se retiene con un tramo sintético.
    if (tramoId && !estado.abierta && estado.filas.has(tramoId)) tramoId = ''
    if (!tramoId) {
      const texto = String(entrada.texto || '').trim()
      if (!texto) {
        // Sin audio medido ni texto no hay tramo: se cuenta, no se inventa.
        sesion.contarDescarte('huerfano', null, entrada.tramo ?? null)
        return sesion.snapshot()
      }
      // Texto tardío de una locución nueva: el tramo real venció; se retiene
      // con un tramo sintético para que abra SU locución. No se descarta por
      // parecerse a la fila anterior: el único dedupe es por TRAMO
      // (`tramoYaCommiteado`), no por prefijo de texto.
      tramoId = tramoSinteticoParaTexto()
    }
    // REENTREGA: UN solo dueño (`esReentregaDeLaFila`). Si no es reentrega y el
    // tramo ya está commiteado, la frase nueva necesita SU id (sintético).
    if (esReentregaDeLaFila(entrada, tramoId)) {
      contarReentrega(null, null)
      return sesion.snapshot()
    }
    if (tramoId && estado.filas.has(tramoId)) tramoId = tramoSinteticoParaTexto()
    // Voz DECLARADA por el productor (si existe): la puerta sigue siendo
    // `frontera.ts`; la partición REAL por medida vive en `verificarCambioVoz`.
    const abiertaParaVoz = estado.abierta
    const vozEntrante = String(entrada.voz?.vozId || '').trim()
    const vozAbierta = String(abiertaParaVoz?.voz.vozId || '').trim()
    if (abiertaParaVoz && vozEntrante && vozAbierta && vozEntrante !== vozAbierta) {
      const fronteraDeclarada = fronteraPorVoz()
      if (fronteraDeclarada.cerrar) {
        await sesion.cerrarLocucion(
          abiertaParaVoz,
          'system',
          fronteraDeclarada.causa ?? 'voz',
          abiertaParaVoz.final,
        )
      }
    }
    // La ATRIBUCIÓN va después de la VOZ: si el tramo entrante es otra voz, ya
    // se abrió SU locución; si no, el texto decide continuación/pendiente.
    // Un `final` del ASR NO cierra la locución (solo la marca): la puerta es
    // la frontera (voz medida o silencio medido).
    const tramoVoz = await verificarCambioVoz(tramoId)
    const tramoDestino = tramoDestinoDeTexto(
      tramoVoz ?? tramoId,
      entrada.texto,
      entrada.silencioPrevioMs,
    )
    await flujo.procesarResultadoAsr({ ...entrada, tramoId: tramoDestino })
    return sesion.snapshot()
  }

  /**
   * Medida TEMPRANA de la voz: con el puerto y audio retenido suficiente, se
   * embebe en el worker mientras la locución sigue abierta (como hacía el
   * preflight, pero decidida por el módulo). La continuación vuelve por la cola
   * ÚNICA: el estado solo muta serializado. Un fallo se registra y no rompe la
   * locución (cerrará con continuidad/semilla).
   */
  function lanzarMedidaSiCorresponde(locucion: LocucionAbierta, sampleRate: number): void {
    const embebedor = dependencias.embebedor
    if (!embebedor || String(locucion.voz.vozId || '').trim() || estado.medidaVozEnCurso) {
      return
    }
    const totalMuestras = estado.muestrasAbierta.reduce(
      (suma, bloque) => suma + bloque.length,
      0,
    )
    if (sampleRate > 0) {
      const minimo = Math.max(1, Math.round(configuracion.minSegundosVozMedida * sampleRate))
      if (totalMuestras < minimo) return
      // Un intento fallido NO se repite por bloque: cada intento copia TODO el
      // audio retenido y lanza un embed. Sin este freno la medida se relanzaba
      // en cada bloque (medido 2026-10-31, sesión 89a0d948: 19.886 intentos y
      // ~31.000 trazas en 182 s de audio; la UI se congelaba). Se reintenta solo
      // cuando el búfer creció lo mínimo que ya justifica volver a medir.
      // El paso lo fija el mínimo para ACUÑAR una voz nueva (`minNuevaVozMs`):
      // medir cada 1,5 s no puede cambiar la identidad y deja una cola de
      // embeddings que retrasa el cierre (medido 2026-11-10: 55 medidas en la
      // ventana stop→cierre, 31 con vector).
      const pasoReintento = Math.max(
        minimo,
        Math.round(((Number(dependencias.config.minNuevaVozMs?.()) || 0) / 1000) * sampleRate),
      )
      if (totalMuestras - estado.muestrasEnUltimoIntento < pasoReintento) return
      estado.muestrasEnUltimoIntento = totalMuestras
    }
    const locutionId = locucion.locutionId
    estado.medidaVozEnCurso = true
    // La medida cubre TODO el audio retenido: el contador del cambio de voz
    // (Caso 1+3) arranca en el fin cubierto por esta medida.
    marcarMedido(locucion.locutionId, locucion.fin)
    // Se mide la VENTANA de identidad (la misma que `verificarCambioVoz`), no el
    // búfer completo: en la sesión 8149df78, 12 de 124 mediciones copiaban hasta
    // 709.824 muestras para extraer un vector de 512.
    const ventanaMedida = Math.max(1, Math.round(configuracion.minSegundosVozMedida * sampleRate))
    const colaMedida = colaDeMuestras(estado.muestrasAbierta, ventanaMedida)
    const vozMs = vozMsDeMuestras(colaMedida, sampleRate)
    embebedor.medir(colaMedida, sampleRate).then(
      (vector) =>
        encolar(() =>
          Promise.resolve().then(() => aplicarMedidaVoz(locutionId, vector, vozMs)),
        ).catch(
          (error: unknown) => {
            // AGENTS §1.5: ningún fallo capturado se pierde. La medida no se
            // reintenta; la locución cierra con la evidencia que tenga.
            logCaughtError('conversacion.voz.medida.aplicar.fallo', error, {
              sessionId: estado.sessionId,
              locutionId,
            })
            estado.medidaVozEnCurso = false
          },
        ),
      (error) =>
        encolar(() =>
          Promise.resolve().then(() => {
            estado.medidaVozEnCurso = false
            dependencias.registro.registrar('conversacion.voz.medida.fallo', {
              sessionId: estado.sessionId,
              locutionId,
              error,
            })
          }),
        ),
    )
  }

  /**
   * Decide la identidad de un vector medido contra las plantillas de la sesión.
   * Único constructor de la decisión dentro de la ingesta (medida temprana,
   * partición por voz y medida tardía). El llamador garantiza el embebedor.
   */
  function decidirIdentidadSesion(
    vector: readonly number[],
    embebedor: NonNullable<typeof dependencias.embebedor>,
    duracionMs = 0,
  ): IdentidadDecidida {
    return decidirIdentidad({
      vector,
      plantillas: plantillasDeSesion(estado.plantillasVoz, dependencias.anclasBase),
      umbral: dependencias.config.umbralContinuidadVoz(),
      duracionMs,
      minNuevaVozMs: dependencias.config.minNuevaVozMs?.() ?? 0,
      umbralExistente:
        dependencias.config.umbralExistenteVoz?.() ?? dependencias.config.umbralContinuidadVoz(),
      // Perezoso: la plantilla SOLO se resuelve si la voz es nueva (Caso 10).
      etiquetaNueva: () => dependencias.config.etiquetaAnonima(estado.contadorVoces + 1),
      comparar: embebedor.comparar,
      id: dependencias.id.uuid,
    })
  }

  /**
   * Reemplaza la etiqueta TEMPORAL de una fila ya commiteada por la de su medida
   * tardía (mandato del dueño 2026-10-30: «puedes poner un hablante temporal si
   * aun no llega, y cuando lo tengas reemplazar»). Solo aplica a filas de ESTA
   * sesión que sigan pendientes: cualquier otra fila es inmutable.
   * @param locucionId Fila commiteada que espera su medida.
   * @param vector Vector medido de su audio.
   */
  async function reetiquetarConMedidaTardia(
    locucionId: string,
    vector: readonly number[],
    vozMs: number,
  ): Promise<void> {
    const embebedor = dependencias.embebedor
    const fila = estado.filas.get(locucionId)
    if (!embebedor || !fila || fila.deleted) return
    if (fila.sessionId !== estado.sessionId) return
    if (fila.evidencia !== 'pendiente') return
    const identidad = decidirIdentidadSesion(vector, embebedor, vozMs)
    registrarMedidaVoz(estado, vector, identidad)
    if (!String(identidad.vozId || '').trim()) return
    const aplicada = await sesion.reetiquetarFila(locucionId, identidad.vozId, identidad.hablante)
    dependencias.registro.registrar('conversacion.fila.medida.tardia', {
      sessionId: estado.sessionId,
      locutionId: locucionId,
      vozId: identidad.vozId,
      hablante: identidad.hablante,
      aplicada,
    })
  }

  /**
   * Aplica la medida a la locución abierta (dentro de la cola): una sola vez.
   * Si la locución ya cerró, la medida no se pierde: reetiqueta su fila si nació
   * con la etiqueta temporal.
   */
  async function aplicarMedidaVoz(
    locucionId: string,
    vector: readonly number[] | null,
    vozMs = 0,
  ): Promise<void> {
    estado.medidaVozEnCurso = false
    const embebedor = dependencias.embebedor
    if (!embebedor) return
    if (!vector) {
      // Una medida TEMPRANA fallida NO es la medida de la locución: la ventana
      // de 1,5 s puede caer en una pausa y el audio completo sí tener voz. Marcarla
      // aquí como insuficiente congelaba la fila en «Hablante XX» aunque el cierre
      // midiera un vector válido (defecto medido 2026-11-11). La insuficiencia se
      // declara SOLO en el cierre, que mide el audio real de la locución.
      return
    }
    const abierta = estado.abierta
    const esSuya =
      abierta !== null &&
      abierta.locutionId === locucionId &&
      !String(abierta.voz.vozId || '').trim()
    if (!esSuya || abierta === null) {
      await reetiquetarConMedidaTardia(locucionId, vector, vozMs)
      return
    }
    const identidad = decidirIdentidadSesion(
      vector,
      embebedor,
      // La duración que decide la voz nueva es la VOZ medida, no el tramo.
      vozMs,
    )
    registrarMedidaVoz(estado, vector, identidad)
    estado.abierta = conIdentidadVoz(abierta, identidad)
  }

  return {
    ingestaAudio,
    ingestaAsr,
    drenarResultadosAsr,
    cerrarPendienteAsr,
    finalizarPendientes: flujo.finalizarPendientes,
  }
}
