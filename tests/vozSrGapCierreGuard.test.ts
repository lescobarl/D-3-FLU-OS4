// @vitest-environment node
/**
 * vozSrGapCierreGuard — EL CIERRE POR SILENCIO TIENE QUE OCURRIR.
 *
 * REGRESIÓN MEDIDA (2026-10-11): el aviso de cierre por silencio quedó con el
 * cuerpo VACÍO; el turno no cerraba jamás y el buffer de audio se saturaba a los
 * 30 s (log: `MicPcm total=1440128` CLAVADO). El aviso `srGap` del watchdog se
 * retiró con la tubería vieja (2026-10-25): su dueño único es ahora la frontera
 * VAD del módulo CONVERSACIÓN, y el hook no tiene una segunda ruta de cierre.
 *
 * Este guard ejecuta el MOTOR REAL (Dexie con fake-indexeddb, VAD real) y mide:
 *   1. silencio ≥ `silenceCloseMs` ⇒ la locución CIERRA y escribe su fila;
 *   2. silencio por debajo del umbral ⇒ NO cierra (sigue abierta);
 *   3. el hook no reintroduce un segundo cierre (`srGap` ausente).
 * PRUEBA DE DETECTOR: la frontera pura marca ambos lados del umbral.
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearMotorConversacionProducto } from '../src/voice/conversation'
import { decidirFrontera } from '../src/voice/conversation/frontera'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports'
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

/** Abre el tramo con voz y le atribuye texto: la locución queda con contenido. */
async function abrirLocucionConTexto() {
  const motor = crearMotorConversacionProducto({ idioma: 'es', ultimoTextoDicho: () => '' })
  motor.abrir()
  for (let i = 0; i < 10; i += 1) motor.audio(tono(100), SR, i * BLOQUE)
  // Caso 7+6: sin final manda el RELOJ del silencio (con final, el corte de
  // 900 ms cerraría por contenido antes del umbral y no mediría el reloj).
  await motor.evento({ resultIndex: 0, results: [{ 0: { transcript: 'hola que tal' }, isFinal: false, length: 1 }] })
  expect(motor.instantanea().locucionAbierta?.texto).toBe('hola que tal')
  return motor
}

/** Alimenta N bloques de silencio de 100 ms y drena la cadena del módulo. */
async function alimentarSilencio(motor: ReturnType<typeof crearMotorConversacionProducto>, bloques: number, desde = 16000) {
  for (let i = 0; i < bloques; i += 1) motor.audio(silencio(100), SR, desde + i * BLOQUE)
  // La cadena del límite es de promesas: un evento vacío espera a que TODO lo
  // anterior (audio incluido el cierre y su escritura) haya terminado.
  await motor.evento({ results: [] })
}

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('cierre por silencio: el turno cierra y escribe su fila', () => {
  it('silencio ≥ silenceCloseMs => la locución CIERRA y la fila llega a Dexie', async () => {
    const motor = await abrirLocucionConTexto()
    const umbral = CONVERSACION_CONFIG.silenceCloseMs
    await alimentarSilencio(motor, Math.ceil(umbral / 100) + 2)

    expect(motor.instantanea().locucionAbierta, 'la locución cerró').toBeNull()
    const filas = await fluDb.conversations.toArray()
    expect(filas, 'una fila por locución cerrada').toHaveLength(1)
    expect(filas[0].text).toBe('hola que tal')
  })

  it('silencio por debajo del umbral => NO cierra (la locución sigue abierta)', async () => {
    const motor = await abrirLocucionConTexto()
    const umbral = CONVERSACION_CONFIG.silenceCloseMs
    await alimentarSilencio(motor, Math.floor(umbral / 100) - 2)

    expect(motor.instantanea().locucionAbierta?.texto, 'sigue abierta').toBe('hola que tal')
    expect(await fluDb.conversations.count(), 'sin fila antes del umbral').toBe(0)
  })

  it('el hook NO tiene una segunda ruta de cierre (srGap retirado)', () => {
    const hook = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')
    expect(hook.includes('srGap'), 'el aviso del watchdog se retiró con la tubería').toBe(false)
  })
})

// PRUEBA DE DETECTOR: la frontera pura marca los dos lados del umbral.
describe('la frontera no es decorativa', () => {
  it('cierra con silencio suficiente y no con menos; la voz gana', () => {
    expect(decidirFrontera({ medida: { hayVoz: false, silencioMs: 5000 }, textoAjeno: false, abierta: true })).toEqual({
      cerrar: true,
      causa: 'silencio',
    })
    expect(decidirFrontera({ medida: { hayVoz: false, silencioMs: 4999 }, textoAjeno: false, abierta: true })).toEqual({
      cerrar: false,
      causa: null,
    })
    expect(decidirFrontera({ medida: { hayVoz: true, silencioMs: 9000 }, textoAjeno: true, abierta: true })).toEqual({
      cerrar: false,
      causa: null,
    })
    expect(decidirFrontera({ medida: { hayVoz: false, silencioMs: 900 }, textoAjeno: true, abierta: true })).toEqual({
      cerrar: true,
      causa: 'frontera',
    })
  })
})
