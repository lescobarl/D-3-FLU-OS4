/**
 * Barrera de la sesión REAL d70267b8 (replay de 7d337663, 2026-11-08).
 *
 * Fixture real; no es un test sintético. La sesión se generó con el reinicio del
 * reconocedor en el borde de turno (`onLocucionCommiteada`) y con el puente ASR
 * del hook. Mide reentrega, texto/audio imposible, canal de log, diarización y
 * nombre con el dueño `medirConversacionReal`.
 *
 * Residual declarado: fuzzyCarry=2. El caso exacto, H2, shortLong, zero y log
 * quedaron en 0. Los dueños de los fixes se verifican también en fuente.
 *
 * @revisor CREAR NUEVO — barrera de la sesión real; reusa el medidor existente.
 */
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  leerGrabacion,
  medirConversacionReal,
} from '../scripts/conversacionGrabacionMetricas.mjs'

type Baseline = {
  minEvents: number
  metricas: Record<string, unknown>
  cases: Array<{ id: string; owner: string; metric: string; ceiling: unknown }>
}

const RAIZ = process.cwd()
const FIXTURE = join(
  RAIZ,
  'tests/fixtures/flu-recordings/d70267b8-7d45-4cec-9f6a-fa3ca262f707',
)
const RUTA_BASELINE = 'scripts/conversacion-grabacion-baseline-d702.json'
const BASELINE = JSON.parse(
  readFileSync(join(RAIZ, RUTA_BASELINE), 'utf8'),
) as Baseline
const DATOS = leerGrabacion(FIXTURE) as {
  eventos: Array<Record<string, any>>
  turnos: Array<Record<string, any>>
}
const ACTUAL = medirConversacionReal(DATOS) as Record<string, unknown>

describe('sesión real d70267b8 — reinicio de turno, log y diarización', () => {
  it('ANTI-VACUIDAD: la fixture es la sesión real, no un test sintético', () => {
    expect(DATOS.eventos.length).toBeGreaterThanOrEqual(BASELINE.minEvents)
    expect(Number(ACTUAL.commits)).toBeGreaterThan(0)
    expect(Number(ACTUAL.normalConversationLogs)).toBeGreaterThan(0)
  })

  it('las métricas reales son EXACTAMENTE la línea base', () => {
    expect(ACTUAL).toEqual(BASELINE.metricas)
  })

  it('cada caso declara su dueño real y su techo medido', () => {
    for (const caso of BASELINE.cases) {
      expect(caso.owner).toMatch(/^src\/.+:\d+$/)
      const archivo = caso.owner.slice(0, caso.owner.lastIndexOf(':'))
      expect(existsSync(join(RAIZ, archivo)), caso.owner).toBe(true)
      expect(ACTUAL[caso.metric]).toBe(caso.ceiling)
    }
  })

  it('los dueños de los fixes siguen en su sitio', () => {
    const hook = readFileSync(
      join(RAIZ, 'src/voice/hooks/useFluVoiceAssistant.js'),
      'utf8',
    )
    expect(hook).toContain('aplicarWakePendiente(')
    const wakePending = readFileSync(
      join(RAIZ, 'src/voice/hooks/wakePending.js'),
      'utf8',
    )
    expect(wakePending).toContain('slice(desdeResultado)')
    expect(wakePending).toContain('resultIndex: 0')
    expect(hook).toContain("requestRecognitionRestartRef.current?.('frontera-turno', 0)")

    const adapters = readFileSync(
      join(RAIZ, 'src/voice/conversation/adapters.ts'),
      'utf8',
    )
    expect(adapters).toContain("relayLog('LOG', 'conversacion', contexto, data)")
    expect(adapters).not.toContain(
      'return { registrar: (contexto, ...detalles) => logCaughtError(contexto, ...detalles) }',
    )

    const audioMath = readFileSync(
      join(RAIZ, 'src/voice/lib/audioMath.js'),
      'utf8',
    )
    expect(audioMath).toContain(
      'if (command === COMMAND_IDS.REGISTRAR_PARTICIPANTE) return false',
    )
    expect(audioMath).toContain("'registrame'")

    const metricas = readFileSync(
      join(RAIZ, 'scripts/conversacionGrabacionMetricas.mjs'),
      'utf8',
    )
    expect(metricas).toContain('muestrasAudio <= 1')

    const composicion = readFileSync(
      join(RAIZ, 'src/voice/conversation/composicion.ts'),
      'utf8',
    )
    expect(composicion).toContain(
      'const recorte = total > vigente.corte ? vigente.corte : 0',
    )
    expect(composicion).toMatch(/hayFinal\s*\?\s*recorte\s*:/)
    const ingesta = readFileSync(
      join(RAIZ, 'src/voice/conversation/ingesta.ts'),
      'utf8',
    )
    expect(ingesta).not.toContain('recortarPrefijoDeLaFilaPrevia')
  })
})
