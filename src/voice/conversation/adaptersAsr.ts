/**
 * ADAPTADOR DE ASR del módulo CONVERSACIÓN.
 *
 * Traduce a `AsrPort` una instancia compatible con Web Speech / Whisper local.
 * La FUENTE se inyecta (`FuenteAsr`): el producto la construye con la fachada
 * `api/speech` (`acquireSpeechRecognition`) y el motor local de `api/audio` en
 * el punto de composición del hook. Así el módulo no importa fuera de su
 * frontera y el grafo del config de Vite no arrastra la librería de voz.
 *
 * Un solo motor por sesión: `auto` lo resuelve el motor del módulo ANTES de
 * abrir y este adaptador nunca cambia de motor ni aplica umbrales de
 * degradación (el plan los prohíbe).
 */
import {
  crearAlmacenDexieProducto,
  crearConfigFlu,
  crearIdUuid,
  crearPartidorWake,
  crearRegistroCaughtError,
  crearRelojSistema,
  crearVadProducto,
  intentarRegistrando,
  registrarFallo,
} from './adapters.ts'
import { crearConversacion } from './motor.ts'
import { asrEmpujaAudio } from './ports.ts'
import type {
  AsrPort,
  EstadoAsr,
  IdiomaLocucion,
  MotivoCierre,
  MotorAsr,
  OpcionesAsr,
} from './ports.ts'
import type {
  ConversacionApi,
  EventoConversacion,
  InstantaneaConversacion,
} from './tipos.ts'

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
/** Evento real de ASR con el índice del primer resultado nuevo. */
export type EventoProducto = EventoResultado & Readonly<{ resultIndex?: number }>

/** Controlador que el producto usa en el ciclo real de escucha. */
export type MotorConversacionProducto = Readonly<{
  /** Abre la sesión del motor la primera vez del ciclo de escucha. */
  abrir(): void
  /** Ingesta los resultados reales del reconocedor (interim y final). */
  evento(evento: EventoProducto): void
  /** Ingesta el bloque PCM real con su frecuencia y su índice de muestra. */
  audio(muestras: Float32Array, sampleRate: number, inicioMuestras?: number): void
  /** Suscribe a los 6 eventos del módulo; devuelve la baja. */
  suscribir(oyente: (evento: EventoConversacion) => void): () => void
  /** Instantánea síncrona de la caja y las filas de la sesión. */
  instantanea(): InstantaneaConversacion
  /** Cierra la sesión con el motivo real del cierre. */
  cerrar(motivo: MotivoCierre): void
}>

/**
 * Compone el motor NUEVO para el producto con los adaptadores REALES.
 * Es el único punto que crea la sesión desde el hook: almacén Dexie, reloj,
 * ids y la configuración del plan; el eco se delega a `ultimoTextoDicho`.
 * @param opciones Idioma activo, frecuencia de captura y último texto de FLU.
 * @returns Controlador de apertura, ingesta y cierre.
 */
export function crearMotorConversacionProducto({
  idioma,
  sampleRate,
  ultimoTextoDicho,
}: {
  idioma: IdiomaLocucion
  sampleRate: number
  ultimoTextoDicho: () => string
}): MotorConversacionProducto {
  const reloj = crearRelojSistema()
  const id = crearIdUuid()
  const config = crearConfigFlu()
  const api: ConversacionApi = crearConversacion({
    reloj,
    id,
    registro: crearRegistroCaughtError(),
    almacen: crearAlmacenDexieProducto({ reloj }),
    config,
    partidor: crearPartidorWake(config),
    vad: crearVadProducto(),
    ultimoTextoDicho,
  })
  let activa = false
  let turnId: string | null = null
  let tramoId: string | null = null
  let cursorMuestras = 0
  let inicioMuestra = 0
  let ultimoMs = 0
  /** Último FINAL ya ingerido en esta sesión del reconocedor (índice + texto). */
  let ultimoFinal: Readonly<{ indice: number; texto: string }> | null = null

  return {
    abrir: () => {
      // Cada `onstart` del reconocedor abre una sesión de resultados NUEVA:
      // los índices de Chrome vuelven a empezar, así que la identidad del
      // último final no cruza de una sesión a otra (si no, una frase legítima
      // idéntica se perdería; AGENTS, invariante 14).
      ultimoFinal = null
      if (activa) return
      activa = true
      turnId = id.uuid()
      tramoId = id.uuid()
      cursorMuestras = 0
      inicioMuestra = 0
      ultimoMs = reloj.ahora()
      registrarFallo('conversacion.producto.start.error', api.start({ turnId, idioma }))
    },

    evento: (evento) => {
      if (!activa || !turnId || !tramoId) return
      const resultados = evento.results
      if (!resultados || resultados.length === 0) return
      const ahora = reloj.ahora()
      const porReloj = Math.max(1, Math.round(((ahora - ultimoMs) * sampleRate) / 1000))
      const primero = evento.resultIndex ?? 0
      for (let indice = primero; indice < resultados.length; indice += 1) {
        const resultado = resultados[indice]
        const texto = String(resultado?.[0]?.transcript || '').trim()
        if (!texto) continue
        const final = resultado?.isFinal === true
        // Reentrega del MISMO final (Chrome repite el evento): no es una
        // locución nueva. Se compara la identidad del resultado (índice +
        // texto), nunca el texto suelto; una frase legítima idéntica llega con
        // índice nuevo o tras reiniciar la sesión.
        if (final && ultimoFinal && indice === ultimoFinal.indice && texto === ultimoFinal.texto) {
          continue
        }
        const inicio = inicioMuestra
        const fin = Math.max(inicio + porReloj, cursorMuestras)
        registrarFallo(
          'conversacion.producto.ingest.error',
          api.ingestAsr({
            tramoId,
            texto,
            final,
            idioma,
            tramo: { inicio, fin, sampleRate },
            turnId,
          }),
        )
        if (final) {
          ultimoFinal = { indice, texto }
          tramoId = id.uuid()
          inicioMuestra = Math.max(fin, cursorMuestras)
        }
      }
      ultimoMs = ahora
    },

    audio: (muestras, frecuencia, inicioMuestras) => {
      if (!activa || !turnId || !muestras || muestras.length === 0) return
      const inicio =
        Number.isFinite(Number(inicioMuestras)) && Number(inicioMuestras) >= 0
          ? Number(inicioMuestras)
          : cursorMuestras
      const fin = inicio + muestras.length
      cursorMuestras = Math.max(cursorMuestras, fin)
      registrarFallo(
        'conversacion.producto.audio.error',
        api.ingestAudio({
          muestras,
          sampleRate: frecuencia,
          inicio,
          fin,
          turnId,
        }),
      )
    },

    suscribir: (oyente) => api.subscribe(oyente),

    instantanea: () => api.snapshot(),

    cerrar: (motivo) => {
      if (!activa) return
      activa = false
      registrarFallo('conversacion.producto.stop.error', api.stop(motivo))
      turnId = null
      tramoId = null
    },
  }
}

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
