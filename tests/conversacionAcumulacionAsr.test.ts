// @vitest-environment node
/**
 * ACUMULACIÓN DEL EVENTO ASR EN EL LÍMITE — el reconocedor entrega FRAGMENTOS,
 * no frases acumuladas, y el módulo exige el texto COMPLETO del tramo.
 *
 * MEDIDO (playback 8f3112c2, 2026-10-25): eventos multi-resultado donde
 * `results[0]` es el prefijo re-plegado y `results[1]` la cola que crece
 * (`"bien"` + `" vamos"`; `"bien Vamos"` + `" a"`; `"bien vamos"` + `" a hacer"`)
 * y eventos con DOS finales del mismo tramo (re-escucha completa). El límite
 * ingería cada resultado por separado y la revisión del módulo reemplazaba por la
 * cola: la locución terminaba en `"a hacer"` y las filas abarcaban 119–152 s.
 *
 * Monta el motor REAL del producto (Dexie con fake-indexeddb, VAD real, cadena
 * real) y mide: (1) acumulación del tramo con la cola re-plegada; (2) unión de
 * finales hermanos sin perder palabras; (3) la reentrega con final retenido no
 * duplica; (4) la fila commiteada lleva la frase COMPLETA.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearMotorConversacionProducto } from '../src/voice/conversation'
import type { EventoConversacion } from '../src/voice/conversation'
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

/** Un resultado del reconocedor con la forma que entrega Chrome. */
function resultado(texto: string, final = false): {
  0: { transcript: string }
  isFinal: boolean
  length: number
} {
  return { 0: { transcript: texto }, isFinal: final, length: 1 }
}

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('producto — el texto del tramo se compone con los trozos del evento', () => {
  it('acumula prefijo re-plegado + cola, une finales hermanos y commitea la frase completa', async () => {
    const eventos: EventoConversacion[] = []
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    motor.suscribir((evento) => eventos.push(evento))
    motor.abrir()

    // 1 s de silencio y 1 s de voz: abre el tramo del enunciado.
    for (let i = 0; i < 10; i += 1) motor.audio(silencio(100), SR, i * BLOQUE)
    for (let i = 0; i < 10; i += 1) motor.audio(tono(100), SR, 16000 + i * BLOQUE)

    // Secuencia real del playback: el prefijo crece entre eventos y la cola se
    // re-emite re-plegada con `resultIndex=1`. Sin acumular, la línea queda en `"a"`.
    await motor.evento({ resultIndex: 0, results: [resultado('bien')] })
    await motor.evento({ resultIndex: 0, results: [resultado('bien Vamos')] })
    await motor.evento({
      resultIndex: 1,
      results: [resultado('bien Vamos'), resultado(' a')],
    })
    await motor.evento({
      resultIndex: 1,
      results: [resultado('bien vamos'), resultado(' a hacer')],
    })
    expect(motor.instantanea().locucionAbierta?.texto).toBe('bien Vamos a hacer')

    // Dos finales del MISMO evento: el evento trae la HIPÓTESIS COMPLETA desde
    // 0 (con el prefijo ya dicho); son dos re-escuchas y se unen conservando las
    // palabras de ambas (medido: una trae "esto", otra "escucha").
    await motor.evento({
      resultIndex: 0,
      results: [
        resultado('bien Vamos a hacer y esto es una prueba', true),
        resultado('bien Vamos a hacer y esto es una escucha', true),
      ],
    })
    const conFinales = motor.instantanea().locucionAbierta?.texto ?? ''
    expect(conFinales.startsWith('bien Vamos a hacer')).toBe(true)
    expect(conFinales).toContain('prueba')
    expect(conFinales).toContain('escucha')

    // Evento FINAL: la hipótesis completa viaja desde 0 (aunque el evento
    // declare resultIndex=1); el final sustituye la línea y no la duplica.
    const completo = `${conFinales} ahora si`
    await motor.evento({
      resultIndex: 0,
      results: [resultado(completo, true)],
    })
    const conRetenido = motor.instantanea().locucionAbierta?.texto ?? ''
    expect(conRetenido).toBe(completo)
    expect(conRetenido.indexOf(conFinales)).toBe(conRetenido.lastIndexOf(conFinales))

    // La fila commiteada lleva la MISMA frase canónica del módulo (Anexo B 3).
    const filaCommiteada = new Promise<Extract<EventoConversacion, { tipo: 'row.committed' }>>(
      (resolver) => {
        motor.suscribir((evento) => {
          if (evento.tipo === 'row.committed') resolver(evento)
        })
      },
    )
    motor.cerrar('user')
    const { fila } = await filaCommiteada
    expect(fila.texto).toBe(conRetenido)
    expect(fila.texto).not.toBe('a hacer')

    const persistidas = await fluDb.conversations.toArray()
    expect(persistidas).toHaveLength(1)
    expect(persistidas[0].text).toBe(conRetenido)
    expect(eventos.some((evento) => evento.tipo === 'row.committed')).toBe(true)
  })

  it('una corrección del mismo resultado no se concatena (conversa → conversación)', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
    })
    motor.abrir()
    for (let i = 0; i < 10; i += 1) motor.audio(silencio(100), SR, i * BLOQUE)
    for (let i = 0; i < 10; i += 1) motor.audio(tono(100), SR, 16000 + i * BLOQUE)

    const base = 'bien vamos a hacer unas pruebas de diarización de'
    // El contexto ya está en la línea abierta (evento previo).
    await motor.evento({ resultIndex: 0, results: [resultado(base)] })
    // Chrome corrige el MISMO resultado: " conversa" → " conversación".
    await motor.evento({
      resultIndex: 1,
      results: [resultado(base), resultado(' conversa')],
    })
    await motor.evento({
      resultIndex: 1,
      results: [resultado(base), resultado(' conversación')],
    })

    // La caja es la frase viva que el usuario ve antes del final.
    const caja = motor.instantanea().box.texto
    expect(caja).toBe(`${base} conversación`)

    await motor.evento({
      resultIndex: 0,
      results: [resultado(`${base} conversación`, true)],
    })

    const texto = motor.instantanea().locucionAbierta?.texto ?? ''
    expect(texto).toBe(`${base} conversación`)
  })
})
