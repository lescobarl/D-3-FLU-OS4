/**
 * CIERRE de la locución: apertura, revisión, etiqueta, fila y promoción.
 *
 * Es la única puerta que escribe filas del módulo: aplica `decidirRevision`
 * (regla 3), `construirFila` (reglas 4–5) y `promoverFila`; nunca borra, nunca
 * muta la entrada. El estado lo posee la sesión, que lo entrega como contexto.
 */
import { construirFila, fusionarVoz, promoverFila } from './fila.ts'
import type { CierreLocucion, VozEtiqueta } from './fila.ts'
import { decidirRevision } from './revision.ts'
import { decidirIdentidad } from './identidad.ts'
import { concatenarMuestras } from './muestras.ts'
import { logCaughtError } from '../../lib/caughtError.ts'
import type {
  CausaCierre,
  ContarDescarte,
  EventoConversacion,
  EvidenciaVoz,
  LocucionAbierta,
} from './tipos.ts'
import type {
  AlmacenPort,
  ConfigPort,
  EmbebedorPort,
  Fila,
  IdiomaLocucion,
  IdPort,
  MotivoCierre,
  RegistroPort,
  TramoMuestreado,
} from './ports.ts'

/** Parte del estado de sesión que consumen las reglas de cierre. */
export type EstadoCierre = {
  sessionId: string | null
  abierta: LocucionAbierta | null
  ultimaEtiqueta: string
  ultimaVozId: string
  filas: Map<string, Fila>
  nombresPorVoz: Map<string, string>
  muestrasAbierta: Float32Array[]
  ultimoVectorVoz: number[] | null
  contadorVoces: number
}

/** Servicios que la sesión entrega a las reglas de cierre. */
export type ContextoCierre = Readonly<{
  estado: EstadoCierre
  emitir(evento: EventoConversacion): void
  emitirCaja(): void
  contarDescarte: ContarDescarte
  registro: RegistroPort
  almacen: AlmacenPort
  config: ConfigPort
  /** Generador UUIDv4: la voz nueva acuña su identidad (medida de respaldo). */
  id: IdPort
  /** Embeddings inyectados; sin puerto no hay medida (solo continuidad/semilla). */
  embebedor?: EmbebedorPort
}>

/** Datos de apertura de la única locución abierta. */
export type DatosApertura = Readonly<{
  tramoId: string
  texto: string
  tramo: TramoMuestreado
  turnId: string
  idioma: IdiomaLocucion
  voz: EvidenciaVoz
}>

/** Reglas de cierre que la sesión publica en su superficie. */
export type ReglasCierre = Readonly<{
  abrirLocucion(datos: DatosApertura): void
  aplicarRevision(
    locucion: LocucionAbierta,
    texto: string,
    final: boolean,
    voz: EvidenciaVoz,
  ): boolean
  cerrarLocucion(
    locucion: LocucionAbierta,
    motivo: MotivoCierre,
    causa: CausaCierre,
    final: boolean,
  ): Promise<void>
  promoverSiCorresponde(tramoId: string, texto: string): Promise<boolean>
}>

/**
 * Resuelve la evidencia de voz de una locución con el nombre registrado, si lo hay.
 * Es pura: la sesión aporta el mapa voz→nombre y la continuidad ya calculada.
 * @param voz Evidencia de voz del tramo.
 * @param continuidadVoz Continuidad calculada por el módulo al abrir o al recibir la primera medida.
 * @param nombresPorVoz Nombres confirmados por voz en la sesión.
 * @returns La voz resuelta que consume `resolverEtiqueta`.
 */
export function resolverVoz(
  voz: EvidenciaVoz,
  continuidadVoz: boolean,
  nombresPorVoz: ReadonlyMap<string, string>,
): VozEtiqueta {
  const vozId = String(voz.vozId || '').trim()
  const registrado = vozId ? nombresPorVoz.get(vozId) : undefined
  const nombre =
    registrado ?? (voz.nombreConfirmado ? String(voz.nombre || '').trim() : '')
  return {
    nombre,
    nombreConfirmado: Boolean(nombre),
    hablante: String(voz.hablante || '').trim(),
    // La continuidad la decide el MÓDULO (`abrirLocucion`/`aplicarRevision`):
    // la evidencia entrante no puede afirmar que otra voz continúa la anterior.
    continuidad: continuidadVoz,
  }
}

