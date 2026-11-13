// @vitest-environment node
// BARRERA: audio-atribuido-medida
/**
 * AUDIO ATRIBUIDO A LA LOCUCIÓN ABIERTA — la medida del comando de voz.
 *
 * DEFECTO MEDIDO EN VIVO (2026-11-13 18:44, sesión 21012f7e): el dueño dijo el
 * comando de personalización y su nombre no alcanzó a las participaciones
 * anteriores ni a las posteriores. Causa raíz medida: la locución 4d84debd
 * abrió como caparazón (blip de 43 ms), el VAD cortó su tramo en la muestra
 * 2520960, la frase siguió en un tramo NUEVO B (desde 2646016) y su primer
 * interino llegó en 2681984 con el audio de B retenido (0,749 s). El caparazón
 * atribuyó el texto a la locución abierta y `sumarAudioAtribuido` sumó el audio
 * de B UNA sola vez; el resto del comando (hasta 2873760) nunca entró en
 * `muestrasAbierta` porque la puerta `suyo` solo aceptaba el tramo de la
 * locución. La medida del cierre vio 240 ms (< piso de 350) y la fila cerró
 * «Hablante XX» sin `vozId`: `registrarNombre` cayó en la rama de estado
 * compartido, renombró SOLO la locución del comando (`filas:1`) y no tocó las
 * filas de esa voz — ni las anteriores ni las posteriores.
 *
 * Esta barrera reproduce ESE escenario con el módulo REAL y los índices y las
 * rachas de voz del PCM preservado. Exige: el comando cierra con la voz de las
 * filas anteriores (misma plantilla y su timbre), el nombre renombra las filas
 * de esa voz (anteriores + comando) y la participación POSTERIOR hereda el
 * nombre.
 *
 * FALSIFICACIÓN: con solo el primer tramo atribuido (sin la continuación EN
 * VIVO) la ventana de medida queda en 300 ms de voz — por debajo del piso REAL
 * del producto (350 ms) — y la puerta del embebedor devuelve null: es el
 * `vozInsuficiente` medido a las 18:44.
 */
import { describe, expect, it } from 'vitest'
import { crearConversacion } from '../src/voice/conversation/index'
import type {
  AsrIngestado,
  BloqueAudio,
  ConversacionApi,
  EventoConversacion,
} from '../src/voice/conversation/index'
import {
  crearAlmacenMemoria,
  crearConfigFlu,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
} from '../src/voice/conversation/adapters'
import type { EmbebedorPort, MedidaVad } from '../src/voice/conversation/ports'
import {
  countVoicedSamples,
  ventanaConVoz,
} from '../src/voice/lib/voicedActivity.js'
import {
  getConversationMinVoicedSamples,
  getConversationSpeakerTailMs,
} from '../src/voice/lib/micCapture.js'

const SR = 48_000
const BLOQUE = 4_800 // 100 ms
const TONO_HZ = 220

// --- Evidencia del PCM preservado (sesión 21012f7e, 2026-11-13 18:44) ---
/** Muestra donde abrió el caparazón del comando. */
const A0 = 2_496_640
/** 43 ms: el audio propio que abrió la locución (medido `openLocutionMs`). */
const BLIP = 2_064
/** Muestra donde el VAD cortó el primer tramo. */
const CORTE = 2_520_960
/** Muestra donde arrancó el tramo vivo B (tras 2,6 s de pausa interna). */
const B0 = 2_646_016
/** Primer interino: audio de B retenido = 0,749 s. */
const B_TEXTO = 2_681_984
/** Fin de la voz del comando. */
const B_FIN = 2_873_760
/**
 * Rachas CON voz medidas en el audio de la sesión (piso RMS 0.02, trama 30 ms).
 * La primera (270 ms) es todo lo que la ventana tenía antes del primer interino.
 */
const RACHAS: ReadonlyArray<readonly [number, number]> = [
  [2_646_240, 2_659_200],
  [2_695_200, 2_713_920],
  [2_715_360, 2_729_760],
  [2_751_360, 2_790_240],
  [2_804_640, 2_873_760],
]

const VOZ = (): MedidaVad => ({ hayVoz: true, silencioMs: 0 })
const SILENCIO = (silencioMs: number): MedidaVad => ({ hayVoz: false, silencioMs })

