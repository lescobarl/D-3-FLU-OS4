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
 *  - nada de: captura de micrófono. Los embeddings se MIDEN por el worker único
 *    (`voiceIdWorkerClient.embedAudioForDiarization`) y se COMPARAN con el coseno
 *    del dueño único (`speakerCore.compareCosineSignatures`), ambos detrás del
 *    `EmbebedorPort` (puerto inyectable).
 *    La fila SÍ se persiste, por el escritor ÚNICO de `core/db`; el cableado de
 *    producto restante se declara PENDIENTE en `docs/LAE-cola-ejecucion.md`.
 *
 * Excepciones de frontera declaradas:
 *  - `logCaughtError` (`src/lib/caughtError.ts`): el plan (§Logs) y AGENTS §1.5 lo
 *    exigen como ÚNICO registro de hechos y errores capturados.
 *  - `relayLog` (`src/lib/clientLogRelay.ts`): el mismo relay que usa
 *    `logCaughtError`, aquí con nivel informativo del motor resuelto.
 *  - `normalizeForMatch` (`src/lib/textUtils.ts`): el plegado NFD tiene un dueño
 *    único y `duplicationGuard` prohíbe reimplementarlo. El eco compara palabras
 *    normalizadas por esa función, no por una copia local.
 * Ambos se importan aquí y en ningún otro archivo del módulo.
 *
 * La SUPERFICIE PASIVA (fila del usuario sin conversación activa) añade a este
 * archivo frontera: `useIntegrationStore` (la VISTA del producto, la misma que
 * usaba el escritor retirado) y las primitivas delegadas de los dueños vivos
 * (`speakerCore`, `speakerLabels`, `speakerDirectory`, `conversationRow`,
 * `audioMath`, `cleanForSpeech`). La etiqueta y la regla «es fragmento» las
 * decide el módulo (`resolverEtiqueta` / `pasivo.ts`); nada se reimplementa.
 */
import { logCaughtError } from '../../lib/caughtError.ts'
import { cleanForSpeech, normalizeForMatch } from '../../lib/textUtils.ts'
import { splitTranscriptAtWakeWord } from '../api/audio.ts'
import { FLU_CONFIG } from '../api/config.ts'
import { speechWords, stripDiacritics } from '../lib/audioMath.js'
import { getVadFrameMs } from '../lib/asr/asrConfig.js'
import { labelToSpeakerId, normalizeRowSignature } from '../lib/conversationRow.js'
import {
  autoSpeakerIndexFromKey,
  autoSpeakerLabel,
  compareCosineSignatures,
  getFallbackSpeaker,
  isAutoSpeakerLabel,
} from '../lib/speakerCore.js'
import { canonicalSpeakerName, isProperSpeakerName, pendingSpeakerLabel } from '../lib/speakerLabels.js'
import { voiceKeyFor } from '../lib/speakerDirectory.js'
import { embedAudioForDiarization } from '../lib/voiceIdWorkerClient.js'
import { useIntegrationStore } from '../../store/integrationStore.ts'
import { VOICE_DIARIZATION_DEFAULTS } from '../../core/config/sharedConfig.ts'
import { fraseDelEventoAsr, mergeIntoOpenLine } from '../lib/speechMerge.js'
import { frameSamplesFor, isVoicedFrame, selectVoicedWindow } from '../lib/voicedActivity.js'
import {
  escribirRegistroConversacion,
  leerRegistroConversacion,
  transaccionConversaciones,
} from '../../core/db/conversationRowWriter.ts'
import { buildSyncTuple } from '../../core/db/syncTuple.ts'
import { crearAlmacenDexie } from './adaptersAlmacen.ts'
import type { DbLike } from './adaptersAlmacen.ts'
import type {
  AlmacenPort,
  CambiosFila,
  ConfigPort,
  EmbebedorPort,
  EntradaCompromisoUsuario,
  Fila,
  FilaNueva,
  IdPort,
  MedidaVad,
  PartidorPort,
  PuertoVistaFilas,
  RegistroPort,
  RelojPort,
  ResultadoCompromisoUsuario,
  UtilidadesFila,
  VadPort,
} from './ports.ts'
import { crearEscritorFilaUsuario, crearResolucionPasiva } from './pasivo.ts'
import type { EscritorFilaUsuario, ResolucionPasivaHablante } from './pasivo.ts'

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

/**
 * Ejecuta una tarea y registra su fallo, sin propagarlo.
 *
 * El registro central (`logCaughtError`) se llama AQUÍ, en la frontera: es el único
 * archivo del módulo que puede importarlo, y un `catch` que no registre con la
 * excepción es un trago silencioso (AGENTS §1.5).
 * @param contexto Contexto del fallo.
 * @param tarea Operación en curso (síncrona o promesa).
 */
export async function ejecutarRegistrando(
  contexto: string,
  tarea: () => Promise<unknown> | unknown,
): Promise<void> {
  try {
    await tarea()
  } catch (error) {
    logCaughtError(contexto, error)
  }
}

