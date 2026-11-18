// @vitest-environment node
// BARRERA: tramo-ajeno-medida
/**
 * FRENO DE MEDIDA DEL TRAMO AJENO — un resultado por interino NO re-embebe.
 *
 * DEFECTO MEDIDO EN VIVO (2026-11-12): «llega el momento en que se alenta la
 * transcripción, escribe letra por letra de tan lento». Causa raíz: cuando el
 * VAD corta dentro de una frase (pausa ≥ `minSilenceMs`) la locución sigue
 * ABIERTA en su tramo original y cada resultado del ASR llega con el tramo
 * NUEVO. `verificarCambioVoz` mide ese tramo ajeno en CADA resultado (un
 * embed por interino, todos esperados en línea en la cola ÚNICA): la cola de
 * embeddings crece con cada evento y la transcripción se arrastra.
 *
 * El freno: un tramo ajeno se embebe UNA vez por ventana; solo se re-embebe
 * cuando el tramo CRECIÓ otra ventana completa de audio nuevo (`minSegundosVozMedida`).
 *
 * Se mide con el MÓDULO REAL y un embebedor falso con CONTADOR (220 Hz → [1,0];
 * 440 Hz → [0,1]; comparar = producto punto). El VAD real se sustituye por una
 * medida declarada por bloque.
 *
 * FALSIFICACIÓN: el tramo ajeno que CRECE se re-embebe (la ventana nueva sí
 * puede cambiar la decisión de voz); solo la MISMA ventana no se re-mide.
 */
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
import type { ConversacionApi, EventoConversacion } from '../src/voice/conversation/index'
import {
  crearAlmacenMemoria,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/adapters'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports'
import type {
  ConfigPort,
  ConfiguracionConversacion,
  EmbebedorPort,
  MedidaVad,
} from '../src/voice/conversation/ports'
import { isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'

const SR = 16000
const BLOQUE = 1600 // 100 ms

/** Medida declarada de VOZ por bloque (el VAD real no decide nada aquí). */
const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
/** Medida declarada de SILENCIO por bloque (solo abre el turno). */
const SILENCIO = (ms: number): MedidaVad => ({ hayVoz: false, silencioMs: ms })

/** Tono puro de `frecuencia` Hz durante `ms` milisegundos. */
function tono(frecuencia: number, ms: number): Float32Array {
  const n = Math.round((SR * ms) / 1000)
  const muestras = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    muestras[i] = Math.sin((2 * Math.PI * frecuencia * i) / SR)
  }
  return muestras
}

/** Configuración del turno de prueba: pisos BAJOS para acuñar voces de 1 s. */
const CONFIG_PRUEBA: ConfigPort = {
  wakeWords: () => ['ok flu'],
  semillaEtiqueta: () => 'Hablante ?',
  esEtiquetaAnonima: isAutoSpeakerLabel,
  umbralContinuidadVoz: () => 0.8,
  minNuevaVozMs: () => 1000,
  umbralExistenteVoz: () => 0.64,
  esComandoDeControl: () => false,
  etiquetaAnonima: (indice) => `Hablante ${indice}`,
  echoMinPalabrasCola: () => 4,
}

/** Texto de la voz A (8 palabras: acuña la voz con la medida temprana). */
const TEXTO_A = 'uno dos tres cuatro cinco seis siete ocho'

type Escenario = Readonly<{
  api: ConversacionApi
  eventos: EventoConversacion[]
  medidas: () => number
  resetMedidas: () => void
}>

/** Monta el motor real con un embebedor de tonos que CUENTA los embeds. */
function montar(): Escenario {
  let medidas = 0
  const embebedor: EmbebedorPort = {
    medir: async (muestras) => {
      medidas += 1
      let cruces = 0
      for (let i = 1; i < muestras.length; i += 1) {
        if ((muestras[i - 1]! < 0) !== (muestras[i]! < 0)) cruces += 1
      }
      const frecuencia = cruces / 2 / (muestras.length / SR)
      return frecuencia > 300 ? [0, 1] : [1, 0]
    },
    comparar: (a, b) => a.reduce((suma, valor, i) => suma + valor * (b[i] ?? 0), 0),
  }
  const reloj = { ahora: () => 1_700_000_000_000 }
  const configuracion: ConfiguracionConversacion = {
    ...CONVERSACION_CONFIG,
    minSegundosVozMedida: 1.0,
    silenceCloseMs: 5000,
    confirmacionesCambioVoz: 2,
  }
  const api = crearConversacion({
    reloj,
    id: crearIdUuid(),
    registro: { registrar: () => undefined },
    almacen: crearAlmacenMemoria({ reloj }),
    config: CONFIG_PRUEBA,
    partidor: crearPartidorWake(CONFIG_PRUEBA),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho: () => '',
    embebedor,
    configuracion,
  })
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, eventos, medidas: () => medidas, resetMedidas: () => { medidas = 0 } }
}

