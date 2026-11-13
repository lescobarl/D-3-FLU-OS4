// @vitest-environment node
/**
 * TRAMO VIGENTE DEL PRODUCTO — el texto NO elige tramo: lo resuelve el módulo
 * dentro de su cola, cuando el audio ya se ingirió.
 *
 * Defecto medido (playback 8f3112c2, 2026-10-25): el compositor fabricaba
 * `tramo: [0, cursorMuestras]` y prefería la locución abierta, así que el texto
 * del tramo nuevo entraba como revisión del anterior; la frontera `textoAjeno`
 * no se alcanzaba y las filas abarcaban 119–152 s.
 *
 * Monta el motor REAL del producto (Dexie con fake-indexeddb, VAD real, cola
 * real) y mide: (1) cada fila lleva SU tramo de audio, no `[0, cursor]`;
 * (2) el texto retenido ANTES de la frontera de silencio se funde en la fila
 * que cierra (regla 3, defecto fd148fe7); (3) el texto ajeno SIN tramo no se
 * mezcla ni inventa fila.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearMotorConversacionProducto } from '../src/voice/conversation'
import type { EventoConversacion, EventoProducto } from '../src/voice/conversation'
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js'

const SR = 16000
const BLOQUE = 1600 // 100 ms

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
function emitir(motor: ReturnType<typeof crearMotorConversacionProducto>, muestras: Float32Array, desdeMuestras: number): void {
  motor.audio(muestras, SR, desdeMuestras)
}

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('producto — el tramo lo resuelve el módulo al procesar', () => {
  it('cada fila lleva su tramo de audio y el texto ajeno se retiene hasta el silencio', async () => {
    const eventos: EventoConversacion[] = []
    // El m?dulo acu?a un turno nuevo cuando el anterior ya tiene fila.
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    motor.suscribir((evento) => eventos.push(evento))
    motor.abrir()

    // 1 s de silencio inicial: no hay tramo todavía (la fila no puede nacer en 0).
    for (let i = 0; i < 10; i += 1) emitir(motor, silencio(100), i * BLOQUE)
    // 1 s de voz: tramo T1 arranca en la muestra 16000.
    for (let i = 0; i < 10; i += 1) emitir(motor, tono(100), 16000 + i * BLOQUE)
    await motor.evento(eventoAsr('hola'))
    // La primera locución queda en su turno: la segunda nace en OTRO turno.

    // 1 s de silencio: el VAD corta T1 (silencio de cola ≥ 900 ms).
    for (let i = 0; i < 10; i += 1) emitir(motor, silencio(100), 32000 + i * BLOQUE)
    // 1 s de voz nueva: tramo T2 arranca en la muestra 48000.
    for (let i = 0; i < 10; i += 1) emitir(motor, tono(100), 48000 + i * BLOQUE)
    // El texto del tramo NUEVO NO cierra por sí solo: se retiene como pendiente.
    await motor.evento(eventoAsr('adios'))
    // 5 s de silencio: única puerta de cierre sin cambio de hablante medido.
    for (let i = 0; i < 50; i += 1) emitir(motor, silencio(100), 64000 + i * BLOQUE)
    await motor.evento(eventoAsr('', false))

    const filas = eventos.filter(
      (evento): evento is Extract<EventoConversacion, { tipo: 'row.committed' }> =>
        evento.tipo === 'row.committed',
    )
    // La retenida ('adios') llegó ANTES del silencio de cierre: es del MISMO
    // bloque y se funde en la fila que cierra (UNA fila, UN insert; defecto
    // fd148fe7: el texto se partía sin frontera real). La fila cubre el audio
    // del bloque completo: de la primera voz al fin del tramo fundido.
    expect(filas.map((fila) => fila.fila.texto)).toEqual(['hola adios'])
    // La fila lleva SU tramo: de la primera voz al fin del bloque, no `[0, cursor]`.
    expect(filas[0].fila.tramo).toEqual({
      inicio: 16000,
      fin: 64000,
      sampleRate: SR,
    })

    const cierres = eventos.filter(
      (evento): evento is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
        evento.tipo === 'locution.closed',
    )
    expect(cierres.map((cierre) => cierre.causa)).toEqual(['silencio'])

    // El stop no crea ni reescribe filas: la del bloque ya estaba en el almacén.
    await motor.cerrar('user')

    const persistidas = await fluDb.conversations.toArray()
    expect(persistidas).toHaveLength(1)
    expect(persistidas[0]!.text).toBe('hola adios')
    expect(persistidas[0]!.meta?.conversacion?.tramo).toMatchObject({ inicio: 16000, fin: 64000 })
  }, 300_000)

  it('un final ajeno NO cierra: espera tiempo/stop y no mezcla las frases', async () => {
    const eventos: EventoConversacion[] = []
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    motor.suscribir((evento) => eventos.push(evento))
    motor.abrir()

    // 1 s de silencio + 1 s de voz: tramo T1 y locución abierta.
    for (let i = 0; i < 10; i += 1) emitir(motor, silencio(100), i * BLOQUE)
    for (let i = 0; i < 10; i += 1) emitir(motor, tono(100), 16000 + i * BLOQUE)
    const primera = 'duplicados ahí está el escenario todo mal'
    await motor.evento(eventoAsr(primera, true))

    // 1 s de silencio: el VAD corta T1 (no hay tramo VIVO) pero la locución
    // sigue abierta (aún no hay 5 s de silencio de cierre).
    for (let i = 0; i < 10; i += 1) emitir(motor, silencio(100), 32000 + i * BLOQUE)

    const segunda = 'voy a poner a la mujer hablar para que no digan que'
    // Final de OTRA frase que el VAD no segmentó (medido en el playback
    // 2026-10-31). Sin la guarda del límite, el trozo se pegaba a la línea y la
    // fila commiteaba las DOS frases (93 caracteres donde iban 41).
    await motor.evento(eventoAsr(segunda, true))

    const filas = (): Array<Extract<EventoConversacion, { tipo: 'row.committed' }>> =>
      eventos.filter(
        (evento): evento is Extract<EventoConversacion, { tipo: 'row.committed' }> =>
          evento.tipo === 'row.committed',
      )
    // El final NO es frontera (regla 3): no hay fila nueva y la línea abierta
    // sigue siendo la primera, con SU texto. La segunda queda retenida.
    expect(filas()).toHaveLength(0)
    expect(motor.instantanea().locucionAbierta?.texto).toBe(primera)

    // El stop de sesión es frontera de tiempo: la frase ABIERTA (con audio real)
    // se escribe UNA vez. El texto ajeno sin tramo/audio no inventa una fila.
    const unaFila = new Promise<void>((resolver) => {
      motor.suscribir((evento) => {
        if (evento.tipo === 'row.committed' && evento.fila.texto === primera) resolver()
      })
    })
    await motor.cerrar('user')
    await unaFila
    const persistidas = await fluDb.conversations.toArray()
    expect(persistidas).toHaveLength(1)
    expect(persistidas[0]!.text).toBe(primera)
    expect(persistidas[0]!.text).not.toContain(segunda)
  }, 300_000)
})