/**
 * Compone el TROZO de un evento del ASR con sus resultados NUEVOS.
 *
 * El reconocedor entrega fragmentos, no frases acumuladas: re-emite delante el final
 * retenido del enunciado anterior (patrón `10` con `resultIndex=1`), manda prefijo
 * re-plegado + cola creciente y puede re-escuchar el mismo tramo dos veces. El dueño
 * de esa composición es `speechMerge.fraseDelEventoAsr`; se expone aquí porque el
 * límite del módulo vive en este archivo.
 */
export const componerFraseDelEvento = fraseDelEventoAsr

/**
 * Integra un trozo en la línea abierta con el libro de su último hueco.
 *
 * Dueño único de la regla: `speechMerge.mergeIntoOpenLine` (el turno vivo de
 * `conversationStream` delega en la misma función). Devuelve la línea siguiente y el
 * libro actualizado; no escribe estado.
 */
export const fusionarEnLineaAbierta = mergeIntoOpenLine

/**
 * Configuración viva de voz leída por la fachada pública de config.
 * El motor es el del plan (`new`): `legacy` dejó de ser opción de producto y no
 * existe override de runtime, así que una navegación no puede cambiar el motor
 * a mitad de sesión.
 * @returns Puerto de configuración que consume el hook.
 */
export function crearConfigFlu(): ConfigPort {
  return {
    wakeWords: () => [...FLU_CONFIG.voiceCommands.wakeWords],
    semillaEtiqueta: () => String(FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker || ''),
    // Delegado, no reimplementado: la definición de etiqueta anónima vive en su dueño.
    esEtiquetaAnonima: (etiqueta) => isAutoSpeakerLabel(etiqueta),
    umbralContinuidadVoz: () => {
      const umbrales = FLU_CONFIG.voiceIdentity?.capture?.conversationSpeakerThresholds
      const valor = umbrales ? Number(umbrales.cosineContinuityThreshold) : Number.NaN
      return Number.isFinite(valor) && valor > 0
        ? valor
        : VOICE_DIARIZATION_DEFAULTS.cosineContinuity
    },
    etiquetaAnonima: (indice) => autoSpeakerLabel(indice),
    // Regla 2 del eco: el mínimo de palabras de la cola que abre el fragmento.
    // Fuente única: assistantEchoMinWords (+1: repetir solo las 3 últimas
    // palabras de FLU no es eco, es conversación — medido 18:12:34).
    echoMinPalabrasCola: () => VOICE_DIARIZATION_DEFAULTS.assistantEchoMinWords + 1,
  }
}

/**
 * Embeddings de voz del PRODUCTO: mide en el worker único del proyecto y
 * compara con el coseno de su dueño único. El módulo SOLO decide (`identidad.ts`).
 * @returns Puerto de embeddings: vector (o `null`) y comparador de medidas.
 */