/** Encadena bloques de 100 ms de la medida y tono dados desde `desdeMuestras`. */
async function emitir(
  api: ConversacionApi,
  frecuencia: number,
  bloques: number,
  desdeMuestras: number,
): Promise<void> {
  for (let i = 0; i < bloques; i += 1) {
    const inicio = desdeMuestras + i * BLOQUE
    await api.ingestAudio({
      muestras: tono(frecuencia, 100),
      sampleRate: SR,
      inicio,
      fin: inicio + BLOQUE,
      medida: VOZ(),
    })
  }
}

/** Evento del ASR sin tramo (lo resuelve el módulo dentro de su cola). */
function evento(texto: string): { tramoId: string; texto: string; final: boolean } {
  return { tramoId: '', texto, final: false }
}

const cerradosPorVoz = (
  eventos: EventoConversacion[],
): Extract<EventoConversacion, { tipo: 'locution.closed' }>[] =>
  eventos.filter(
    (e): e is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
      e.tipo === 'locution.closed' && e.causa === 'voz',
  )

/**
 * Frase de A con una pausa interna del VAD: 1 s de silencio (el tramo no nace
 * en 0), A habla 3 s (T1), su texto llega, A sigue 1 s (la medida temprana
 * acuña su voz), PAUSA de 1 s (el VAD corta T1 y la locución queda ABIERTA) y
 * A sigue 2 s en un tramo NUEVO (T2). Desde ahí cada interino del ASR llega
 * con T2 ≠ locución abierta: el camino «tramo ajeno» de `verificarCambioVoz`.
 */
async function prepararPausaInterna(escenario: Escenario): Promise<void> {
  const { api } = escenario
  await api.start({ idioma: 'es' })
  for (let i = 0; i < 10; i += 1) {
    const inicio = i * BLOQUE
    await api.ingestAudio({
      muestras: new Float32Array(BLOQUE),
      sampleRate: SR,
      inicio,
      fin: inicio + BLOQUE,
      medida: SILENCIO(100),
    })
  }
  // Voz A: 3 s de tono 220 Hz (muestras 16000..64000, T1).
  await emitir(api, 220, 30, 16000)
  await api.ingestAsr(evento(TEXTO_A))
  // Voz A sigue 1 s más: la medida temprana acuña su voz.
  await emitir(api, 220, 10, 64000)
  // PAUSA del VAD (1 s ≥ minSilenceMs 900): corta T1 en 80000, la locución
  // de A queda ABIERTA y sin tramo de audio vivo.
  await api.ingestAudio({
    muestras: new Float32Array(SR),
    sampleRate: SR,
    inicio: 80000,
    fin: 80000 + SR,
    medida: SILENCIO(1000),
  })
  // A sigue 2 s: tramo NUEVO T2 (muestras 96000..128000).
  await emitir(api, 220, 20, 96000)
}

describe('tramo ajeno — un resultado por interino NO re-embebe la misma ventana', () => {
  it('tres interinos sobre el MISMO tramo ajeno embeben UNA sola vez', async () => {
    const escenario = montar()
    await prepararPausaInterna(escenario)
    escenario.resetMedidas()
    const interinos = [
      `${TEXTO_A} y sigo`,
      `${TEXTO_A} y sigo mas`,
      `${TEXTO_A} y sigo mas todavia`,
    ]
    for (const texto of interinos) {
      await escenario.api.ingestAsr(evento(texto))
    }
    // La ventana de T2 ya medida NO se re-embebe por resultado: sin el freno
    // cada interino dispara un embed (3) y la cola única se arrastra.
    expect(escenario.medidas()).toBe(1)
  })

  it('la MISMA voz en el tramo ajeno no parte la locución y el texto crece', async () => {
    const escenario = montar()
    await prepararPausaInterna(escenario)
    for (const texto of [`${TEXTO_A} y sigo`, `${TEXTO_A} y sigo mas todavia`]) {
      await escenario.api.ingestAsr(evento(texto))
    }
    expect(cerradosPorVoz(escenario.eventos)).toHaveLength(0)
    expect(escenario.api.snapshot().locucionAbierta!.texto).toBe(`${TEXTO_A} y sigo mas todavia`)
  })

  it('FALSIFICACIÓN: el tramo ajeno que CRECE se re-embebe (audio nuevo sí decide)', async () => {
    const escenario = montar()
    await prepararPausaInterna(escenario)
    escenario.resetMedidas()
    await escenario.api.ingestAsr(evento(`${TEXTO_A} y sigo`))
    expect(escenario.medidas()).toBe(1)
    // T2 crece 1,6 s más (muestras 128000..153600): otra ventana COMPLETA.
    await emitir(escenario.api, 220, 16, 128000)
    await escenario.api.ingestAsr(evento(`${TEXTO_A} y sigo mas todavia`))
    expect(escenario.medidas()).toBe(2)
  })
})
