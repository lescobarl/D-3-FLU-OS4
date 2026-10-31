// @vitest-environment node
/**
 * CASO 13 (UN CICLO DE ESCUCHA) — guard de comportamiento.
 *
 * Criterio del encargo: la escucha no reinicia sesión ni turnId por sí sola;
 * el reinicio de watchdog (onend → onstart) se permite solo si declara motivo
 * y conserva sesión/turnId. Guard: reinicio sin motivo o reset de turnId => rojo.
 *
 * Qué mide este guard:
 *  - `requestRecognitionRestart` (dueño único del reinicio de la escucha) exige
 *    MOTIVO declarado: firma `(motivo, delay)`, validación de no-vacío con
 *    rechazo registrado, y TODAS sus llamadas —hook, política de suspend y
 *    fallback local— pasan un literal de motivo;
 *  - el producto NO reinicia la sesión en cada `onstart` (corte de Chrome):
 *    `abrir()` con sesión activa vuelve sin tocar sesión ni turno — COMPORTAMIENTO
 *    con el motor real: dos `abrir()` con locuciones entre medio conservan el
 *    MISMO sessionId y el MISMO turno (la segunda locución es reentrega del
 *    turno commiteado: cierra contada como `turnoYaEscrito`, nunca una segunda
 *    fila — insert-only, mandato 2026-10-30).
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fluDb } from '../src/core/db/fluDatabase'
import { crearMotorConversacionProducto } from '../src/voice/conversation/index'
import type { EventoConversacion, EventoProducto } from '../src/voice/conversation/index'
import { getVadEnergyThreshold } from '../src/voice/lib/asr/asrConfig.js'

const SAMPLE_RATE = 16000
const BLOQUE = 1600 // 100 ms

const fuenteDe = (ruta: string): string =>
  readFileSync(join(process.cwd(), ruta), 'utf8')

/**
 * ¿`requestRecognitionRestart` exige motivo declarado? Firma con motivo,
 * validación de no-vacío, y TODAS sus llamadas pasan un literal de motivo.
 */
