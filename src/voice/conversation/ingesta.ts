/**
 * INGESTA del módulo CONVERSACIÓN: audio, drenaje del ASR y cierre pendiente.
 *
 * Mide con el VAD inyectado, corta el tramo y evalúa la frontera; el flujo de
 * texto (eco, revisión, pendientes) vive en `texto.ts`. No escribe filas: pide
 * el cierre a la sesión.
 */
import { decidirFrontera } from './frontera.ts'
import { crearFlujoTexto } from './texto.ts'
import type { FlujoTexto } from './texto.ts'
import type { Pendientes } from './cola.ts'
import type { BufferAsr, RegistroTramos } from './tramos.ts'
import type { Sesion } from './sesion.ts'
import { decidirIdentidad, plantillasDe } from './identidad.ts'
import type { IdentidadDecidida } from './identidad.ts'
import { concatenarMuestras, retenerCola } from './muestras.ts'
import { fusionarVoz } from './fila.ts'
import { registrarMedidaVoz } from './sesion.ts'
import { asrEmpujaAudio } from './ports.ts'
import { logCaughtError } from '../../lib/caughtError.ts'
// Dueño único de «¿este texto continúa la locución o abre otra?»: el módulo no
// reimplementa la comparación de palabras ni la revisión del ASR.
import { continuaLaFrase } from '../core/locucion.js'
import type { ConfiguracionConversacion, MotivoCierre } from './ports.ts'
import type {
  AsrIngestado,
  BloqueAudio,
  DependenciasConversacion,
  InstantaneaConversacion,
  LocucionAbierta,
  TramoAudio,
} from './tipos.ts'

