/**
 * ADAPTADORES del módulo CONVERSACIÓN.
 *
 * Es el ÚNICO archivo del módulo que importa fuera de `src/voice/conversation/`.
 * Todo acceso externo pasa por aquí; el resto del módulo solo conoce `ports.ts`.
 *
 * Alcance medido de `src/voice/api/**` (superficie pública disponible hoy):
 *  - config:  wake words y etiqueta semilla;
 *  - audio:   `splitTranscriptAtWakeWord`;
 *  - voz:     ASR de nube/local. `ultimoTextoDicho` NO se adapta aquí: lo entrega
 *    el consumidor como dependencia obligatoria (el módulo no habla). La ÚNICA
 *    instancia de reconocimiento la posee el hook (Anexo B, invariante 1) y
 *    entrega sus resultados a `producto.ts` por `evento()`: el módulo no crea
 *    una segunda escucha ni importa esas fachadas (su grafo arrastraría
 *    `lib/speechRecognitionLocal.js`, con imports sin extensión, y rompería el
 *    `viteConfigNativenessGuard`).
 *  - nada de: captura de micrófono ni extracción de embeddings (puertos inyectables).
 *    La fila SÍ se persiste, por el escritor ÚNICO de `core/db`; el cableado de
 *    producto restante se declara PENDIENTE en `docs/LAE-cola-ejecucion.md`.
 *
 * Excepciones de frontera declaradas:
 *  - `logCaughtError` (`src/lib/caughtError.ts`): el plan (§Logs) y AGENTS §1.5 lo
 *    exigen como ÚNICO registro de hechos y errores capturados.
 *  - `normalizeForMatch` (`src/lib/textUtils.ts`): el plegado NFD tiene un dueño
 *    único y `duplicationGuard` prohíbe reimplementarlo. El eco compara palabras
 *    normalizadas por esa función, no por una copia local.
 * Ambos se importan aquí y en ningún otro archivo del módulo.
 */
import { logCaughtError } from '../../lib/caughtError.ts'
import { normalizeForMatch } from '../../lib/textUtils.ts'
import { splitTranscriptAtWakeWord } from '../api/audio.ts'
import { FLU_CONFIG } from '../api/config.ts'
import { getVadFrameMs } from '../lib/asr/asrConfig.js'
import { labelToSpeakerId } from '../lib/conversationRow.js'
import { frameSamplesFor, isVoicedFrame } from '../lib/voicedActivity.js'
import {
  escribirRegistroConversacion,
  leerRegistroConversacion,
  transaccionConversaciones,
} from '../../core/db/conversationRowWriter.ts'
import { buildSyncTuple } from '../../core/db/syncTuple.ts'
import { crearAlmacenDexie } from './adaptersAlmacen.ts'
import type { DbLike } from './adaptersAlmacen.ts'
import { CONVERSACION_CONFIG, esMotorConversacion } from './ports.ts'
import type {
  AlmacenPort,
  CambiosFila,
  ConfigPort,
  Fila,
  FilaNueva,
  IdPort,
  MedidaVad,
  MotorConversacion,
  PartidorPort,
  RegistroPort,
  RelojPort,
  VadPort,
} from './ports.ts'

/** Reloj del sistema: la ÚNICA llamada a `Date.now()` del módulo, inyectada. */
export function crearRelojSistema(): RelojPort {
  return { ahora: () => Date.now() }
}

/** Ids UUIDv4 del navegador; sin fallback inventado si el entorno no lo ofrece. */
export function crearIdUuid(): IdPort {
  return {
    uuid: () => {
      const generador = globalThis.crypto
      if (!generador || typeof generador.randomUUID !== 'function') {
        throw new Error('crypto.randomUUID no disponible: no se inventa un id')
      }
      return generador.randomUUID()
    },
  }
}

/** Registro del proyecto: todo hecho del módulo pasa por `logCaughtError`. */
export function crearRegistroCaughtError(): RegistroPort {
  return { registrar: (contexto, ...detalles) => logCaughtError(contexto, ...detalles) }
}