export function reinicioExigeMotivo(src: string): boolean {
  const firma = /requestRecognitionRestart = useCallback\(\s*\(motivo, delay/.test(src)
  const validacion =
    /String\(motivo \|\| ''\)\.trim\(\)/.test(src) &&
    /reinicio de la escucha sin motivo declarado/.test(src)
  const total = (src.match(/requestRecognitionRestart(?:Ref\.current\?\.)?\(/g) ?? []).length
  const conMotivo = (
    src.match(/requestRecognitionRestart(?:Ref\.current\?\.)?\((['"])(?:[^'"]+)\1/g) ?? []
  ).length
  return firma && validacion && total > 0 && total === conMotivo
}

/** ¿La reanudación tras el suspend (política única) declara su motivo? */
export function reanudarDeclaraMotivo(src: string): boolean {
  const ramas = (src.match(/requestRestart\?\.\('reanudar', 0\)/g) ?? []).length
  return ramas === 2
}

/** ¿El reinicio del fallback local declara su motivo por el MISMO dueño? */
export function fallbackReiniciaConMotivo(src: string): boolean {
  return src.includes(
    "requestRecognitionRestartRef.current?.('fallback-rebuild', restartCfg.retryBackoffMs)",
  )
}

/** ¿`abrir()` con sesión activa vuelve sin tocar sesión ni turno (producto)? */
export function sesionSobreviveAlReinicio(src: string): boolean {
  return /if \(estadoMotor !== 'inactiva'\) return/.test(src)
}

/** Tono con RMS cuatro veces por encima del piso REAL del VAD. */
function tono(ms: number): Float32Array {
  const n = Math.round((SAMPLE_RATE * ms) / 1000)
  const muestras = new Float32Array(n)
  const amplitud = Math.sqrt(2) * getVadEnergyThreshold() * 4
  for (let i = 0; i < n; i += 1) {
    muestras[i] = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * amplitud
  }
  return muestras
}

/** Silencio digital del mismo tamaño. */
function silencio(ms: number): Float32Array {
  return new Float32Array(Math.round((SAMPLE_RATE * ms) / 1000))
}

/** Evento del reconocedor con la forma que entrega Chrome. */
function eventoAsr(texto: string, final = false): EventoProducto {
  return {
    resultIndex: 0,
    results: [{ 0: { transcript: texto }, isFinal: final, length: 1 }],
  }
}

/**
 * Locución del ciclo real de la escucha: 1 s de silencio + 1 s de voz + frase +
 * CORTE de 5 s de silencio (puerta de abajo, mandato 2026-10-30: el final marca
 * pero NO cierra). La SESIÓN SIGUE ABIERTA — igual que el watchdog: onend →
 * onstart nunca llama a `cerrar` (eso es solo de stopListening). `base` corre
 * los índices de muestra para no reusar tramos entre locuciones; el siguiente
 * tramo debe empezar tras el cierre (base + 32000 + 80000 muestras).
 * `espera` elige el evento que confirma el cierre: `row.committed` (turno nuevo)
 * o `locution.closed` (reentrega descartada, que no commitea).
 */
async function locucionProducto<T extends EventoConversacion['tipo'] = 'row.committed'>(
  motor: ReturnType<typeof crearMotorConversacionProducto>,
  texto: string,
  base: number,
  espera: T = 'row.committed' as T,
): Promise<Extract<EventoConversacion, { tipo: T }>> {
  for (let i = 0; i < 10; i += 1) motor.audio(silencio(100), SAMPLE_RATE, base + i * BLOQUE)
  for (let i = 0; i < 10; i += 1) motor.audio(tono(100), SAMPLE_RATE, base + 16000 + i * BLOQUE)
  await motor.evento(eventoAsr(texto, true))
  const cierre = new Promise<Extract<EventoConversacion, { tipo: T }>>((resolver) => {
    motor.suscribir((evento) => {
      if (evento.tipo === espera) resolver(evento as Extract<EventoConversacion, { tipo: T }>)
    })
  })
  motor.audio(silencio(5000), SAMPLE_RATE, base + 32000)
  return cierre
}

beforeEach(async () => {
  await fluDb.conversations.clear()
})

describe('Caso 13 — un ciclo de escucha no reinicia sesión ni turno (motor real)', () => {
  it('dos onstart (abrir) no parten la conversación: mismo sessionId y misma fila', async () => {
    const motor = crearMotorConversacionProducto({
      idioma: 'es',
      ultimoTextoDicho: () => '',
      turnId: () => 'T-uno',
    })
    motor.abrir()
    const primerCommit = await locucionProducto(motor, 'hola', 0)
    const sessionIdVigente = motor.instantanea().sessionId

    // Watchdog de Chrome: onend → onstart → abrir() de nuevo.
    motor.abrir()
    const trasReinicio = motor.instantanea()
    expect(trasReinicio.sessionId).toBe(sessionIdVigente)
    expect(trasReinicio.activa).toBe(true)

    // La conversación sigue: el turno es el MISMO. La segunda locución del mismo
    // turno es una REENTREGA (insert-only): cierra, se cuenta como descarte y NO
    // inserta otra fila. base 120000: el cierre de 5 s anterior acaba en 112000.
    const segundoCierre = await locucionProducto(motor, 'adios', 120000, 'locution.closed')
    expect(segundoCierre.sessionId).toBe(sessionIdVigente)
    expect(primerCommit.fila.turnId).toBe('T-uno')
    const trasSegundo = motor.instantanea()
    // El descarte es la prueba de que la reentrega cayó en el MISMO turno: solo
    // se descarta `turnoYaEscrito` cuando el turnId coincide con la fila ya
    // commiteada (el turno sobrevivió al reinicio de la escucha).
    expect(trasSegundo.descartes.map((descarte) => descarte.motivo)).toEqual(['turnoYaEscrito'])
    const filas = trasSegundo.filas
    expect(filas).toHaveLength(1)
    expect(filas[0]!.turnId).toBe('T-uno')
    expect(new Set(filas.map((fila) => fila.sessionId))).toEqual(new Set([sessionIdVigente]))
    const persistidas = await fluDb.conversations.toArray()
    expect(persistidas).toHaveLength(1)
    expect(persistidas[0]!.sessionId).toBe(sessionIdVigente)
  })
})

describe('Caso 13 — los dueños viven en el archivo real', () => {
  it('el reinicio de la escucha exige motivo declarado (hook)', () => {
    expect(reinicioExigeMotivo(fuenteDe('src/voice/hooks/useFluVoiceAssistant.js'))).toBe(true)
  })

  it('la reanudación tras el suspend declara su motivo (voiceStallPolicy)', () => {
    expect(reanudarDeclaraMotivo(fuenteDe('src/voice/lib/voiceStallPolicy.js'))).toBe(true)
  })

  it('el reinicio del fallback local declara su motivo (useLocalAsrFallback)', () => {
    expect(fallbackReiniciaConMotivo(fuenteDe('src/voice/hooks/useLocalAsrFallback.js'))).toBe(true)
  })

  it('abrir() con sesión activa no reinicia sesión ni turno (producto)', () => {
    expect(sesionSobreviveAlReinicio(fuenteDe('src/voice/conversation/producto.ts'))).toBe(true)
  })
})

describe('Caso 13 — PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('un reinicio sin motivo (solo delay) => rojo; con literal en todas => verde', () => {
    const firma =
      'const requestRecognitionRestart = useCallback(\n' +
      "    (motivo, delay = 0) => {\n" +
      "      const motivoDeclarado = String(motivo || '').trim()\n" +
      "      if (!motivoDeclarado) {\n" +
      "        logCaughtError('escucha.reinicio.sinMotivo', new Error('reinicio de la escucha sin motivo declarado'))\n" +
      '        return\n' +
      '      }\n'
    expect(
      reinicioExigeMotivo(firma + "  requestRecognitionRestart('onend', 100)\n  }\n"),
    ).toBe(true)
    expect(
      reinicioExigeMotivo(firma + '  requestRecognitionRestart(100)\n  }\n'),
      'un reinicio sin motivo declarado es rojo',
    ).toBe(false)
    const sinValidacion = firma.replace(
      "const motivoDeclarado = String(motivo || '').trim()\n      if (!motivoDeclarado) {\n        logCaughtError('escucha.reinicio.sinMotivo', new Error('reinicio de la escucha sin motivo declarado'))\n        return\n      }\n",
      '',
    )
    expect(
      reinicioExigeMotivo(sinValidacion + "  requestRecognitionRestart('onend', 100)\n  }\n"),
      'sin validación el reinicio sin motivo pasa',
    ).toBe(false)
  })

  it('la forma vieja de reanudar (sin motivo) => rojo; con motivo en ambas ramas => verde', () => {
    expect(reanudarDeclaraMotivo('requestRestart?.(0)')).toBe(false)
    expect(
      reanudarDeclaraMotivo(
        "requestRestart?.('reanudar', 0)\nif (isConversationActive()) requestRestart?.('reanudar', 0)",
      ),
    ).toBe(true)
    expect(
      reanudarDeclaraMotivo("requestRestart?.('reanudar', 0)"),
      'una sola rama con motivo no alcanza',
    ).toBe(false)
  })

  it('el reinicio del fallback sin motivo => rojo; con motivo => verde', () => {
    expect(
      fallbackReiniciaConMotivo('requestRecognitionRestartRef.current?.(restartCfg.retryBackoffMs)'),
    ).toBe(false)
    expect(
      fallbackReiniciaConMotivo(
        "requestRecognitionRestartRef.current?.('fallback-rebuild', restartCfg.retryBackoffMs)",
      ),
    ).toBe(true)
  })

  it('un abrir() sin guarda de sesión activa => rojo; con la guarda => verde', () => {
    const conGuarda =
      "abrir: () => {\n  libroDeLinea = null\n  if (estadoMotor !== 'inactiva') return\n  api.start({})\n}"
    expect(sesionSobreviveAlReinicio(conGuarda)).toBe(true)
    const sinGuarda = conGuarda.replace("  if (estadoMotor !== 'inactiva') return\n", '')
    expect(sesionSobreviveAlReinicio(sinGuarda)).toBe(false)
  })
})
