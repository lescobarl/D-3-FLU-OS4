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
 * (2) el texto del tramo nuevo cierra el anterior por FRONTERA; (3) MUTACIÓN:
 * con el tramo resuelto mal, el texto se pega al anterior y hay una sola fila.
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
  it('cada fila lleva su tramo de audio y el texto ajeno cierra por frontera', async () => {
    const eventos: EventoConversacion[] = []
    // Caso 8: un turnId => una fila. El hook real avanza el turno con cada commit;
    // sin proveedor, las dos locuciones compartirían el turno de sesión y la
    // segunda se consolidaría en la fila de la primera (la fila 'adios' no nace).
    let turnoVigente = 'turno-uno'
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
      turnId: () => turnoVigente,
    })
    motor.suscribir((evento) => eventos.push(evento))
    motor.abrir()

    // 1 s de silencio inicial: no hay tramo todavía (la fila no puede nacer en 0).
    for (let i = 0; i < 10; i += 1) emitir(motor, silencio(100), i * BLOQUE)
    // 1 s de voz: tramo T1 arranca en la muestra 16000.
    for (let i = 0; i < 10; i += 1) emitir(motor, tono(100), 16000 + i * BLOQUE)
    await motor.evento(eventoAsr('hola'))
    // La primera locución queda en su turno: la segunda nace en OTRO turno.
    turnoVigente = 'turno-dos'

    // 1 s de silencio: el VAD corta T1 (silencio de cola ≥ 900 ms).
    for (let i = 0; i < 10; i += 1) emitir(motor, silencio(100), 32000 + i * BLOQUE)
    // 1 s de voz nueva: tramo T2 arranca en la muestra 48000.
    for (let i = 0; i < 10; i += 1) emitir(motor, tono(100), 48000 + i * BLOQUE)
    // El texto del tramo NUEVO es el que dispara la frontera (regla 2).
    await motor.evento(eventoAsr('adios'))

    const filas = eventos.filter(
      (evento): evento is Extract<EventoConversacion, { tipo: 'row.committed' }> =>
        evento.tipo === 'row.committed',
    )
    expect(filas).toHaveLength(1)
    expect(filas[0].fila.texto).toBe('hola')
    // La fila lleva SU tramo: de la primera voz a su fin, no `[0, cursor]`.
    expect(filas[0].fila.tramo).toEqual({
      inicio: 16000,
      fin: 32000,
      sampleRate: SR,
    })

    const cierres = eventos.filter(
      (evento): evento is Extract<EventoConversacion, { tipo: 'locution.closed' }> =>
        evento.tipo === 'locution.closed',
    )
    expect(cierres).toHaveLength(1)
    expect(cierres[0].causa).toBe('frontera')

    // Cierre real de la sesión: la segunda locución nace en T2 (muestra 48000).
    const dosFilas = new Promise<void>((resolver) => {
      motor.suscribir((evento) => {
        if (evento.tipo === 'row.committed' && evento.fila.texto === 'adios') resolver()
      })
    })
    motor.cerrar('user')
    await dosFilas

    const persistidas = await fluDb.conversations.toArray()
    expect(persistidas).toHaveLength(2)
    const adios = persistidas.find((fila) => fila.text === 'adios')
    const hola = persistidas.find((fila) => fila.text === 'hola')
    if (!hola || !adios) throw new Error('faltan las dos filas')
    expect(hola.meta?.conversacion?.tramo).toMatchObject({ inicio: 16000, fin: 32000 })
    expect(adios.meta?.conversacion?.tramo).toMatchObject({ inicio: 48000, fin: 64000 })
  })

  it('un final ajeno SIN tramo vivo no se pega a la línea abierta', async () => {
    const eventos: EventoConversacion[] = []
    let turnoVigente = 'turno-uno'
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
      turnId: () => turnoVigente,
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

    // Final de OTRA frase que el VAD no segmentó (medido en el playback
    // 2026-10-31). Sin la guarda del límite, el trozo se pegaba a la línea y la
    // fila commiteaba las DOS frases (93 caracteres donde iban 41).
    await motor.evento(eventoAsr('voy a poner a la mujer hablar para que no digan que', true))

    const filas = (): Array<Extract<EventoConversacion, { tipo: 'row.committed' }>> =>
      eventos.filter(
        (evento): evento is Extract<EventoConversacion, { tipo: 'row.committed' }> =>
          evento.tipo === 'row.committed',
      )
    expect(filas()).toHaveLength(1)
    expect(filas()[0].fila.texto).toBe(primera)
    expect(motor.instantanea().locucionAbierta).toBeNull()
    turnoVigente = 'turno-dos'

    // La continuación de esa frase llega CON su tramo: es SU audio y su fila.
    for (let i = 0; i < 10; i += 1) emitir(motor, tono(100), 48000 + i * BLOQUE)
    const completa = 'voy a poner a la mujer hablar para que no digan que no hago mi tarea'
    await motor.evento(eventoAsr(completa, true))
    // 5 s de silencio: cierre por la puerta de abajo (silencio de cierre). La
    // cadena de audio es asíncrona: el commit de la segunda fila se espera.
    for (let i = 0; i < 55; i += 1) emitir(motor, silencio(100), 64000 + i * BLOQUE)
    const segundaFila = new Promise<void>((resolver) => {
      motor.suscribir((evento) => {
        if (evento.tipo === 'row.committed' && evento.fila.texto === completa) resolver()
      })
    })
    motor.cerrar('user')
    await segundaFila

    expect(filas().map((evento) => evento.fila.texto)).toEqual([primera, completa])
    const persistidas = await fluDb.conversations.toArray()
    expect(persistidas).toHaveLength(2)
    expect(persistidas.some((fila) => fila.text.includes(primera) && fila.text !== primera)).toBe(false)
  })
})