export function crearEmbebedorProducto(): EmbebedorPort {
  return {
    medir: async (muestras, sampleRate) => {
      // La ventana del turno llega con cola de silencio del ASR (y a veces con
      // audio ajeno en los bordes): se embebe SOLO el tramo con voz. El recorte
      // tiene UN dueño (`voicedActivity.selectVoicedWindow`), el mismo que usaba
      // la diarización vieja.
      const ventanaVoz = selectVoicedWindow(muestras, { sampleRate })
      const vector = await embedAudioForDiarization(ventanaVoz, sampleRate)
      return vector.length > 0 ? vector : null
    },
    comparar: (a, b) => compareCosineSignatures([...a], [...b]),
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
 * VAD del producto: mide voz y silencio de COLA con el dueño único de umbral y
 * trama (`voicedActivity`). No decide cierres: eso es la frontera.
 *
 * El silencio es el de la COLA del bloque (lo que sigue a la última trama con
 * voz), no un acumulado histórico: cuando el bloque trae voz se descarta el
 * silencio anterior y solo cuenta lo que queda tras la voz. Antes se sumaba
 * siempre, así que tras el primer silencio la medida ya no bajaba nunca y el
 * tramo no se cortaba en el siguiente hueco (congelación medida en el playback
 * del 2026-10-25: filas de 119–152 s).
 *
 * @returns Puerto VAD con el silencio de cola del bloque.
 */
export function crearVadProducto(): VadPort {
  let silencioColaMs = 0
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
      if (finVoz >= 0) {
        // La voz corta la racha: solo queda el silencio posterior a ella.
        silencioColaMs = ((muestras.length - finVoz) / tasa) * 1000
        return { hayVoz: true, silencioMs: silencioColaMs }
      }
      silencioColaMs += (muestras.length / tasa) * 1000
      return { hayVoz: false, silencioMs: silencioColaMs }
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

// ---------------------------------------------------------------------------
// SUPERFICIE PASIVA — la fila del usuario en modo wake (sin conversación
// activa) la escribe el MISMO módulo. El escritor de App (`conversationTurnRow`,
// retirado) era un segundo dueño de esa decisión y quedó sustituido por
// `pasivo.ts`; aquí solo se CABLES el producto: la vista (`useIntegrationStore`)
// y las primitivas de los dueños vivos.
// ---------------------------------------------------------------------------

/**
 * Vista del producto por puerto: el historial de conversación del store.
 * El acceso es perezoso (`getState()` por llamada): la vista se lee en el
 * momento del compromiso, no al cargar el módulo.
 * @returns Puerto de la vista de filas sobre `useIntegrationStore`.
 */
export function crearPuertoVistaFilasProducto(): PuertoVistaFilas {
  const vista = () => useIntegrationStore.getState()
  return {
    leerHistorial: () => vista().conversationHistory,
    agregarEntrada: (entrada) => vista().addConversationEntry(entrada),
    completarFragmento: (id, texto) => vista().completeEntryFragment(id, texto),
    fijarAltavoz: (id, vozId, opciones) =>
      vista().setEntrySpeaker(id, vozId, {
        signature: opciones?.firma ? [...opciones.firma] : null,
      }),
    fijarNombre: (id, nombre, opciones) =>
      vista().setEntrySpeakerName(id, nombre, opciones ? { resolved: opciones.resuelta } : undefined),
    anotarHighWater: (indice) => vista().noteSpeakerHighWater(indice),
    epoch: () => vista().conversationEpoch,
  }
}

/**
 * Utilidades de fila del producto: delegan en los dueños vivos del proyecto.
 * Ninguna regla se reimplementa en el módulo (una etiqueta, un sitio).
 * @returns Utilidades que consume el escritor pasivo.
 */
export function crearUtilidadesFilaProducto(): UtilidadesFila {
  return {
    normalizar: (texto) => cleanForSpeech(texto),
    nombrePropio: (nombre) => isProperSpeakerName(nombre),
    canonica: (nombre) => canonicalSpeakerName(nombre),
    etiquetaPendiente: () => pendingSpeakerLabel(),
    respaldoEtiqueta: () => getFallbackSpeaker(),
    claveDeEtiqueta: (etiqueta) => labelToSpeakerId(etiqueta),
    claveVoz: (datos) => voiceKeyFor({ voiceId: datos.voiceId, signature: datos.signature ? [...datos.signature] : null }),
    indiceAltoDeClave: (clave) => autoSpeakerIndexFromKey(clave) ?? 0,
    normalizarFirma: (firma) => normalizeRowSignature(firma ? [...firma] : null),
    palabras: (texto) => speechWords(texto),
    compactar: (texto) => stripDiacritics(cleanForSpeech(texto)).replace(/[^a-z0-9]+/g, ''),
  }
}

/** Escritor único de la fila del usuario en modo pasivo (se crea perezosamente). */
let escritorFilaUsuario: EscritorFilaUsuario | null = null

/**
 * Escritor de la fila del usuario del PRODUCTO (modo pasivo): UNA instancia
 * por proceso, con el estado de turno del factory (como el escritor retirado).
 * @returns El escritor único con `commitUserTurnRow` y `renameRowSpeakerName`.
 */
export function crearEscritorFilaUsuarioProducto(): EscritorFilaUsuario {
  if (!escritorFilaUsuario) {
    escritorFilaUsuario = crearEscritorFilaUsuario({
      vista: crearPuertoVistaFilasProducto(),
      utilidades: crearUtilidadesFilaProducto(),
      config: crearConfigFlu(),
      id: crearIdUuid(),
      reloj: crearRelojSistema(),
      registro: crearRegistroCaughtError(),
    })
  }
  return escritorFilaUsuario
}

/**
 * Compromete la fila del usuario del turno (modo pasivo) por el escritor único
 * del módulo. Es la MISMA puerta que la fachada publica: App la consume sin
 * saber dónde vive la decisión.
 * @param entrada Entrada del compromiso (texto, hablante, turno, evidencia).
 * @returns Id de la fila y la acción realizada.
 */
export function commitUserTurnRow(entrada: EntradaCompromisoUsuario): ResultadoCompromisoUsuario {
  return crearEscritorFilaUsuarioProducto().commitUserTurnRow(entrada)
}

/**
 * Corrige el nombre de UNA fila concreta de usuario por su id (migración).
 * @param rowId Id de la fila en la vista.
 * @param speakerName Nombre canónico que se fija.
 * @returns `true` si la fila existe y el nombre se fijó.
 */
export function renameRowSpeakerName(rowId: string, speakerName: string): boolean {
  return crearEscritorFilaUsuarioProducto().renameRowSpeakerName(rowId, speakerName)
}

/**
 * Resolutor del hablante del PRODUCTO (modo pasivo): la medida real
 * (`crearEmbebedorProducto`, con el recorte de `selectVoicedWindow`) y la regla
 * de identidad del módulo. UNA instancia por proceso.
 * @returns El resolutor `resolverHablante` con la evidencia de medida.
 */
export function crearResolucionPasivaProducto(): ResolucionPasivaHablante {
  return crearResolucionPasiva({
    embebedor: crearEmbebedorProducto(),
    config: crearConfigFlu(),
    id: crearIdUuid(),
    registro: crearRegistroCaughtError(),
  })
}

export { escribeFilaDeUsuario } from './pasivo.ts'