/**
 * Ejecuta una promesa y registra su fallo con contexto.
 * Es el ÚNICO puente asíncrono hacia `logCaughtError` del módulo: ninguna
 * promesa del producto queda sin registro (AGENTS §1.5).
 * @param contexto Contexto del fallo.
 * @param promesa Operación en curso.
 */
export function registrarFallo(contexto: string, promesa: Promise<unknown>): Promise<void> {
  return promesa
    .catch((error) => {
      logCaughtError(contexto, error)
    })
    .then(() => undefined)
}

/** Parámetro de URL del override de runtime (lo siembra el E2E antes del goto). */
const PARAM_MOTOR_CONVERSACION = 'conversationEngine'

/**
 * Override de runtime del motor: solo un valor declarado cuenta; el resto se ignora
 * (un parámetro ausente o inventado no enciende nada). Es la vía del E2E, no una
 * segunda configuración: no escribe estado ni se persiste.
 *
 * CANDADO DE PRODUCCIÓN: la rama vive tras `import.meta.env.DEV`, que el build
 * sustituye por `false`; en un build de producción `?conversationEngine=` no
 * enciende NADA (ni siquiera se lee el parámetro). Sin el candado, cualquier
 * usuario podía activar un motor sin terminar desde la URL.
 * @returns El motor pedido por la URL, o `null` si no hay override válido.
 */
function motorPorOverrideRuntime(): MotorConversacion | null {
  if (!import.meta.env.DEV) return null
  if (typeof window === 'undefined') return null
  const valor = new URLSearchParams(window.location.search).get(PARAM_MOTOR_CONVERSACION)
  return esMotorConversacion(valor) ? valor : null
}

/**
 * Motor declarado en la configuración del producto, si esa clave existe hoy.
 * `FLU_CONFIG` no publica `conversation`: el producto cae al valor del plan.
 * @returns El motor del producto, o `null` si la clave no está declarada.
 */
function motorPorConfigProducto(): MotorConversacion | null {
  const producto = FLU_CONFIG as { conversation?: { engine?: unknown } }
  const valor = producto.conversation?.engine
  return esMotorConversacion(valor) ? valor : null
}

/**
 * Configuración viva de voz leída por la fachada pública de config.
 * El motor se resuelve en orden: override de runtime → configuración del
 * producto → valor del plan (`legacy`). El default del plan no se toca.
 * @returns Puerto de configuración que consume el hook (y App para su compuerta).
 */
export function crearConfigFlu(): ConfigPort {
  return {
    wakeWords: () => [...FLU_CONFIG.voiceCommands.wakeWords],
    semillaEtiqueta: () => String(FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker || ''),
    conversationEngine: () =>
      motorPorOverrideRuntime() ?? motorPorConfigProducto() ?? CONVERSACION_CONFIG.conversation.engine,
  }
}

/**
 * Normaliza texto para comparar palabras (eco): delega en el dueño único del
 * plegado NFD. No se reimplementa el algoritmo en el módulo.
 * @param texto Texto crudo (puede traer mayúsculas, acentos y signos).
 * @returns Texto en minúsculas, sin diacríticos y con espacios colapsados.
 */
export function normalizarParaComparar(texto: string): string {
  return normalizeForMatch(String(texto || ''))
}

/**
 * Partidor de la wake sobre el splitter ÚNICO del proyecto.
 * La wake se retira solo del texto que se muestra; la frase canónica va completa.
 * @param config Puerto de configuración (wake words).
 */
export function crearPartidorWake(config: ConfigPort): PartidorPort {
  return {
    partir: (texto) => {
      const canonica = String(texto || '').trim()
      const partida = splitTranscriptAtWakeWord(canonica, [...config.wakeWords()])
      const wakeWordMatched = Boolean(partida.wakeWordMatched)
      const paraMostrar = wakeWordMatched
        ? String(partida.afterWakeText || partida.afterWake || '').trim()
        : canonica
      return {
        canonica,
        paraMostrar,
        comando: String(partida.commandText || '').trim(),
        wakeWordMatched,
      }
    },
  }
}