/** Tono puro de la voz A a partir del índice absoluto `desde`. */
function tono(desde: number, cantidad: number, amplitud = 0.5): Float32Array {
  const muestras = new Float32Array(cantidad)
  for (let i = 0; i < cantidad; i += 1) {
    muestras[i] = Math.sin((2 * Math.PI * TONO_HZ * (desde + i)) / SR) * amplitud
  }
  return muestras
}

/** ¿La muestra `m` cae dentro de una racha CON voz del comando medido? */
function enRacha(m: number): boolean {
  return RACHAS.some(([inicio, fin]) => m >= inicio && m < fin)
}

/** PCM del comando: habla SOLO dentro de las rachas medidas (el resto es pausa). */
function audioComando(desde: number, cantidad: number): Float32Array {
  const muestras = new Float32Array(cantidad)
  for (let i = 0; i < cantidad; i += 1) {
    if (enRacha(desde + i)) {
      muestras[i] = Math.sin((2 * Math.PI * TONO_HZ * (desde + i)) / SR) * 0.5
    }
  }
  return muestras
}

function bloque(inicio: number, muestras: Float32Array, medida: MedidaVad): BloqueAudio {
  return { muestras, sampleRate: SR, inicio, fin: inicio + muestras.length, medida }
}

const asr = (texto: string, final: boolean): AsrIngestado => ({
  tramoId: '',
  texto,
  final,
})

/**
 * Muestras de VOZ que la PUERTA del producto acepta en `muestras` (la misma
 * secuencia de `crearEmbebedorProducto.medir`: `ventanaConVoz` acota la cola,
 * `countVoicedSamples` cuenta el habla real y el piso es
 * `getConversationMinVoicedSamples`). 0 si no hay voz que medir.
 * @param muestras PCM de la ventana de identidad.
 * @returns Muestras consideradas VOZ dentro de la ventana aceptada.
 */
function vozDeLaPuerta(muestras: Float32Array): number {
  const tailMs = Number(getConversationSpeakerTailMs())
  const maxMuestras =
    Number.isFinite(tailMs) && tailMs > 0
      ? Math.max(1, Math.round((tailMs / 1000) * SR))
      : 0
  const { inicio, fin, hayVoz } = ventanaConVoz(muestras, {
    sampleRate: SR,
    ...(maxMuestras > 0 ? { maxSamples: maxMuestras } : {}),
  })
  if (!hayVoz || fin <= inicio) return 0
  return countVoicedSamples(new Float32Array(muestras.subarray(inicio, fin)), {
    sampleRate: SR,
  })
}

/**
 * Embebedor de la prueba: el MODELO es falso (un tono de 220 Hz da [1,0]; uno
 * agudo da [0,1]) y la PUERTA de voz es la del producto con sus dueños reales.
 * El `null` por voz insuficiente es el camino que produjo «Hablante XX» en vivo.
 */
const embebedor: EmbebedorPort = {
  medir: async (muestras, sampleRate) => {
    if (vozDeLaPuerta(muestras) < getConversationMinVoicedSamples(sampleRate)) {
      return null
    }
    const tasa = Number(sampleRate) > 0 ? Number(sampleRate) : SR
    const tailMs = Number(getConversationSpeakerTailMs())
    const maxMuestras = Math.max(1, Math.round((tailMs / 1000) * tasa))
    const { inicio, fin } = ventanaConVoz(muestras, { sampleRate: tasa, maxSamples: maxMuestras })
    const ventana = muestras.subarray(inicio, fin)
    let cruces = 0
    for (let i = 1; i < ventana.length; i += 1) {
      if ((ventana[i - 1]! < 0) !== (ventana[i]! < 0)) cruces += 1
    }
    const frecuencia = cruces / 2 / (ventana.length / tasa)
    return frecuencia > 300 ? [0, 1] : [1, 0]
  },
  comparar: (a, b) => a.reduce((suma, valor, i) => suma + valor * (b[i] ?? 0), 0),
}

type Escenario = Readonly<{
  api: ConversacionApi
  eventos: EventoConversacion[]
  registros: Array<{ contexto: string; datos: Record<string, unknown> | undefined }>
}>