/** Superficie de ingesta que consume el motor. */
export type Ingesta = Readonly<{
  ingestaAudio(bloque: BloqueAudio): Promise<InstantaneaConversacion>
  ingestaAsr(entrada: AsrIngestado): Promise<InstantaneaConversacion>
  drenarResultadosAsr(): Promise<void>
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
    'reloj' | 'id' | 'vad' | 'asr' | 'ultimoTextoDicho' | 'config' | 'registro' | 'embebedor'
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
  const flujo: FlujoTexto = crearFlujoTexto({
    dependencias,
    sesion,
    tramos,
    pendientes,
  })

  /**
   * Tramo de un resultado que no trae id: el vigente al PROCESAR (la cola ya
   * ingirió el audio) y, si no hay ninguno abierto, el último medido, que
   * destina el final tardío del tramo ya cerrado.
   */
  function tramoVigente(): string {
    return (
      estado.tramoAudio?.tramoId ||
      estado.abierta?.locutionId ||
      estado.ultimoTramoId ||
      ''
    )
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
   * Suma al PCM de la locución abierta el audio de un tramo cuyo TEXTO se le
   * atribuyó (la frase sigue tras una pausa interna). El audio sigue a la
   * atribución del texto: el tramo de una voz DISTINTA no continúa la frase y
   * no entra aquí. Sin esto la medida se quedaba con el primer tramo (240 ms
   * de voz medidos en 89a0d948/263adae9) y nunca alcanzaba el piso de voz: la
   * fila nacía temporal y su medida no llegaba jamás.
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
  }

  /**
   * Tramo al que PERTENECE un texto del ASR (problema 1/3: el texto se colgaba
   * del tramo de audio más reciente aunque la frase abierta fuera otra, y la
   * frase acababa partida en dos filas).
   *
   * El texto es de la locución ABIERTA cuando el tramo que trae no es el suyo
   * pero la frase sigue viva: el texto la CONTINÚA (dueño `continuaLaFrase`:
   * revisión del ASR o crecimiento; el reconocedor reemite la frase completa
   * tras una pausa interna) y no la separa más que la ventana de CIERRE del
   * plan (`silenceCloseMs`).
   * Dentro de esa ventana la pausa del VAD no parte la frase: partirla por el
   * silencio mínimo de 900 ms duplicaba la fila (medido en la sesión
   * 89a0d948/263adae9: dos finales del mismo enunciado, 300 y 330 caracteres).
   * Sin texto previo manda el hueco mínimo (la locución aún no afirma nada) y,
   * fuera de la ventana de cierre, manda el tramo: el texto abre otra locución.
   * @param tramoId Tramo que declaró (o al que se destinó) el resultado.
   * @param texto Texto del resultado.
   * @returns El `tramoId` de destino, ya atribuido.
   */
  function tramoDestinoDeTexto(tramoId: string, texto: string): string {
    const abierta = estado.abierta
    if (!abierta) return tramoId
    const previo = String(abierta.texto || '').trim()
    const textoLimpio = String(texto || '').trim()
    const continua = previo !== '' && textoLimpio !== '' && continuaLaFrase(previo, textoLimpio)
    if (abierta.locutionId === tramoId) {
      // MISMO TRAMO: con su audio VIVO el texto es una revisión de la locución
      // (el producto compone los fragmentos del reconocedor en una línea). SIN
      // audio vivo, el id llegó del RESPALDO (locución abierta o último tramo):
      // el texto solo entra si CONTINÚA la frase. Si no, es otra frase que el
      // VAD no segmentó y va SIN tramo a la puerta de texto ajeno. Sin esta
      // prueba un final ajeno reescribía la fila abierta (defecto medido en el
      // playback 2026-10-31: 93 caracteres donde iban 41).
      if (estado.tramoAudio?.tramoId === tramoId) return tramoId
      if (!textoLimpio || previo === '' || continua) return tramoId
      return ''
    }
    // Sin tramo vigente (silencio en curso): el texto que CONTINÚA la frase es
    // de la locución abierta; sin esa prueba no hay a quién atribuirlo.
    if (!tramoId) return continua ? abierta.locutionId : tramoId
    const tramo = tramos.resolver(tramoId)
    if (!tramo) return continua ? abierta.locutionId : tramoId
    const huecoMs = ((tramo.inicio - abierta.fin) / abierta.sampleRate) * 1000
    const destino = continua
      ? huecoMs <= configuracion.silenceCloseMs
        ? abierta.locutionId
        : tramoId
      : huecoMs > configuracion.minSilenceMs || previo
        ? tramoId
        : abierta.locutionId
    // El audio acompaña al texto: la evidencia de voz de la fila es la de TODO
    // el audio que produjo su frase, no solo el del primer tramo.
    if (destino === abierta.locutionId) sumarAudioAtribuido(tramoId)
    return destino
  }

  /** Drena los resultados del `AsrPort` en orden; el tramo se fija al drenar. */
  async function drenarResultadosAsr(): Promise<void> {
    for (const crudo of bufferAsr.drenar()) {
      const tramoVigenteId = crudo.tramoId || tramoVigente()
      const tramoId = tramoDestinoDeTexto(tramoVigenteId, crudo.texto)
      await flujo.procesarResultadoAsr({ ...crudo, tramoId })
    }
  }

  /** Cierra lo abierto si el ASR avisó de un estado terminal (watchdog/error). */
  async function cerrarPendienteAsr(): Promise<void> {
    if (!estado.cierreAsrPendiente) return
    const motivo = estado.cierreAsrPendiente
    estado.cierreAsrPendiente = null
    if (estado.abierta) {
      const locucion = estado.abierta
      await sesion.cerrarLocucion(locucion, motivo, 'asr', locucion.final)
    }
    // Sin flush aquí: el pendiente se abre con el turno vigente del siguiente
    // evento (o al cerrar la sesión, que los finaliza contados).
  }

  /** Ingesta un bloque de audio: mide, corta el tramo y evalúa la frontera. */
  async function ingestaAudio(bloque: BloqueAudio): Promise<InstantaneaConversacion> {
    sesion.exigirActiva()
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
    if (estado.tramoAudio && estado.tramoAudio.sampleRate !== sampleRate) {
      throw new Error(
        `sampleRate inconsistente en el tramo ${estado.tramoAudio.tramoId}: ${estado.tramoAudio.sampleRate} != ${sampleRate}`,
      )
    }
    if (bloque.turnId) estado.turnoActual = String(bloque.turnId).trim()
    // El pendiente espera a este bloque para abrir: aquí el turno ya es el
    // vigente DESPUÉS del commit que lo liberó (el hook lo avanza al commitear,
    // y el siguiente bloque lo trae). Abrirlo dentro del cierre le pegaba el
    // turno viejo y el gate `turnoYaEscrito` descartaba una fila legítima.
    if (!estado.abierta) await flujo.flushPendientes()

    const medida =
      bloque.medida ??
      (dependencias.vad
        ? dependencias.vad.medir(bloque.muestras, sampleRate)
        : null)
    if (!medida) throw new Error('falta medida VAD: sin medida no hay frontera')
    estado.ultimaMedida = medida

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
        if (
          estado.abierta &&
          !String(estado.abierta.texto).trim() &&
          huecoMs >= configuracion.silenceCloseMs
        ) {
          await sesion.cerrarLocucion(estado.abierta, 'system', 'voz', false)
        }
        if (!estado.abierta) {
          sesion.abrirLocucion({
            tramoId,
            texto: '',
            tramo: { inicio, fin, sampleRate },
            turnId: estado.turnoActual,
            idioma: estado.idiomaActual,
            voz: {},
          })
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
      if (estado.abierta && estado.abierta.locutionId === actualizado.tramoId) {
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
        if (estado.abierta && estado.abierta.locutionId === cortado.tramoId) {
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
      // Solo el audio de SU tramo alimenta EN VIVO la medida de la locución
      // abierta. El de un tramo ajeno se retiene para ESE tramo y entra en la
      // locución únicamente si su TEXTO se atribuye a ella (continuación de la
      // frase: `sumarAudioAtribuido`). Sumar en vivo el audio de otra voz
      // contaminaba la medida y acuñaba etiquetas falsas (problema 3).
      const suyo = !estado.tramoAudio || estado.tramoAudio.tramoId === abierta.locutionId
      if (suyo) {
        estado.muestrasAbierta = retenerCola(
          estado.muestrasAbierta,
          bloque.muestras,
          configuracion.maxSegundosVozRetenida * sampleRate,
        )
      }
      lanzarMedidaSiCorresponde(abierta, sampleRate)
    }
    if (abierta) {
      const frontera = decidirFrontera({
        medida,
        textoAjeno: false,
        abierta: true,
      })
      if (frontera.cerrar) {
        await sesion.cerrarLocucion(abierta, 'system', 'silencio', abierta.final)
        // El pendiente NO se abre aquí (turno viejo): el siguiente bloque o
        // resultado lo abre con el turno vigente (ver `flushPendientes` arriba).
      }
    }
    return sesion.snapshot()
  }

  /** Ingesta un resultado del ASR por su tramo (regla 3). */
  async function ingestaAsr(entrada: AsrIngestado): Promise<InstantaneaConversacion> {
    sesion.exigirActiva()
    await drenarResultadosAsr()
    await cerrarPendienteAsr()
    const tramoId = String(entrada.tramoId || '').trim() || tramoVigente()
    if (!tramoId) {
      // Sin audio medido no hay tramo: se cuenta, no se inventa uno.
      sesion.contarDescarte('huerfano', null, entrada.tramo ?? null)
      return sesion.snapshot()
    }
    // Caso 1+3: antes de atribuir el texto, ¿cambió la voz DENTRO del tramo
    // abierto? Si partió, el texto es de la voz nueva y va a SU tramo. La
    // atribución va PRIMERO: un texto de la frase abierta no puede verificar el
    // cambio de voz de un tramo ajeno.
    const tramoAtribuido = tramoDestinoDeTexto(tramoId, entrada.texto)
    // Cambio de hablante DECLARADO por el ASR: si la evidencia entrante trae
    // otra voz que la abierta, la anterior cierra por 'voz' y el texto abre la
    // nueva. Es una de las DOS puertas del producto (silencio o cambio de
    // hablante); el texto ajeno por sí solo ya no cierra (auditoría 2026-11-01).
    const abiertaParaVoz = estado.abierta
    const vozEntrante = String(entrada.voz?.vozId || '').trim()
    const vozAbierta = String(abiertaParaVoz?.voz.vozId || '').trim()
    if (abiertaParaVoz && vozEntrante && vozAbierta && vozEntrante !== vozAbierta) {
      await sesion.cerrarLocucion(abiertaParaVoz, 'system', 'voz', abiertaParaVoz.final)
    }
    const tramoDestino = (await verificarCambioVoz(tramoAtribuido)) ?? tramoAtribuido
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
      if (totalMuestras - estado.muestrasEnUltimoIntento < minimo) return
      estado.muestrasEnUltimoIntento = totalMuestras
    }
    const locutionId = locucion.locutionId
    estado.medidaVozEnCurso = true
    // La medida cubre TODO el audio retenido: el contador del cambio de voz
    // (Caso 1+3) arranca en el fin cubierto por esta medida.
    estado.medidoHastaFin = Math.max(estado.medidoHastaFin, locucion.fin)
    embebedor.medir(concatenarMuestras(estado.muestrasAbierta), sampleRate).then(
      (vector) =>
        encolar(() => Promise.resolve().then(() => aplicarMedidaVoz(locutionId, vector))).catch(
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
  function decidirIdentidadSesion(vector: readonly number[], embebedor: NonNullable<typeof dependencias.embebedor>): IdentidadDecidida {
    return decidirIdentidad({
      vector,
      plantillas: plantillasDe(estado.plantillasVoz),
      umbral: dependencias.config.umbralContinuidadVoz(),
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
  ): Promise<void> {
    const embebedor = dependencias.embebedor
    const fila = estado.filas.get(locucionId)
    if (!embebedor || !fila || fila.deleted) return
    if (fila.sessionId !== estado.sessionId) return
    if (fila.evidencia !== 'pendiente') return
    const identidad = decidirIdentidadSesion(vector, embebedor)
    registrarMedidaVoz(estado, vector, identidad)
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
  ): Promise<void> {
    estado.medidaVozEnCurso = false
    const embebedor = dependencias.embebedor
    if (!embebedor || !vector) return
    const abierta = estado.abierta
    const esSuya =
      abierta !== null &&
      abierta.locutionId === locucionId &&
      !String(abierta.voz.vozId || '').trim()
    if (!esSuya || abierta === null) {
      await reetiquetarConMedidaTardia(locucionId, vector)
      return
    }
    const identidad = decidirIdentidadSesion(vector, embebedor)
    registrarMedidaVoz(estado, vector, identidad)
    estado.abierta = {
      ...abierta,
      voz: fusionarVoz(abierta.voz, {
        vozId: identidad.vozId,
        hablante: identidad.hablante,
        continuidad: identidad.continuidad,
      }),
      continuidadVoz: identidad.continuidad,
    }
  }

  /**
   * CASO 1+3 (ETIQUETAS Y MEZCLA) — cambio de voz dentro del tramo abierto.
   *
   * Con la locución abierta YA medida (vozId), un resultado del ASR sobre su
   * MISMO tramo comprueba si la voz cambió sin pausa: mide la VENTANA DE COLA
   * (los últimos `minSegundosVozMedida` del PCM retenido) y la compara contra el
   * último vector de la SESIÓN (DECISIÓN B: nada persiste entre sesiones). Si no
   * casa, parte el tramo en dos locuciones, cada una con su fila y su etiqueta.
   * Síncrono y en la cola ÚNICA: el texto del evento se atribuye a la voz nueva.
   *
   * @param tramoId Tramo que destina el resultado (resuelto por el módulo).
   * @returns El tramo de la voz nueva si hubo partición; null si no cambió.
   */
  async function verificarCambioVoz(tramoId: string): Promise<string | null> {
    const embebedor = dependencias.embebedor
    const abierta = estado.abierta
    if (!embebedor || !abierta || abierta.locutionId !== tramoId) return null
    // Sin medida aplicada no hay qué comparar (la medida temprana sigue su curso).
    const vozIdAbierta = String(abierta.voz.vozId || '').trim()
    if (!vozIdAbierta) return null
    // La ventana de cola se compara contra la plantilla de la MISMA voz abierta
    // (no contra la última voz de la sesión, que puede ser otra).
    const plantillaAbierta = estado.plantillasVoz.get(vozIdAbierta)
    if (!plantillaAbierta || plantillaAbierta.vector.length === 0) return null
    const ventana = Math.round(configuracion.minSegundosVozMedida * abierta.sampleRate)
    if (ventana <= 0 || abierta.fin - estado.medidoHastaFin < ventana) return null
    const retenidas = concatenarMuestras(estado.muestrasAbierta)
    if (retenidas.length < ventana) return null
    const cola = retenidas.slice(Math.max(0, retenidas.length - ventana))
    const finAlMedir = abierta.fin
    let vector: readonly number[] | null = null
    try {
      vector = await embebedor.medir(cola, abierta.sampleRate)
    } catch (error) {
      logCaughtError('conversacion.voz.cambio.fallo', error, {
        sessionId: estado.sessionId ?? '',
        locutionId: abierta.locutionId,
      })
      return null
    }
    const vigente = estado.abierta
    if (!vector || !vigente || vigente.locutionId !== tramoId) return null
    const previo = plantillaAbierta.vector
    const mismaVoz =
      vector.length === previo.length &&
      embebedor.comparar(vector, previo) >= dependencias.config.umbralContinuidadVoz()
    if (mismaVoz) {
      // Misma voz: la etiqueta se conserva y el tramo continuo NO cambia
      // de etiqueta; el contador avanza hasta el fin medido.
      estado.medidoHastaFin = Math.max(estado.medidoHastaFin, finAlMedir)
      return null
    }
    return partirLocucionPorVoz(cola, vector, finAlMedir)
  }

  /**
   * Parte la locución abierta por cambio de voz (Caso 1+3): la actual cierra en
   * el inicio de la ventana de cola medida (causa 'voz') y abre una locución
   * nueva con ESA ventana, ya medida contra el último vector de la sesión.
   * Dos voces sin pausa son DOS filas: el gate de consolidación no mezcla
   * voces distintas (cierre.ts) y esta partición es su ÚNICO dueño.
   *
   * @param ventana Ventana de cola medida (el audio de la voz nueva).
   * @param vector Vector de la ventana (voz nueva).
   * @param finAlMedir Fin del tramo al medir la ventana.
   * @returns El tramo nuevo si partió; null si la ventana no cabe en el tramo.
   */
  async function partirLocucionPorVoz(
    ventana: Float32Array,
    vector: readonly number[],
    finAlMedir: number,
  ): Promise<string | null> {
    const abierta = estado.abierta
    if (!abierta) return null
    const limite = finAlMedir - ventana.length
    if (limite <= abierta.inicio || limite >= abierta.fin) return null
    const sampleRate = abierta.sampleRate
    const turno = abierta.turnId
    const idioma = abierta.idioma
    const finalAnterior = abierta.final
    // 1. La locución de la voz anterior cierra en el límite de la ventana medida.
    estado.abierta = { ...abierta, fin: limite }
    await sesion.cerrarLocucion(estado.abierta, 'system', 'voz', finalAnterior)
    // 2. La voz nueva abre su locución sobre la MISMA ventana de audio.
    const tramoId = dependencias.id.uuid()
    const nuevo: TramoAudio = {
      tramoId,
      inicio: limite,
      fin: finAlMedir,
      sampleRate,
      turnId: turno,
      silencioPrevioMs: 0,
    }
    estado.tramoAudio = nuevo
    estado.ultimoTramoId = tramoId
    tramos.registrar(nuevo)
    // La ventana medida ES el audio de este tramo: si un pendiente lo abre
    // después, su voz se mide sobre su propia evidencia.
    retenerTramo(tramoId, limite, finAlMedir, ventana, sampleRate)
    sesion.abrirLocucion({
      tramoId,
      texto: '',
      tramo: { inicio: limite, fin: finAlMedir, sampleRate },
      turnId: turno,
      idioma,
      voz: {},
    })
    // 3. Identidad de la voz nueva con el MISMO vector (etiqueta perezosa, Caso 10).
    const embebedor = dependencias.embebedor
    const recien = estado.abierta
    if (!embebedor || !recien) return null
    const identidad = decidirIdentidadSesion(vector, embebedor)
    registrarMedidaVoz(estado, vector, identidad)
    estado.abierta = {
      ...recien,
      voz: fusionarVoz(recien.voz, {
        vozId: identidad.vozId,
        hablante: identidad.hablante,
        continuidad: identidad.continuidad,
      }),
      continuidadVoz: identidad.continuidad,
    }
    // 4. La ventana medida ES el audio de la voz nueva (la anterior se descartó
    //    con su cierre); el contador del cambio arranca al fin medido.
    estado.muestrasAbierta = [ventana]
    estado.medidoHastaFin = Math.max(estado.medidoHastaFin, finAlMedir)
    dependencias.registro.registrar('conversacion.locucion.partida', {
      sessionId: estado.sessionId ?? '',
      locutionId: tramoId,
      anterior: abierta.locutionId,
      limite,
      turnId: turno,
    })
    return tramoId
  }

  return {
    ingestaAudio,
    ingestaAsr,
    drenarResultadosAsr,
    cerrarPendienteAsr,
    finalizarPendientes: flujo.finalizarPendientes,
  }
}
