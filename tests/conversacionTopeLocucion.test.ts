// @vitest-environment node
/**
 * TOPE DE LOCUCIÓN — la voz continua con texto de Chrome es UNA fila.
 *
 * Defecto medido (sesión 1c09c597, 2026-11-15): una frase continua con texto se
 * partió en dos filas por el tope de 12 s (“…vaya a ocupar” + “la clienta…”), y
 * esas filas no coincidían con ningún final. El tope solo puede acotar la
 * ventana VACÍA que transcribe el respaldo local; nunca la conversación.
 *
 * Monta el motor REAL del producto (Dexie con fake-indexeddb, VAD real, cola
 * real) y mide: (1) la locución NO se cierra a los 12 s si ya tiene texto; (2)
 * el cierre real por silencio escribe UNA fila con la frase completa.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearMotorConversacionProducto } from '../src/voice/conversation'
import type { EventoConversacion, EventoProducto } from '../src/voice/conversation'
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js'

const SR = 16000
const BLOQUE = 1600 // 100 ms
const VOZ_MS = 13_000
const SILENCIO_PREVIO_MS = 1000
const SILENCIO_CIERRE_MS = 5000

/** Tono con RMS cuatro veces por encima del piso REAL del VAD. */
function tono(ms: number): Float32Array {
  const n = Math.round((SR * ms) / 1000)
  const muestras = new Float32Array(n)
  const amplitud = Math.sqrt(2) * getVadEnergyThreshold() * 4
  for (let i = 0; i < n; i += 1) {
    muestras[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * amplitud
  }
  return muestras
}

/** Silencio digital del mismo tamaño. */
function silencio(ms: number): Float32Array {
  return new Float32Array(Math.round((SR * ms) / 1000))
}

/** Evento del reconocedor con la forma que entrega Chrome. */
function eventoAsr(texto: string, final = false): EventoProducto {
  return {
    resultIndex: 0,
    results: [{ 0: { transcript: texto }, isFinal: final, length: 1 }],
  }
}

/** Encadena bloques de audio de 100 ms desde `desdeMuestras`. */
function emitir(
  motor: ReturnType<typeof crearMotorConversacionProducto>,
  muestras: Float32Array,
  desdeMuestras: number,
): void {
  motor.audio(muestras, SR, desdeMuestras)
}

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('producto — tope de locución', () => {
  it('una frase continua con texto es UNA fila: el tope no la parte', async () => {
    const eventos: EventoConversacion[] = []
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    motor.suscribir((evento) => eventos.push(evento))
    motor.abrir()

    // 1 s de silencio inicial: no hay tramo todavía.
    for (let i = 0; i < SILENCIO_PREVIO_MS / 100; i += 1) {
      emitir(motor, silencio(100), i * BLOQUE)
    }
    // 13 s de voz continua: el tope de 12 s NO cierra porque la locución ya
    // tiene texto de Chrome; el corte real llega con el silencio.
    const base = 16000
    for (let i = 0; i < VOZ_MS / 100; i += 1) {
      emitir(motor, tono(100), base + i * BLOQUE)
      // Texto a los 5 s: desde aquí la frase tiene texto y el tope ya no la parte.
      if (i === 50) await motor.evento(eventoAsr('hola mundo', true))
    }
    // Chrome re-incluye el acumulado de la línea: la locución sigue siendo LA
    // MISMA y su texto es la frase completa, no la cola de una ventana nueva.
    await motor.evento(eventoAsr('hola mundo y algo mas', true))
    const trasEvento = motor.instantanea()
    expect(trasEvento.locucionAbierta?.texto).toBe('hola mundo y algo mas')
    // 5 s de silencio: cierra la locución por la frontera real.
    const desde = base + (VOZ_MS / 100) * BLOQUE
    for (let i = 0; i < SILENCIO_CIERRE_MS / 100; i += 1) {
      emitir(motor, silencio(100), desde + i * BLOQUE)
    }
    // Vacía la cola de audio (evento sin texto) antes de leer el estado.
    await motor.evento(eventoAsr('', false))
    expect(motor.instantanea().descartes.map((d) => d.motivo)).toEqual([])

    const filas = eventos.filter(
      (evento): evento is Extract<EventoConversacion, { tipo: 'row.committed' }> =>
        evento.tipo === 'row.committed',
    )
    const cierres = eventos.filter(
      (evento): evento is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
        evento.tipo === 'locution.closed',
    )
    expect(cierres.map((cierre) => cierre.causa)).toEqual(['silencio'])
    expect(filas.map((fila) => fila.fila.texto)).toEqual(['hola mundo y algo mas'])

    await motor.cerrar('user')
    const persistidas = await fluDb.conversations.toArray()
    expect(persistidas.map((fila) => fila.text)).toEqual(['hola mundo y algo mas'])
  }, 300_000)
})