/**
 * Crea las reglas de cierre sobre el estado de una sesión.
 * @param contexto Estado de sesión, emisión, almacén, config y registro.
 * @returns Apertura, revisión, cierre y promoción de filas.
 */
export function crearReglasCierre(contexto: ContextoCierre): ReglasCierre {
  const { estado, emitir, emitirCaja, contarDescarte, registro, almacen, config, id, embebedor } =
    contexto

  /** Abre la única locución abierta; el llamador garantiza que no hay otra. */
  function abrirLocucion(datos: DatosApertura): void {
    const vozId = String(datos.voz.vozId || '').trim()
    const continuidadVoz = vozId
      ? vozId === estado.ultimaVozId
      : Boolean(estado.ultimaEtiqueta)
    if (vozId) estado.ultimaVozId = vozId
    estado.muestrasAbierta = []
    estado.abierta = {
      locutionId: datos.tramoId,
      texto: datos.texto,
      inicio: datos.tramo.inicio,
      fin: datos.tramo.fin,
      sampleRate: datos.tramo.sampleRate,
      turnId: datos.turnId,
      idioma: datos.idioma,
      voz: datos.voz,
      final: false,
      continuidadVoz,
    }
    registro.registrar('conversacion.locucion.abierta', {
      sessionId: estado.sessionId,
      locutionId: datos.tramoId,
      tramo: datos.tramo,
    })
    if (datos.texto) emitirCaja()
  }

  /** Aplica texto a la locución abierta ANTES de evaluar la frontera (regla 2). */
  function aplicarRevision(
    locucion: LocucionAbierta,
    texto: string,
    final: boolean,
    voz: EvidenciaVoz,
  ): boolean {
    const decision = decidirRevision({
      tramoAbierto: { id: locucion.locutionId, texto: locucion.texto },
      tramoId: locucion.locutionId,
      texto,
      final: locucion.final || final,
    })
    const vozId = String(voz.vozId || '').trim()
    let continuidadVoz = locucion.continuidadVoz
    if (vozId && !String(locucion.voz.vozId || '').trim()) {
      continuidadVoz = vozId === estado.ultimaVozId
    }
    if (vozId) estado.ultimaVozId = vozId
    const siguiente: LocucionAbierta = {
      ...locucion,
      texto: decision.pintar ? decision.texto : locucion.texto,
      final: locucion.final || final,
      voz: fusionarVoz(locucion.voz, voz),
      continuidadVoz,
    }
    estado.abierta = siguiente
    if (siguiente.texto !== locucion.texto) emitirCaja()
    return siguiente.final
  }

  /**
   * Medida de respaldo al cerrar: una locución que se midió en el habla (ingesta)
   * ya trae `vozId` y no entra aquí. Sin medida temprana, se embebe el PCM retenido
   * y se decide la identidad ANTES de construir la fila; un fallo de la medida se
   * registra y la locución cierra con la evidencia que tenía.
   */
  async function medirVozAlCerrar(locucion: LocucionAbierta): Promise<EvidenciaVoz> {
    if (
      !embebedor ||
      String(locucion.voz.vozId || '').trim() ||
      estado.muestrasAbierta.length === 0
    ) {
      return locucion.voz
    }
    const muestras = concatenarMuestras(estado.muestrasAbierta)
    let vector: readonly number[] | null = null
    try {
      vector = await embebedor.medir(muestras, locucion.sampleRate)
    } catch (error) {
      // AGENTS §1.5: el catch registra por logCaughtError con la excepción.
      logCaughtError('conversacion.voz.medida.fallo', error, {
        sessionId: estado.sessionId,
        locutionId: locucion.locutionId,
      })
    }
    if (!vector) return locucion.voz
    const identidad = decidirIdentidad({
      vector,
      ultimoVozId: estado.ultimaVozId,
      ultimoVector: estado.ultimoVectorVoz,
      umbral: config.umbralContinuidadVoz(),
      etiquetaNueva: config.etiquetaAnonima(estado.contadorVoces + 1),
      comparar: embebedor.comparar,
      id: id.uuid,
    })
    if (!identidad.continuidad) estado.contadorVoces += 1
    estado.ultimaVozId = identidad.vozId
    estado.ultimoVectorVoz = [...vector]
    return {
      vozId: identidad.vozId,
      hablante: identidad.hablante,
      continuidad: identidad.continuidad,
    }
  }

  /** Cierra la locución abierta: una fila o un descarte contado (regla 4). */
  async function cerrarLocucion(
    locucion: LocucionAbierta,
    motivo: MotivoCierre,
    causa: CausaCierre,
    final: boolean,
  ): Promise<void> {
    const sesion = estado.sessionId ?? ''
    const tramo: TramoMuestreado = {
      inicio: locucion.inicio,
      fin: locucion.fin,
      sampleRate: locucion.sampleRate,
    }
    const vozMedida = await medirVozAlCerrar(locucion)
    const vozCerrada = vozMedida === locucion.voz ? locucion.voz : fusionarVoz(locucion.voz, vozMedida)
    const continuidadVoz =
      vozMedida === locucion.voz ? locucion.continuidadVoz : Boolean(vozMedida.continuidad)
    const cierre: CierreLocucion = {
      locutionId: locucion.locutionId,
      sessionId: sesion,
      turnId: locucion.turnId,
      inicio: locucion.inicio,
      fin: locucion.fin,
      sampleRate: locucion.sampleRate,
      texto: locucion.texto,
      idioma: locucion.idioma,
      overlap: Boolean(locucion.voz.overlap),
      final,
      reason: motivo,
      voz: resolverVoz(vozCerrada, continuidadVoz, estado.nombresPorVoz),
      etiquetaAnterior: estado.ultimaEtiqueta || null,
      semillaEtiqueta: config.semillaEtiqueta(),
      esEtiquetaAnonima: config.esEtiquetaAnonima,
    }
    estado.abierta = null
    estado.muestrasAbierta = []
    emitirCaja()

    const resultado = construirFila(cierre)
    if (!resultado.fila) {
      emitir({
        tipo: 'locution.closed',
        sessionId: sesion,
        locutionId: locucion.locutionId,
        tramo,
        motivo,
        causa,
      })
      contarDescarte(resultado.descarte, locucion.locutionId, tramo)
      registro.registrar('conversacion.locucion.cerrada', {
        sessionId: sesion,
        locutionId: locucion.locutionId,
        tramo,
        motivo,
        causa,
        descarte: resultado.descarte,
      })
      return
    }

    const fila = await almacen.guardar(resultado.fila)
    estado.filas.set(fila.locutionId, fila)
    estado.ultimaEtiqueta = fila.etiqueta
    emitir({
      tipo: 'locution.closed',
      sessionId: sesion,
      locutionId: fila.locutionId,
      tramo,
      motivo,
      causa,
    })
    emitir({ tipo: 'row.committed', sessionId: sesion, fila })
    emitir({
      tipo: 'speaker.labeled',
      sessionId: sesion,
      locutionId: fila.locutionId,
      etiqueta: fila.etiqueta,
      evidencia: fila.evidencia,
    })
    registro.registrar('conversacion.locucion.cerrada', {
      sessionId: sesion,
      locutionId: fila.locutionId,
      tramo,
      motivo,
      causa,
      descarte: null,
    })
  }

  /** Si el tramo ya se cerró, promueve su fila; nunca abre una segunda. */
  async function promoverSiCorresponde(tramoId: string, texto: string): Promise<boolean> {
    const previa = estado.filas.get(tramoId)
    if (!previa) return false
    const cambios = promoverFila(previa, texto)
    if (cambios) {
      const actualizada = await almacen.actualizar(tramoId, cambios)
      if (actualizada) {
        estado.filas.set(tramoId, actualizada)
        estado.ultimaEtiqueta = actualizada.etiqueta
        emitir({
          tipo: 'row.committed',
          sessionId: actualizada.sessionId,
          fila: actualizada,
        })
      }
    }
    return true
  }

  return { abrirLocucion, aplicarRevision, cerrarLocucion, promoverSiCorresponde }
}