/**
 * VAD del producto: mide voz y silencio ACUMULADO de cola con el dueño único
 * de umbral y trama (`voicedActivity`). No decide cierres: eso es la frontera.
 * @returns Puerto VAD con el silencio que arrastra el bloque actual.
 */
export function crearVadProducto(): VadPort {
  let silencioAcumuladoMs = 0
  return {
    medir: (muestras, sampleRate): MedidaVad => {
      const tasa = Number(sampleRate)
      if (!(tasa > 0) || !muestras || muestras.length === 0) {
        return { hayVoz: false, silencioMs: 0 }
      }
      const trama = frameSamplesFor(tasa, getVadFrameMs())
      let finVoz = -1
      for (let inicio = 0; inicio < muestras.length; inicio += trama) {
        const fin = Math.min(inicio + trama, muestras.length)
        if (isVoicedFrame(muestras, inicio, fin)) finVoz = fin
      }
      silencioAcumuladoMs += ((muestras.length - Math.max(0, finVoz)) / tasa) * 1000
      return { hayVoz: finVoz >= 0, silencioMs: silencioAcumuladoMs }
    },
  }
}

/**
 * Almacén en memoria con la tupla de sincronización del plan.
 * Un solo escritor (el motor de conversación) y borrado lógico: no existe método
 * de borrado físico. Es el doble de pruebas y el respaldo sin IndexedDB; el
 * almacén real es `crearAlmacenDexieProducto`.
 * @param opciones Reloj inyectado para `updated_at`.
 */
export function crearAlmacenMemoria({ reloj }: { reloj: RelojPort }): AlmacenPort {
  const filas = new Map<string, Fila>()
  const instantanea = (fila: Fila): Fila => ({ ...fila, tramo: { ...fila.tramo } })

  return {
    guardar: async (fila: FilaNueva): Promise<Fila> => {
      const previa = filas.get(fila.locutionId)
      const guardada: Fila = {
        ...fila,
        tramo: { ...fila.tramo },
        revision: (previa?.revision ?? 0) + 1,
        updated_at: reloj.ahora(),
        deleted: previa?.deleted ?? false,
      }
      filas.set(guardada.locutionId, guardada)
      return instantanea(guardada)
    },

    actualizar: async (locutionId: string, cambios: CambiosFila): Promise<Fila | null> => {
      const previa = filas.get(locutionId)
      if (!previa) return null
      const siguiente: Fila = {
        ...previa,
        texto: cambios.texto ?? previa.texto,
        provisional: cambios.provisional ?? previa.provisional,
        reason: cambios.reason ?? previa.reason,
        deleted: cambios.deleted ?? previa.deleted,
        revision: previa.revision + 1,
        updated_at: reloj.ahora(),
      }
      filas.set(locutionId, siguiente)
      return instantanea(siguiente)
    },
  }
}

/**
 * Almacén Dexie del PRODUCTO: la ÚNICA puerta del módulo a `core/db`.
 * El `DbLike` se implementa con el escritor ÚNICO de `conversations`
 * (`conversationRowWriter.ts`): aquí no se toca la tabla directamente.
 * El reloj y el participante llegan inyectados.
 * @param opciones Reloj inyectado y participante dueño de la fila.
 * @returns Un `AlmacenPort` sobre `conversations` (upsert y borrado lógico).
 */
export function crearAlmacenDexieProducto({
  reloj,
  participantId,
}: {
  reloj: RelojPort
  participantId?: string
}): AlmacenPort {
  const db: DbLike = {
    leer: (locutionId) => leerRegistroConversacion(locutionId),
    escribir: (registro) =>
      escribirRegistroConversacion(registro, {
        participantId,
        speakerId: labelToSpeakerId(registro.etiqueta),
        speakerName: registro.etiqueta,
      }).then(() => undefined),
    transaccion: (operacion) => transaccionConversaciones(operacion),
  }
  return crearAlmacenDexie({ db, reloj, sincronizar: buildSyncTuple })
}
