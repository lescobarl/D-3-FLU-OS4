/**
 * ADAPTADOR DE ASR del módulo CONVERSACIÓN.
 *
 * Traduce a `AsrPort` una instancia compatible con Web Speech / Whisper local.
 * La FUENTE se inyecta (`FuenteAsr`): el producto la construye con la fachada
 * `api/speech` (`acquireSpeechRecognition`) y el motor local de `api/audio` en
 * el punto de composición del hook (`producto.ts`). Así el módulo no importa
 * fuera de su frontera y el grafo del config de Vite no arrastra la librería
 * de voz.
 *
 * Un solo motor por sesión: `auto` lo resuelve el motor del módulo ANTES de
 * abrir y este adaptador nunca cambia de motor ni aplica umbrales de
 * degradación (el plan los prohíbe).
 */
import { intentarRegistrando } from './adapters.ts'
import { asrEmpujaAudio } from './ports.ts'
import type {
  AsrPort,
  EstadoAsr,
  IdiomaLocucion,
  MotorAsr,
  OpcionesAsr,
} from './ports.ts'

/** Alternativa de transcripción de un resultado. */
export type AlternativaReconocimiento = Readonly<{ transcript?: string }>

/** Resultado de reconocimiento (misma forma en la nube y en el motor local). */
export type ResultadoReconocimiento = ArrayLike<AlternativaReconocimiento> &
  Readonly<{ isFinal?: boolean }>

/** Evento de resultado que entregan ambos motores. */
export type EventoResultado = Readonly<{ results?: ArrayLike<ResultadoReconocimiento> }>

/** Error de reconocimiento (código de Web Speech o del motor local). */
export type EventoError = Readonly<{ error?: string; message?: string }>

/** Instancia de reconocimiento compatible con la nube y con Whisper local. */
export type MotorReconocimiento = {
  onstart: ((evento?: unknown) => void) | null
  onresult: ((evento: EventoResultado) => void) | null
  onerror: ((evento: EventoError) => void) | null
  onend: ((evento?: unknown) => void) | null
  start(): void
  stop(): void
  abort(): void
  /** Solo el motor local consume PCM por el puerto. */
  pushAudio?: (muestras: Float32Array, sampleRate: number) => void
  /** Solo el motor local expone su cola de transcripciones. */
  whenIdle?: () => Promise<void>
}

/** Fuente REAL de reconocimiento que el producto inyecta. */
export type FuenteAsr = Readonly<{
  nubeSoportada(): boolean
  localSoportada(): boolean
  crearNube(idioma: IdiomaLocucion): MotorReconocimiento | null
  crearLocal(idioma: IdiomaLocucion): Promise<MotorReconocimiento | null>
}>

/** Concatena las transcripciones del evento (la nube entrega varias). */
function leerTexto(evento: EventoResultado): string {
  const resultados = evento.results
  if (!resultados || resultados.length === 0) return ''
  let texto = ''
  for (let indice = 0; indice < resultados.length; indice += 1) {
    const alternativa = resultados[indice]?.[0]
    if (alternativa && typeof alternativa.transcript === 'string') {
      texto += alternativa.transcript
    }
  }
  return texto.trim()
}

/** Un resultado es final solo si el ÚLTIMO tramo del evento lo declara. */
function esFinal(evento: EventoResultado): boolean {
  const resultados = evento.results
  if (!resultados || resultados.length === 0) return false
  return resultados[resultados.length - 1]?.isFinal === true
}

/**
 * Crea el adaptador de ASR sobre una fuente inyectada.
 * @param opciones Fuente de reconocimiento que aporta el producto.
 * @returns Un `AsrPort` con un solo motor abierto por sesión.
 */
export function crearAsrReconocimiento({ fuente }: { fuente: FuenteAsr }): AsrPort {
  let actual: MotorReconocimiento | null = null
  let elegido: MotorAsr | null = null
  let abierto = false
  let publicado: EstadoAsr | null = null

  /** Publica el estado solo si la sesión de ASR sigue abierta. */
  function publicar(opciones: OpcionesAsr, estado: EstadoAsr, detalle?: string): void {
    if (!abierto) return
    publicado = estado
    opciones.alEstado(estado, detalle)
  }

  return {
    soportado: (motor) => (motor === 'cloud' ? fuente.nubeSoportada() : fuente.localSoportada()),

    iniciar: async (opciones) => {
      const instancia =
        opciones.motor === 'cloud'
          ? fuente.crearNube(opciones.idioma)
          : await fuente.crearLocal(opciones.idioma)
      if (!instancia) return 'no-permission'

      actual = instancia
      elegido = opciones.motor
      abierto = true
      publicado = null
      instancia.onstart = () => {
        publicar(opciones, 'active')
      }
      instancia.onresult = (evento) => {
        if (!abierto) return
        const texto = leerTexto(evento)
        if (!texto) return
        opciones.alResultado({
          texto,
          final: esFinal(evento),
          idioma: opciones.idioma,
        })
      }
      instancia.onerror = (evento) => {
        if (!abierto) return
        const codigo = String(evento.error || '')
        if (codigo === 'not-allowed' || codigo === 'service-not-allowed') {
          publicar(opciones, 'no-permission', codigo)
          return
        }
        publicar(opciones, 'error', codigo || String(evento.message || 'error de reconocimiento'))
      }
      instancia.onend = () => {
        if (!abierto) return
        abierto = false
        opciones.alEstado('aborted', 'el motor termino la captura')
      }

      const arrancado = intentarRegistrando('conversacion.asr.start.error', () => {
        instancia.start()
      })
      if (!arrancado) {
        abierto = false
        actual = null
        elegido = null
        return 'error'
      }
      return publicado ?? 'starting'
    },

    empujarAudio: (muestras, sampleRate) => {
      if (!abierto || !asrEmpujaAudio(elegido)) return
      actual?.pushAudio?.(muestras, sampleRate)
    },

    detener: () => {
      const instancia = actual
      actual = null
      elegido = null
      abierto = false
      if (!instancia) return
      const cerrar = (): void => {
        intentarRegistrando('conversacion.asr.stop.error', () => {
          instancia.stop()
        })
      }
      if (instancia.whenIdle) {
        void instancia.whenIdle().then(cerrar, cerrar)
      } else {
        cerrar()
      }
    },

    abortar: () => {
      const instancia = actual
      actual = null
      elegido = null
      abierto = false
      if (!instancia) return
      intentarRegistrando('conversacion.asr.abort.error', () => {
        instancia.abort()
      })
    },
  }
}