function montar(): Escenario {
  const reloj = { ahora: () => 1_700_000_000_000 }
  const registros: Escenario['registros'] = []
  const config = crearConfigFlu()
  const api = crearConversacion({
    reloj,
    id: crearIdUuid(),
    registro: {
      registrar: (contexto: string, ...detalles: unknown[]) => {
        registros.push({
          contexto,
          datos: detalles[0] as Record<string, unknown> | undefined,
        })
      },
    },
    almacen: crearAlmacenMemoria({ reloj }),
    config,
    partidor: crearPartidorWake(config),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho: () => '',
    embebedor,
  })
  const eventos: EventoConversacion[] = []
  api.subscribe((evento) => eventos.push(evento))
  return { api, eventos, registros }
}

/** Encadena bloques de 100 ms con la medida y el audio dados hasta `hasta`. */
async function emitir(
  api: ConversacionApi,
  desde: number,
  hasta: number,
  medida: MedidaVad,
  audio: (inicio: number, cantidad: number) => Float32Array = (_i, n) =>
    new Float32Array(n),
): Promise<void> {
  let cursor = desde
  while (cursor < hasta) {
    const fin = Math.min(cursor + BLOQUE, hasta)
    await api.ingestAudio(bloque(cursor, audio(cursor, fin - cursor), medida))
    cursor = fin
  }
}

const TEXTO_ANTERIOR = 'esta es mi participacion anterior antes del comando'
const TEXTO_PARCIAL = 'ok flu soy'
const TEXTO_COMANDO = 'ok flu soy luis'
const TEXTO_POSTERIOR = 'y despues del comando'

/**
 * Reproduce la sesión medida: (1) participación ANTERIOR de la voz A, (2) el
 * comando de personalización con la pausa interna del VAD y su tramo nuevo,
 * (3) una participación POSTERIOR de la misma voz tras el bautizo.
 * @param api Motor real montado.
 */
async function reproducirComando(api: ConversacionApi): Promise<void> {
  await api.start({ idioma: 'es' })

  // 1) Participación ANTERIOR (voz A): 3 s de habla, su texto y su cierre.
  await emitir(api, 0, 144_000, VOZ(), (inicio, n) => tono(inicio, n))
  await api.ingestAsr(asr(TEXTO_ANTERIOR, true))
  await api.ingestAudio(bloque(144_000, new Float32Array(168_000), SILENCIO(3500)))

  // 2) COMANDO: el blip de 43 ms abre el caparazón (bajo el piso de voz: el
  //    mismo motivo por el que el audio propio no sostuvo la medida).
  await api.ingestAudio(bloque(A0, tono(A0, BLIP, 0.01), VOZ()))
  // El VAD corta el tramo (1 s de silencio declarado).
  await api.ingestAudio(bloque(CORTE, new Float32Array(SR), SILENCIO(1000)))
  // Pausa interna de la frase: 2,6 s (< 3,5 s de cierre) hasta el tramo B.
  await emitir(api, CORTE + SR, B0, SILENCIO(2500))
  // La frase SIGUE en el tramo NUEVO hasta el primer interino.
  await emitir(api, B0, B_TEXTO, VOZ(), audioComando)
  await api.ingestAsr(asr(TEXTO_PARCIAL, false))
  // El resto del comando EN VIVO (medido 18:44: sin esto no entraba).
  await emitir(api, B_TEXTO, B_FIN, VOZ(), audioComando)
  await api.ingestAsr(asr(TEXTO_COMANDO, true))
  // Silencio de cierre medido (3,5 s): la puerta de abajo.
  await api.ingestAudio(bloque(B_FIN, new Float32Array(168_000), SILENCIO(3500)))
}

