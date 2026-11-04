/**
 * SUPERFICIE PASIVA del módulo CONVERSACIÓN (modo wake sin conversación activa).
 *
 * Mandato 2026-10-30 (problema 6): UNA sola ruta de la fila del usuario. El
 * escritor pasivo (`commitUserTurnRow` + `crearEscritorFilaUsuario`) era un
 * SEGUNDO dueño de esa decisión y quedó RETIRADO: la fila la escribe SOLO el
 * módulo (`row.committed`, puerta de abajo: silencio, cambio de voz o cierre),
 * en AMBOS modos.
 *
 * Aquí quedan las dos superficies pasivas que NO escriben filas por su cuenta:
 *  - la RESOLUCIÓN del hablante (medida + `decidirIdentidad`): alimenta el
 *    contrato de resolución del turno; la fila sigue siendo del módulo;
 *  - el RENOMBRE de UNA fila concreta por su id (migración de la fachada,
 *    consumidor vivo: `useParticipants`).
 *
 * Puro: sin `Date.now()` (reloj inyectado), sin acceso al store ni a los dueños
 * vivos del proyecto (llegan por puertos).
 */
import { decidirIdentidad } from './identidad.ts'
import type { PlantillaVozConId } from './identidad.ts'
import { logCaughtError } from '../../lib/caughtError.ts'
import type {
  ConfigPort,
  EmbebedorPort,
  IdPort,
  PuertoVistaFilas,
  RegistroPort,
  UtilidadesFila,
} from './ports.ts'

/** Dependencias del renombre de una fila concreta de la vista. */
export type DependenciasRenombreFila = Readonly<{
  vista: Pick<PuertoVistaFilas, 'leerHistorial' | 'fijarNombre'>
  utilidades: Pick<UtilidadesFila, 'canonica'>
}>

/**
 * Corrige el nombre de UNA fila concreta de usuario por su id (migración de la
 * fachada). No escribe filas: es la ÚNICA corrección de rótulo que sobrevive al
 * escritor retirado.
 * @param rowId Id de la fila en la vista.
 * @param speakerName Nombre que se fija (se canoniza con el dueño único).
 * @param deps Vista y utilidades delegadas.
 * @returns `true` si la fila existe, es de usuario y el nombre se fijó.
 */
export function renombrarFilaDeUsuario(
  rowId: string,
  speakerName: string,
  deps: DependenciasRenombreFila,
): boolean {
  const idFila = String(rowId || '')
  const nombre = deps.utilidades.canonica(String(speakerName || '').trim())
  if (!idFila || !nombre) return false
  const entry = deps.vista.leerHistorial().find((e) => e.id === idFila)
  if (!entry || entry.role !== 'user') return false
  deps.vista.fijarNombre(idFila, nombre)
  return true
}

/**
 * RESOLUCIÓN PASIVA del hablante (identidad nativa por puerto, decisión A).
 *
 * La MEDIDA la hace el embebedor del módulo (`EmbebedorPort.medir`, que ya
 * recorta la ventana de voz con `selectVoicedWindow`); la regla de identidad
 * es `decidirIdentidad` — el MISMO dueño único que usan `ingesta` y `cierre` —.
 * Un fallo de la medida se registra y la locución sigue SIN evidencia.
 */

/** Entrada de la resolución: audio retenido y memoria de voz de la sesión. */
export type EntradaResolucionPasiva = Readonly<{
  /** PCM retenido de la locución (cola ya acotada por el llamador). */
  muestras: Float32Array
  /** Frecuencia de las muestras. */
  sampleRate: number
  /** Plantillas de TODAS las voces medidas en la sesión (mejor coseno gana). */
  plantillas: readonly PlantillaVozConId[]
  /** Voces nuevas acuñadas hasta ahora (para la etiqueta anónima N+1). */
  contadorVoces: number
  /** Duración real del audio medido (misma puerta que el modo activo). */
  duracionMs?: number
}>

/** Resultado de la resolución: la voz que sostiene la locución y su evidencia. */
export type ResolucionPasiva = Readonly<{
  /** Voz decidida; `''` cuando no hubo medida (la fila nace sin evidencia). */
  vozId: string
  /** Etiqueta anónima SOLO para una voz nueva; la continuidad la hereda. */
  hablante: string
  /** ¿Es la misma voz que la locución anterior? */
  continuidad: boolean
  /** Hubo ventana medida: el rótulo propio está permitido. */
  evidencia: boolean
  /** Vector MEDIDO de la locución (la MISMA medida sirve de firma del turno); `null` sin medida. */
  vector: readonly number[] | null
}>

/** Dependencias de la resolución pasiva: medida y reglas, todo inyectado. */
export type DependenciasResolucionPasiva = Readonly<{
  embebedor: EmbebedorPort
  config: Pick<
    ConfigPort,
    'umbralContinuidadVoz' | 'etiquetaAnonima' | 'minNuevaVozMs'
  >
  id: Pick<IdPort, 'uuid'>
  registro: RegistroPort
}>

/** Resolutor del hablante del modo pasivo (medida asíncrona). */
export type ResolucionPasivaHablante = (
  entrada: EntradaResolucionPasiva,
) => Promise<ResolucionPasiva>

/**
 * Crea el resolutor del hablante del modo pasivo: mismo patrón de medida y
 * decisión que el cierre del modo activo (`cierre.medirVozAlCerrar`).
 * @param deps Embebedor, config de identidad, generador de ids y registro.
 * @returns El resolutor `resolverHablante`.
 */
export function crearResolucionPasiva(deps: DependenciasResolucionPasiva): ResolucionPasivaHablante {
  return async function resolverHablante(entrada: EntradaResolucionPasiva): Promise<ResolucionPasiva> {
    let vector: readonly number[] | null = null
    try {
      vector = await deps.embebedor.medir(entrada.muestras, entrada.sampleRate)
    } catch (error) {
      // AGENTS §1.5: el catch registra por logCaughtError con la excepción.
      logCaughtError('conversacion.pasivo.voz.medida.fallo', error)
    }
    if (!vector) {
      return { vozId: '', hablante: '', continuidad: false, evidencia: false, vector: null }
    }
    const duracionMs =
      entrada.duracionMs ??
      (entrada.sampleRate > 0
        ? (entrada.muestras.length / entrada.sampleRate) * 1000
        : 0)
    const identidad = decidirIdentidad({
      vector,
      plantillas: entrada.plantillas,
      umbral: deps.config.umbralContinuidadVoz(),
      duracionMs,
      minNuevaVozMs: deps.config.minNuevaVozMs?.() ?? 0,
      // Perezoso: la plantilla SOLO se resuelve si la voz es nueva (Caso 10).
      etiquetaNueva: () => deps.config.etiquetaAnonima(entrada.contadorVoces + 1),
      comparar: deps.embebedor.comparar,
      id: deps.id.uuid,
    })
    return {
      vozId: identidad.vozId,
      hablante: identidad.hablante,
      continuidad: identidad.continuidad,
      evidencia: true,
      vector,
    }
  }
}
