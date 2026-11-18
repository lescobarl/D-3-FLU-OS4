/**
 * TEXTO del ASR: eco/barge-in, revisión, pendientes y cierre por texto.
 *
 * El texto se aplica a la locución ANTES de evaluar la frontera (regla 2). Un
 * tramo ajeno sin silencio suficiente se retiene y se abre al cerrar la actual;
 * un huérfano expira contado. No escribe filas: pide el cierre a la sesión.
 */
import { continuaLaFrase } from '../core/locucion.js'
import { esEcoDeTts } from './eco.ts'
import { decidirFrontera } from './frontera.ts'
import type { DecisionFrontera } from './frontera.ts'
import { filaQueCubre, ultimaFilaPorFin, ventanaDentroDe } from './fila.ts'
import type { Pendientes } from './cola.ts'
import type { RegistroTramos } from './tramos.ts'
import type { Sesion } from './sesion.ts'
import type {
  AsrIngestado,
  DependenciasConversacion,
  EntradaPendiente,
  EvidenciaVoz,
  LocucionAbierta,
  TextoDeReentrega,
} from './tipos.ts'
import type {
  ConfiguracionConversacion,
  IdiomaLocucion,
  MedidaMotor,
  MedidaVad,
  MotivoCierre,
  TramoMuestreado,
} from './ports.ts'

/** Superficie del flujo de texto que compone la ingesta. */
export type FlujoTexto = Readonly<{
  procesarResultadoAsr(entrada: AsrIngestado): Promise<void>
  flushPendientes(): Promise<void>
  finalizarPendientes(motivo: MotivoCierre): Promise<void>
  /** Cierre ÚNICO por frontera: funde lo retenido antes del tiempo y cierra. */
  cerrarPorFrontera(frontera: DecisionFrontera): Promise<void>
}>

/**
 * Crea el flujo de texto de la sesión.
 * @param opciones Puertos, sesión, registro de tramos y retén de pendientes.
 * @returns Procesamiento de resultados, apertura de pendientes y finalización.
 */