describe('audio atribuido — la medida del comando alcanza a toda la voz', () => {
  it('el comando cierra con la voz anterior, el nombre renombra sus filas y la siguiente lo hereda', async () => {
    const { api, registros } = montar()
    await reproducirComando(api)

    const comando = api
      .snapshot()
      .filas.find((fila) => fila.texto === TEXTO_COMANDO)
    expect(comando, 'la fila del comando existe').toBeDefined()
    // La VOZ medida sostiene la fila: sin la continuación en vivo esta fila
    // cerraba «Hablante XX» con `firma` null (medido 18:44).
    expect(comando!.etiqueta).toBe('Hablante 1')
    expect(comando!.firma).toEqual([1, 0])
    // El tramo de la fila es TODO el comando, no la ventana congelada del corte.
    expect(comando!.tramo).toEqual({ inicio: A0, fin: B_FIN, sampleRate: SR })

    // El dueño dice su nombre: el WHERE es la etiqueta de ESA voz.
    await api.registerName({
      nombre: 'Luis',
      etiqueta: comando!.etiqueta,
      locucionId: comando!.locutionId,
    })

    const renombrado = registros.find(
      (registro) => registro.contexto === 'conversacion.nombre.renombrado',
    )
    // La rama con voz: el nombre viaja por `vozId`, no por una etiqueta que ya
    // solo tenía la locución del comando. Las DOS filas de la voz se renombran.
    expect(String(renombrado?.datos?.vozId || '')).not.toBe('')
    expect(renombrado?.datos?.filas).toBe(2)

    const trasNombre = api.snapshot().filas
    expect(trasNombre.map((fila) => fila.etiqueta)).toEqual(['Luis', 'Luis'])

    // Participación POSTERIOR de la misma voz: nace con el nombre aprendido.
    const posterior = B_FIN + 168_000 + SR
    await emitir(api, posterior, posterior + 96_000, VOZ(), (inicio, n) => tono(inicio, n))
    await api.ingestAsr(asr(TEXTO_POSTERIOR, true))
    await api.ingestAudio(
      bloque(posterior + 96_000, new Float32Array(168_000), SILENCIO(3500)),
    )

    const etiquetas = api.snapshot().filas.map((fila) => fila.etiqueta)
    expect(etiquetas).toEqual(['Luis', 'Luis', 'Luis'])
  })

  it('FALSIFICACIÓN MEDIDA: sin la continuación en vivo la ventana queda bajo el piso de voz', () => {
    const minimo = getConversationMinVoicedSamples(SR)
    expect(minimo, 'piso REAL del producto a 48 kHz (350 ms)').toBe(16_800)
    // El audio que la locución tenía SIN la continuación en vivo: el blip y lo
    // que B había retenido cuando llegó el primer interino (0,749 s).
    const sinContinuacion = new Float32Array(BLIP + (B_TEXTO - B0))
    sinContinuacion.set(tono(A0, BLIP, 0.01), 0)
    sinContinuacion.set(audioComando(B0, B_TEXTO - B0), BLIP)
    // El mismo audio CON la continuación que aporta el predicado (hasta B_FIN).
    const conContinuacion = new Float32Array(BLIP + (B_FIN - B0))
    conContinuacion.set(tono(A0, BLIP, 0.01), 0)
    conContinuacion.set(audioComando(B0, B_FIN - B0), BLIP)

    // MEDIDO 18:44: la ventana sin continuación dio 240 ms de voz (< 350) y el
    // embebedor devolvió null. Con las rachas reales: 300 ms (< piso).
    expect(vozDeLaPuerta(sinContinuacion)).toBeLessThan(minimo)
    expect(vozDeLaPuerta(sinContinuacion)).toBeGreaterThan(0)
    // Con la continuación, la cola de 2 s elegida tiene ~1,7 s de voz: 5× el piso.
    const con = vozDeLaPuerta(conContinuacion)
    expect(con).toBeGreaterThanOrEqual(minimo)
    expect(con).toBeGreaterThanOrEqual(3 * minimo)
  })

  it('el predicado único alimenta la medida viva, el fin y la puerta `suyo`', () => {
    const src = require('node:fs').readFileSync(
      'src/voice/conversation/ingesta.ts',
      'utf8',
    ) as string
    expect(src).toMatch(/function elTramoVivoEsDeLaAbierta\(abierta: LocucionAbierta\): boolean/)
    // Los tres consumos: fin del tramo vivo, fin del tramo cortado y la puerta
    // que decide qué audio entra en `muestrasAbierta`.
    const consumos = src.match(/elTramoVivoEsDeLaAbierta\(estado\.abierta\)/g) ?? []
    expect(consumos.length).toBe(2)
    expect(src).toMatch(/const suyo = elTramoVivoEsDeLaAbierta\(abierta\)/)
    // El tramo atribuido por texto queda en el conjunto que alimenta la medida.
    expect(src).toMatch(/estado\.tramosDeLaAbierta\.add\(tramoId\)/)
  })
})
