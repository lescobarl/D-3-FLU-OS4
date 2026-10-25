/**
 * ADAPTADORES del módulo CONVERSACIÓN.
 *
 * Es el ÚNICO archivo del módulo que importa fuera de `src/voice/conversation/`.
 * Todo acceso externo pasa por aquí; el resto del módulo solo conoce `ports.ts`.
 *
 * Alcance medido de `src/voice/api/**` (superficie pública disponible hoy):
 *  - config:  wake words y etiqueta semilla;
 *  - audio:   `splitTranscriptAtWakeWord`;
 *  - voz:     TTS y ASR de nube NO se adaptan aquí todavía. `api/speech` arrastra
 *    `lib/speechRecognitionLocal.js`, cuyos imports sin extensión rompen el
 *    `viteConfigNativenessGuard` al entrar en el grafo del bundle del config
 *    (este módulo cuelga de `api/server.ts`, que el config carga). Corregir ese
 *    archivo queda fuera de la whitelist; `TtsPort`/`AsrPort` siguen inyectables
 *    y su cableado de producto se declara PENDIENTE.
 *  - nada de: captura de micrófono, extracción de embeddings ni escritura de filas.
 *    Esas piezas quedan como puertos inyectables; su cableado de producto se
 *    declara PENDIENTE en `docs/LAE-cola-ejecucion.md`.
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
import type {
  AlmacenPort,
  CambiosFila,
  ConfigPort,
  Fila,
  FilaNueva,
  IdPort,
  PartidorPort,
  RegistroPort,
  RelojPort,
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

/** Configuración viva de voz leída por la fachada pública de config. */
export function crearConfigFlu(): ConfigPort {
  return {
    wakeWords: () => [...FLU_CONFIG.voiceCommands.wakeWords],
    semillaEtiqueta: () => String(FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker || ''),
    localFallbackHabilitado: () =>
      Boolean(FLU_CONFIG.voiceIdentity.capture.recognition.localFallbackEnabled),
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
 * Almacén en memoria con la tupla de sincronización del plan.
 * Un solo escritor (el motor de conversación) y borrado lógico: no existe método
 * de borrado físico. La integración Dexie queda PENDIENTE porque la fachada
 * pública de storage no expone escritura de filas de conversación.
 * @param opciones Reloj inyectado para `updated_at`.
 */
export function crearAlmacenMemoria({ reloj }: { reloj: RelojPort }): AlmacenPort {
  const filas = new Map<string, Fila>()
  const instantanea = (fila: Fila): Fila => ({ ...fila, tramo: { ...fila.tramo } })

  return {
    guardar: async (fila: FilaNueva): Promise<Fila> => {
      if (filas.has(fila.locutionId)) {
        throw new Error(`fila duplicada para locucion ${fila.locutionId}`)
      }
      const guardada: Fila = {
        ...fila,
        tramo: { ...fila.tramo },
        revision: 1,
        updated_at: reloj.ahora(),
        deleted: false,
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

    leerSesion: async (sessionId: string): Promise<Fila[]> =>
      [...filas.values()]
        .filter((fila) => fila.sessionId === sessionId)
        .map(instantanea),
  }
}