export function crearFlujoTexto({
  dependencias,
  configuracion,
  sesion,
  tramos,
  pendientes,
  contarReentrega,
  esReentrega,
  tramoParaTexto,
  sumarAudioAtribuido,
}: {
  dependencias: Pick<DependenciasConversacion, 'reloj' | 'ultimoTextoDicho' | 'config' | 'partidor'>
  configuracion: ConfiguracionConversacion
  sesion: Sesion
  tramos: RegistroTramos
  pendientes: Pendientes
  /** Dueño del motivo `turnoYaEscrito` (inyectado por `ingesta`). */
  contarReentrega: (locutionId: string | null, tramo: TramoMuestreado | null) => void
  /**
   * Dueño ÚNICO de «este texto es la reentrega de una fila ya escrita»: la
   * INGESTA lo implementa y lo inyecta; este flujo solo pregunta. El volcado
   * del stop usa la MISMA puerta que la ingesta: antes tenía su propio criterio
   * por texto y las dos puertas no coincidían (defecto medido 2026-11-12).
   */
  esReentrega: (entrada: TextoDeReentrega, tramoId: string) => boolean
  /**
   * Acuña el tramo de un texto que llegó sin tramo vivo. El id lo pide a la
   * ingesta (dueño del tramo sintético); aquí no se inventa un id inline.
   */
  tramoParaTexto: () => string
  /**
   * Atribuye a la locución abierta el audio de un tramo AJENO cuyo texto se
   * fundió en ella (el audio acompaña al texto). La INGESTA es dueña de la
   * medida; este flujo solo la invoca para cada tramo que se funde.
   */
  sumarAudioAtribuido: (tramoId: string) => void
}): FlujoTexto {
  const estado = sesion.estado

  /**
   * Abre la locución con los datos ya resueltos por el flujo de texto. Es el
   * ÚNICO ensamblado de `DatosApertura` en este flujo: los caminos aportan sus
   * datos y el dueño de la apertura aplica defaults y normaliza.
   * @param datos Campos resueltos por el llamador.
   */
  function abrirDesde(datos: {
    tramoId: string
    texto: string
    tramo: TramoMuestreado
    turnId: string
    idioma: IdiomaLocucion
    voz: EvidenciaVoz
    finalLlego: boolean
    medidaMotor?: MedidaMotor
    muestrasIniciales?: readonly Float32Array[] | null
  }): void {
    sesion.abrirLocucion({
      tramoId: datos.tramoId,
      texto: sinPrefijoDeLaFilaAnterior(datos.texto, datos.voz, false, datos.tramo),
      tramo: datos.tramo,
      turnId: datos.turnId,
      idioma: datos.idioma,
      voz: datos.voz,
      finalLlego: datos.finalLlego,
      medidaMotor: datos.medidaMotor,
      ...(datos.muestrasIniciales ? { muestrasIniciales: datos.muestrasIniciales } : {}),
    })
    // Confirmación del final: si la locución abre con SU final ya llegado, la
    // ventana se arma desde ahora y la frontera adelanta la fila con silencio
    // confirmado (el final solo arma, no cierra).
    if (datos.finalLlego) estado.confirmacionFinalDesdeMs = dependencias.reloj.ahora()
    // La línea abierta es la frase viva: el pendiente ya no manda en la caja.
    sesion.mostrarPendiente('')
  }

  /**
   * ¿Dos ventanas son el MISMO audio? Solo entonces el texto de la fila
   * anterior puede estar contenido en el texto entrante.
   * @param a Ventana entrante.
   * @param b Ventana de la fila anterior.
   */
  function seSolapanEnAudio(
    a: { inicio: number; fin: number; sampleRate: number } | null | undefined,
    b: { inicio: number; fin: number; sampleRate: number } | null | undefined,
  ): boolean {
    if (!a || !b) return false
    if (Number(a.sampleRate) !== Number(b.sampleRate)) return false
    return a.fin > b.inicio && b.fin > a.inicio
  }

  /**
   * Quita el prefijo ya commiteado SOLO cuando el audio es el mismo (partición
   * de voz o ventana solapada). Una frase NUEVA que empieza como la anterior no
   * se recorta: sus palabras son suyas (regla 12).
   * @param texto Texto entrante.
   * @param voz Voz del tramo entrante.
   * @param partidaDeVoz La partición declara que el prefijo es audio ya commiteado.
   * @param tramoNuevo Ventana del tramo entrante (si se conoce).
   */
  function sinPrefijoDeLaFilaAnterior(
    texto: string,
    voz: EvidenciaVoz,
    partidaDeVoz = false,
    tramoNuevo: { inicio: number; fin: number; sampleRate: number } | null = null,
  ): string {
    // La fila anterior es la que CUBRE el audio entrante: con filas commiteadas
    // fuera de orden (volcado del stop) «la última por fin» no es la dueña del
    // prefijo. Sin ventana entrante o sin cobertura se conserva la última.
    const previa =
      (tramoNuevo ? filaQueCubre(tramoNuevo, estado.filas.values()) : null) ??
      ultimaFilaPorFin(estado.filas.values())
    const previo = String(previa?.texto || '').trim()
    const nuevo = String(texto || '').trim()
    if (!previo || !nuevo) return nuevo
    // Un COMANDO completo con wake no se recorta si la fila anterior era SOLO
    // la wake (un parcial del mismo comando). Si la fila anterior tiene texto,
    // el entrante es una continuación y sí se recorta.
    const previoEsSoloWake =
      Boolean(previo) &&
      !String(dependencias.partidor.partir(previo).paraMostrar || '').trim()
    if (
      previoEsSoloWake &&
      dependencias.partidor.partir(nuevo).paraMostrar !== nuevo
    ) {
      return nuevo
    }
    const etiqueta = String(previa?.etiqueta || '').trim()
    const hablante = String(voz?.hablante || '').trim()
    // Solo se deduplica cuando la fila anterior es de la MISMA voz (o quedó
    // pendiente sin etiqueta). Una voz DISTINTA conserva su frase completa.
    const mismaVoz =
      previa?.evidencia === 'pendiente' ||
      previa?.evidencia === 'semilla' ||
      (Boolean(etiqueta) && Boolean(hablante) && etiqueta === hablante)
    // Y SOLO si el audio es el mismo: una frase nueva no pierde su inicio.
    const mismoAudio = partidaDeVoz || seSolapanEnAudio(tramoNuevo, previa?.tramo)
    if (!mismoAudio) return nuevo
    // En una PARTICIÓN de voz el prefijo pertenece al audio ya commiteado,
    // sea de la voz que sea: la etiqueta nueva (N) no impide el recorte.
    if (!mismaVoz && !partidaDeVoz) return nuevo
    if (nuevo.toLowerCase().startsWith(previo.toLowerCase())) {
      const resto = nuevo.slice(previo.length).trim()
      // Texto idéntico: sin partición es la MISMA frase dicha otra vez (fila
      // legítima, se conserva). Con partición de voz TODO el texto pertenece
      // al audio ya commiteado: la voz nueva NO re-incluye nada de la fila
      // anterior y su locución sigue vacía hasta su cola propia.
      return resto || (partidaDeVoz ? '' : nuevo)
    }
    return nuevo
  }

  /** Datos de apertura de un pendiente (dueño único del literal). */
  function datosPendiente(
    p: {
      tramoId: string
      texto: string
      idioma: Parameters<typeof abrirDesde>[0]['idioma']
      voz: Parameters<typeof abrirDesde>[0]['voz']
      final: boolean
      medida?: Parameters<typeof abrirDesde>[0]['medidaMotor']
    },
    tramo: Parameters<typeof abrirDesde>[0]['tramo'],
    muestrasIniciales: Parameters<typeof abrirDesde>[0]['muestrasIniciales'],
    turnId: string,
  ): Parameters<typeof abrirDesde>[0] {
    return {
      tramoId: p.tramoId,
      texto: p.texto,
      tramo,
      turnId,
      idioma: p.idioma,
      voz: p.voz,
      finalLlego: p.final,
      medidaMotor: p.medida,
      muestrasIniciales,
    }
  }

  /** Cierra la locución abierta si la frontera lo pide (dueño único: frontera.ts). */
  async function cerrarPorFrontera(frontera: DecisionFrontera): Promise<void> {
    if (!frontera.cerrar || !frontera.causa) return
    const locucion = estado.abierta
    if (!locucion) return
    // Frontera de TIEMPO: lo retenido ANTES del silencio es del MISMO bloque que
    // cierra y se funde en SU fila. Cambio de voz NO: la retenida es de la voz
    // nueva y abre su propia fila (regla 10).
    if (frontera.causa !== 'voz') fundirPendientesPrevios()
    // Tras la fusión la abierta es OTRO objeto: se cierra el vigente, no el
    // capturado (que perdería el texto fundido).
    const vigente = estado.abierta ?? locucion
    await sesion.cerrarLocucion(vigente, 'system', frontera.causa, vigente.final)
  }

  /**
   * Funde en la locución abierta los pendientes retenidos ANTES de una frontera
   * de TIEMPO. El pendiente se retuvo porque su texto no continuaba la frase,
   * pero llegó antes del silencio de cierre: es parte del MISMO bloque y la
   * conversación lo debe a UNA fila (regla 3: la caja solo se parte por tiempo o
   * cambio de hablante — el tiempo aún no llegaba cuando se retuvo). Sin esta
   * fusión la frontera commiteaba A sola y el flush abría la retenida como fila
   * propia: texto partido sin frontera real (defecto medido en vivo 2026-11-12,
   * sesión fd148fe7: «Hablante XX» era el mismo hablante de la fila anterior).
   *
   * Puertas de `seFundeEnLaAbierta`: voz distinta medida (regla 10) o audio
   * ANTERIOR al de A no se funden; la abierta debe tener texto (un caparazón
   * vacío no hereda pendientes ajenos). Lo no fundido vuelve al retén para las
   * puertas existentes (flush del cambio de voz, volcado del stop).
   */
  function fundirPendientesPrevios(): void {
    const abierta = estado.abierta
    if (!abierta || !String(abierta.texto || '').trim()) return
    // El retén expira lo que ya no es frase: mismo ciclo de vida que el flush.
    pendientes.expurgar()
    const lotes = sinReentregas(
      drenarPendientes().sort((a, b) => ordenDePendiente(a) - ordenDePendiente(b)),
    )
    for (const lote of lotes) {
      if (!seFundeEnLaAbierta(abierta, lote)) {
        pendientes.encolar(lote)
        continue
      }
      // El audio acompaña al texto: la medida del cierre cubre el tramo fundido
      // (su hablante, su hora de voz) aunque sea un tramo ajeno al de A.
      if (String(lote.tramoId || '').trim()) sumarAudioAtribuido(lote.tramoId)
      sesion.aplicarRevision(
        estado.abierta ?? abierta,
        lote.texto,
        Boolean(abierta.final || lote.final),
        lote.voz,
        lote.medida,
        String(lote.tramoId || '').trim() || tramoParaTexto(),
        true,
      )
    }
    // La caja vuelve a la línea abierta: el pendiente fundido ya no manda en ella.
    sesion.mostrarPendiente('')
  }

  /**
   * Puertas de la fusión: la retenida entra en la fila que cierra SOLO si no
   * hay evidencia de que pertenezca a otro bloque o a otra voz.
   * @param abierta Locución que cierra por tiempo.
   * @param p Pendiente retenido antes de la frontera.
   */
  function seFundeEnLaAbierta(abierta: LocucionAbierta, p: EntradaPendiente): boolean {
    // Voz distinta MEDIDA en ambos lados: es otro hablante (regla 10) y su texto
    // se queda en el retén para abrir su propia fila.
    const vozAbierta = String(abierta.voz.vozId || '').trim()
    const vozPendiente = String(p.voz.vozId || '').trim()
    if (vozAbierta && vozPendiente && vozAbierta !== vozPendiente) return false
    // Sin audio REAL no hay qué fundir: la fila no hereda texto sin evidencia
    // (el pendiente sin tramo sigue su curso: retén → stop → huérfano contado).
    const tramo =
      p.tramo ?? (String(p.tramoId || '').trim() ? tramos.resolver(p.tramoId) : null)
    if (!tramo) return false
    // Audio ANTERIOR al de A: es de un bloque previo (su locución cerró por voz y
    // no lo absorbió). Su texto no pertenece a la fila que cierra ahora.
    if (tramo.inicio < abierta.inicio) return false
    // AUDIO A CABALLO DEL CIERRE: el tramo del pendiente EMPIEZA dentro de A y
    // SIGUE después de su fin — la voz estaba en curso cuando A cerró (medido
    // 2026-11-12 19:05: tramo [2632832,2786560] con fin 2735232 de A; el tronco
    // abrió la locución siguiente sobre ESE mismo tramo). Fundirla pegaba a A
    // una habla que vuelve entera en su propia fila: el mismo texto en dos
    // filas. La retenida sigue su curso (flush/stop), igual que la ráfaga que
    // llega DESPUÉS del cierre (fd148fe7).
    if (tramo.inicio < abierta.fin && tramo.fin > abierta.fin) return false
    return true
  }

  /**
   * El final solo completa la frase si su ventana cabe DENTRO del tramo ya
   * cerrado de la locución (un final con ventana ajena no la marca).
   */
  function finalDentroDeLaAbierta(
    abierta: LocucionAbierta,
    entrada: AsrIngestado,
  ): boolean {
    return (
      Boolean(entrada.final) &&
      (!entrada.tramo ||
        ventanaDentroDe(entrada.tramo, {
          inicio: abierta.inicio,
          fin: abierta.fin,
          sampleRate: abierta.sampleRate,
        }))
    )
  }

  /**
   * Aplica el texto/final a la locución abierta. La frontera NO se evalúa aquí:
   * el silencio lo decide `ingestaAudio` y la voz `ingestaAsr`, ambos con el
   * dueño único `frontera.ts`. Así un final no cierra ni se mide con el silencio
   * de APERTURA del tramo.
   */
  function aplicarTextoDeLaAbierta(
    abierta: LocucionAbierta,
    texto: string,
    finalValido: boolean,
    voz: EvidenciaVoz,
    medida: MedidaMotor | undefined,
    tramoOrigen: string,
  ): void {
    // La línea ACUMULADA del producto re-incluye el texto de la última fila ya
    // commiteada; se queda solo la cola nueva ANTES de la revisión. Con
    // `partidaDeVoz` el prefijo pertenece al audio ya commiteado, sea de la
    // voz que sea (dueño único `sinPrefijoDeLaFilaAnterior`).
    const textoAplicado = sinPrefijoDeLaFilaAnterior(texto, voz, abierta.partidaDeVoz, abierta)
    sesion.aplicarRevision(
      abierta,
      textoAplicado,
      finalValido,
      voz,
      finalValido ? medida : undefined,
      tramoOrigen,
    )
    // El resultado actualizó la frase viva: la caja vuelve a la línea abierta.
    sesion.mostrarPendiente('')
  }

  /** Idioma de la locución: la nube queda fija al arrancar; local autodetecta. */
  function idiomaDe(entrada: AsrIngestado): IdiomaLocucion {
    if (estado.motorAsr === 'cloud') return estado.idiomaActual
    return entrada.idioma ?? estado.idiomaActual
  }

  /** Retiene un texto de tramo ajeno sin mezclarlo con la locución abierta. */
  function encolar(entrada: AsrIngestado, tramoId: string, texto: string): void {
    // El tramo se captura AL ENCOLAR: el registro lo expira a los 8 s y, si se
    // resolviera al stop, el pendiente perdería su ventana real (fila con un
    // tramo inventado de una muestra y la hora del stop).
    //
    // Sin tramo NI audio real no hay fila: el pendiente conserva su id vacío y
    // el stop lo cuenta `huerfano` (regla 1: la ventana no se inventa). Si el
    // texto trae tramo real, se captura aquí aunque el registro expire después.
    const vigente = tramos.vigente(tramoId)
    const tramo =
      entrada.tramo ??
      (vigente
        ? { inicio: vigente.inicio, fin: vigente.fin, sampleRate: vigente.sampleRate }
        : undefined)
    pendientes.encolar({
      tramoId: String(tramoId || '').trim(),
      texto,
      final: Boolean(entrada.final),
      idioma: idiomaDe(entrada),
      turnId: entrada.turnId ? String(entrada.turnId).trim() : estado.turnoActual,
      voz: entrada.voz ?? {},
      tramo,
      medida: entrada.medida,
      recibidoAt: dependencias.reloj.ahora(),
    })
    // La frase que se retiene es la que se está dictando AHORA: se pinta en la
    // caja aunque la locución anterior siga abierta (regla: transcribir al oír).
    const ultimo = pendientes.ultimo()
    sesion.mostrarPendiente(ultimo?.texto ?? '', ultimo?.tramoId ?? '')
  }

  /**
   * Drena el retén. El agrupado por enunciado ya lo hizo `cola.encolar`; aquí
   * solo se descarta el grupo SIN texto (`huerfano`). Un grupo con texto nunca
   * se tira.
   */
  function drenarPendientes(): EntradaPendiente[] {
    const lotes: EntradaPendiente[] = []
    for (;;) {
      const siguiente = pendientes.primero()
      if (!siguiente) break
      pendientes.quitarPrimero()
      if (!String(siguiente.texto || '').trim()) {
        sesion.contarDescarte('huerfano', siguiente.tramoId, siguiente.tramo ?? null)
        continue
      }
      lotes.push(siguiente)
    }
    return lotes
  }

  /**
   * Filtra las reentregas del stop (descarte contado) y devuelve el resto.
   * Usa la puerta ÚNICA de reentrega (`esReentrega`, inyectada por `ingesta`):
   * aquí no se re-decide por texto, así el volcado y la ingesta no divergen.
   * @revisor CREAR NUEVO — el stop necesitaba el mismo criterio de reentrega
   *   que la ingesta sin duplicar el descarte por audio.
   */
  function sinReentregas(lotes: readonly EntradaPendiente[]): EntradaPendiente[] {
    return lotes.filter((lote) => {
      if (!esReentrega(lote, lote.tramoId)) return true
      contarReentrega(lote.tramoId, lote.tramo ?? null)
      return false
    })
  }

  /**
   * Orden de un pendiente por el inicio REAL de su audio. Un pendiente con texto
   * NUNCA se tira en el volcado salvo que sea reentrega (`sinReentregas`).
   */
  function ordenDePendiente(p: EntradaPendiente): number {
    const inicio = Number(p.tramo?.inicio)
    return Number.isFinite(inicio) ? inicio : Number.MAX_SAFE_INTEGER
  }

  /**
   * Resuelve el tramo REAL de un pendiente. Sin audio real no hay fila: el id
   * vacío puede pedirse a la ingesta, pero la ventana NUNCA se inventa.
   * @param p Pendiente drenado, con su tramo declarado o su id.
   * @returns El id resuelto y su ventana real, o null si no tiene audio.
   */
  function tramoDePendiente(
    p: EntradaPendiente,
  ): Readonly<{ tramoId: string; tramo: TramoMuestreado }> | null {
    const existente = String(p.tramoId || '').trim()
    const tramo = p.tramo ?? tramos.resolver(existente)
    if (!tramo) return null
    // El id vacío lo acuña la ingesta (dueño del tramo sintético): una locución
    // sin UUIDv4 no puede escribir `row.committed`.
    return { tramoId: existente || tramoParaTexto(), tramo }
  }

  /** Abre el primer grupo; el resto queda retenido en orden de audio. */
  async function flushPendientes(): Promise<void> {
    // El retén expira lo que ya no es una frase (texto vacío): su ciclo de vida
    // se cumple aquí, en la única puerta que lo vuelca en orden.
    pendientes.expurgar()
    if (estado.abierta) return
    const lotes = sinReentregas(
      drenarPendientes().sort(
        (a, b) => ordenDePendiente(a) - ordenDePendiente(b),
      ),
    ).filter((lote) => {
      // Una frase pendiente que ya tiene fila (mismo tramo/locución) es una
      // REENTREGA: no se reabre con su `inicio` viejo, porque la conversación es
      // insert-only (regla 4) y la fila se estiraría con audio ajeno. Mismo muro
      // que `finalizarPendientes`.
      const tramoId = String(lote.tramoId || '').trim()
      if (!tramoId || !estado.filas.has(tramoId)) return true
      sesion.contarDescarte('huerfano', tramoId, lote.tramo ?? null)
      return false
    })
    const primero = lotes[0]
    if (!primero) return
    for (const lote of lotes.slice(1)) pendientes.encolar(lote)
    // Un pendiente SIN tramo real espera al stop de sesión: un `final` no es
    // frontera y no puede inventar una locución (reglas 1/2/3). Solo se abre
    // con su audio real y siempre después de una frontera (voz/tiempo).
    const tramo = primero.tramo ?? tramos.resolver(primero.tramoId)
    if (!tramo) {
      pendientes.encolar(primero)
      return
    }
    // El pendiente nace DESPUÉS de su habla: se siembra con SU audio retenido
    // para que la identidad de voz no se mida sobre el silencio o la voz ajena.
    const muestrasIniciales = tramos.muestras(primero.tramoId, tramo)
    // El turno VIGENTE manda: el pendiente esperó al commit de la locución
    // anterior y el hook ya avanzó el turno.
    abrirDesde(
      datosPendiente(primero, tramo, muestrasIniciales, estado.turnoActual || primero.turnId),
    )
  }

  /** Al cerrar la sesión, cada FRASE pendiente acaba en UNA fila o descarte. */
  async function finalizarPendientes(motivo: MotivoCierre): Promise<void> {
    const lotes = drenarPendientes().sort(
      (a, b) => ordenDePendiente(a) - ordenDePendiente(b),
    )
    if (estado.abierta) {
      const abierta = estado.abierta
      const primero = lotes[0]
      // A y el primer grupo solo se funden si son la MISMA frase o la MISMA voz.
      // Si son frases ajenas, A se cierra ANTES y el grupo emite su fila; nunca
      // se deja que `unirRevision` conserve A y pierda B (o al revés).
      const misma =
        Boolean(primero) && continuaLaFrase(abierta.texto, primero.texto)
      if (primero && misma) {
        sesion.aplicarRevision(
          abierta,
          primero.texto,
          Boolean(abierta.final || primero.final),
          primero.voz,
          primero.medida,
          primero.tramoId,
          true,
        )
        lotes.shift()
      }
      const cerrada = estado.abierta ?? abierta
      await sesion.cerrarLocucion(cerrada, motivo, 'stop', cerrada.final)
    }
    for (const siguiente of sinReentregas(lotes)) {
      if (!String(siguiente.texto || '').trim()) {
        sesion.contarDescarte('huerfano', siguiente.tramoId, siguiente.tramo ?? null)
        continue
      }
      const resuelto = tramoDePendiente(siguiente)
      if (!resuelto) {
        sesion.contarDescarte('huerfano', siguiente.tramoId, siguiente.tramo ?? null)
        continue
      }
      const { tramoId, tramo } = resuelto
      // Una frase pendiente que ya tiene fila (mismo tramo/locuciA3n) es una
      // reentrega del turno: no se abre otra locuciA3n fantasma al stop. El
      // motivo lo cuenta el dueA�o del descarte como huAcrfano (ingesta es quien
      // decide la reentrega de un turno).
      if (estado.filas.has(tramoId)) {
        sesion.contarDescarte('huerfano', tramoId, tramo)
        continue
      }
      const muestrasIniciales = tramos.muestras(tramoId, tramo)
      abrirDesde(
        datosPendiente(
          { ...siguiente, tramoId },
          tramo,
          muestrasIniciales,
          siguiente.turnId,
        ),
      )
      const locucion = estado.abierta
      if (locucion) await sesion.cerrarLocucion(locucion, motivo, 'stop', locucion.final)
    }
    sesion.mostrarPendiente('')
  }

  /** Procesa un resultado ya identificado por tramo (cola ordenada). */
  async function procesarResultadoAsr(entrada: AsrIngestado): Promise<void> {
    const sesionId = sesion.exigirActiva()
    const tramoId = String(entrada.tramoId || '').trim()
    // SIN TRAMO solo es huérfano si NO hay locución abierta (regla 1). Con la
    // locución abierta, el texto sin tramo es de otra frase que el VAD no
    // segmentó: entra por la puerta de texto ajeno (se retiene como pendiente y
    // su llegada evalúa la frontera), nunca se tira en silencio.
    if (!tramoId && !estado.abierta) {
      sesion.mostrarPendiente('')
      sesion.contarDescarte('huerfano', null, null)
      return
    }

    let texto = String(entrada.texto || '')

    if (dependencias.config.esComandoDeControl?.(texto)) {
      // El texto se pintó como pendiente fuera de la cola; un control no es
      // conversación y no debe quedarse en la caja.
      sesion.mostrarPendiente('')
      // El comando de control no es conversación, pero su PARCIAL ya está en la
      // línea abierta. Si este texto pertenece a esa misma locución, se aplica
      // el texto completo y se cierra por la puerta única de cierre, que lo
      // descarta como «control» (cierre.ts). Medido 2026-11-12 18:25:32: el
      // parcial «cer» quedó abierto y el stop lo publicó como fila; el final
      // «cerrando escucha» llegó después y se tiraba.
      const abierta = estado.abierta
      if (abierta && tramoId && abierta.locutionId === tramoId) {
        aplicarTextoDeLaAbierta(abierta, texto, true, entrada.voz ?? {}, undefined, tramoId)
        await sesion.cerrarLocucion(estado.abierta ?? abierta, 'system', 'asr', true)
        return
      }
      sesion.contarDescarte('control', tramoId, null)
      return
    }

    const dicho = String(dependencias.ultimoTextoDicho() || '').trim()
    if (dicho) {
      if (esEcoDeTts(texto, dicho, dependencias.config.echoMinPalabrasCola())) {
        sesion.mostrarPendiente('')
        sesion.contarDescarte('eco', tramoId, null)
        return
      }
      sesion.emitir({
        tipo: 'barge.in',
        sessionId: sesionId,
        locutionId: estado.abierta?.locutionId ?? tramoId,
        texto,
      })
    }

    const voz = entrada.voz ?? {}
    const turnId = entrada.turnId ? String(entrada.turnId).trim() : estado.turnoActual
    if (entrada.turnId) estado.turnoActual = turnId

    if (!estado.abierta) await flushPendientes()

    let abierta = estado.abierta
    // El caparazón abierto por AUDIO no tiene texto todavía: la línea acumulada
    // del producto puede repetir la ÚLTIMA FILA ya commiteada. Se queda solo la
    // cola nueva; dueño único `sinPrefijoDeLaFilaAnterior`.
    if (abierta && !String(abierta.texto || '').trim() && String(texto).trim()) {
      texto = sinPrefijoDeLaFilaAnterior(texto, voz, abierta.partidaDeVoz, abierta)
    }
    // MISMO tramo del ASR, pero frase que NO continúa la abierta: es un aporte
    // NUEVO. Se retiene con tramo propio para que el cierre la AÑADA; aplicarla
    // al tramo abierto sustituía el principio de la mujer por su cola.
    if (
      abierta &&
      abierta.locutionId === tramoId &&
      String(abierta.texto || '').trim() &&
      String(texto || '').trim() &&
      !texto.toLowerCase().startsWith(abierta.texto.toLowerCase()) &&
      !continuaLaFrase(abierta.texto, texto)
    ) {
      encolar(entrada, tramoId, texto)
      return
    }
    // Una locución ABIERTA y VACÍA no puede bloquear el texto que llega de otro
    // tramo: se cierra descartada (sinTexto) y el texto abre su propia locución.
    if (
      abierta &&
      !String(abierta.texto || '').trim() &&
      tramoId &&
      tramoId !== abierta.locutionId &&
      String(texto || '').trim()
    ) {
      await cerrarPorFrontera(
        decidirFrontera(
          {
            medida: { hayVoz: true, silencioMs: 0 },
            textoAjeno: true,
            abierta: true,
          },
          configuracion,
        ),
      )
      abierta = estado.abierta
    }
    if (abierta && abierta.locutionId === tramoId) {
      // Caso 7+6: el final SOLO completa la frase si su ventana cabe DENTRO del
      // tramo cerrado de la locución (un final con ventana ajena no la marca).
      const finalValido = finalDentroDeLaAbierta(abierta, entrada)
      // MANDATO DEL DUEÑO (2026-10-30): el final MARCA la frase completa pero NO
      // cierra: la puerta de cierre es la frontera (silencio medido o cambio de
      // voz medido). Sin cierres ansiosos, la fila sale UNA vez con la frase
      // completa, no palabras cortas por cada final.
      aplicarTextoDeLaAbierta(abierta, texto, finalValido, voz, entrada.medida, tramoId)
      // Confirmación del final: el final válido arma la ventana que la frontera
      // consume (silencio de reloj sin voz). Un interino no arma nada.
      if (finalValido) estado.confirmacionFinalDesdeMs = dependencias.reloj.ahora()
      // Sin flush aquí: ver la nota de `flushPendientes` (turno vigente).
      return
    }

    if (abierta) {
      // El `final` del ASR NO cierra (regla 3): solo marca la frase. La línea
      // anterior se cierra por voz medida o por tiempo; mientras tanto el texto
      // que no continúa se retiene como pendiente.
      // La frontera por TIEMPO se mide con el silencio MEDIDO antes del tramo
      // entrante, no con el hueco de índices ni con la última medida acumulada.
      const silencioPrevioMs =
        entrada.silencioPrevioMs ??
        tramos.vigente(tramoId)?.silencioPrevioMs ??
        0
      // La MISMA FRASE la decide `continuaLaFrase`; la voz ya la verificó
      // `ingesta.verificarCambioVoz` sobre el tramo entrante antes de llegar aquí.
      const continua = continuaLaFrase(abierta.texto, texto)
      const medidaVad: MedidaVad = { hayVoz: false, silencioMs: silencioPrevioMs }
      // UNA sola puerta: `frontera.ts` decide con silencio medido o voz distinta.
      const frontera = decidirFrontera({
        medida: medidaVad,
        textoAjeno: true,
        abierta: true,
      }, configuracion)
      if (frontera.cerrar) {
        await cerrarPorFrontera(frontera)
        encolar(entrada, tramoId, texto)
        // El grupo pendiente se abre EN EL ACTO: la caja pinta la frase nueva
        // antes del stop.
        await flushPendientes()
        return
      }
      if (!continua) {
        // Texto que NO continúa y NINGUNA frontera medida: es otra frase, pero
        // A no se cierra. Queda pendiente hasta el silencio o la voz distinta.
        encolar(entrada, tramoId, texto)
        return
      }
      // MISMA frase y sin frontera: el texto entra en la abierta y la caja lo
      // pinta ya.
      const finalValido = finalDentroDeLaAbierta(abierta, entrada)
      aplicarTextoDeLaAbierta(abierta, texto, finalValido, voz, entrada.medida, tramoId)
      // Confirmación del final: la continuación puede traer el final de la
      // frase completa; si es válido arma la ventana de la frontera.
      if (finalValido) estado.confirmacionFinalDesdeMs = dependencias.reloj.ahora()
      return
    }

    const tramo = tramos.resolver(tramoId, entrada.tramo)
    if (!tramo) {
      encolar(entrada, tramoId, texto)
      return
    }
    // El final puede llegar después de sonar su tramo: se siembra su audio
    // retenido (si lo hay) para que la voz de la fila sea la de SU hablante.
    const muestrasIniciales = tramos.muestras(tramoId, tramo)
    abrirDesde({
      tramoId,
      texto,
      tramo,
      turnId,
      idioma: idiomaDe(entrada),
      voz,
      finalLlego: Boolean(entrada.final),
      medidaMotor: entrada.medida,
      muestrasIniciales,
    })
    // MANDATO DEL DUEÑO (2026-10-30): el final MARCA la frase completa pero NO
    // cierra; la locución abierta espera la frontera (silencio, voz, ajeno, fin).
  }

  return { procesarResultadoAsr, flushPendientes, finalizarPendientes, cerrarPorFrontera }
}
