/**
 * Barrera de la sesión REAL 80a43c12 (2026-11-06).
 *
 * Esta grabación desmintió al playback: el script daba 0 turnIds duplicados y
 * la sesión real dio `turnId 9` duplicado; además `identity-register` salió con
 * `turnMeasured:0`/`baseVector:0`. La fixture está redactada (sin texto ni
 * vectores) y conserva tiempos, longitudes, hashes, turnId, hablante y motivos.
 *
 * Regla: el turno lo acuña el módulo (`sesion`/`cierre`) y la voz que registra
 * el nombre es la fila medida (`fila.firma`), nunca una firma del hook.
 */
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { leerGrabacion, medirGrabacion } from '../scripts/conversacionGrabacionMetricas.mjs'

type Baseline = {
  stallMs: number
  minEvents: number
  metricas: Record<string, unknown>
  cases: Array<{ id: string; owner: string; metric: string; ceiling: unknown }>
}

const RAIZ = process.cwd()
const FIXTURE = join(
  RAIZ,
  'tests/fixtures/flu-recordings/80a43c12-fa87-4c55-9b4c-92307023b606',
)
const BASELINE = JSON.parse(
  readFileSync(join(RAIZ, 'scripts/conversacion-grabacion-baseline-80a.json'), 'utf8'),
) as Baseline
const DATOS = leerGrabacion(FIXTURE) as { eventos: Array<Record<string, any>>; turnos: Array<Record<string, any>> }
const ACTUAL = medirGrabacion(DATOS, { stallMs: BASELINE.stallMs }) as Record<string, unknown>

/** Mensajes `identity-register` de la sesión real. */
function registrosDeIdentidad(): Array<Record<string, unknown>> {
  return DATOS.eventos
    .map((evento) => String(evento?.data?.message ?? ''))
    .filter((mensaje) => mensaje.startsWith('identity-register '))
    .map((mensaje) => JSON.parse(mensaje.slice('identity-register '.length)))
}

describe('sesión real 80a43c12 — turno y nombre medidos', () => {
  it('ANTI-VACUIDAD: la fixture es la sesión real, no el playback', () => {
    expect(DATOS.eventos.length).toBeGreaterThanOrEqual(BASELINE.minEvents)
    expect(ACTUAL.commits).toBeGreaterThan(0)
    expect(ACTUAL.finals).toBeGreaterThan(0)
    // El playback script daba 0 duplicados; esta sesión real dio el turnId 9.
    expect(ACTUAL.duplicateTurnIds).toEqual(['9'])
    expect(ACTUAL.extraCommitsForDuplicateTurn).toBe(1)
  })

  it('las métricas reales son EXACTAMENTE la línea base', () => {
    expect(ACTUAL).toEqual(BASELINE.metricas)
  })

  it('el nombre se registra con la firma de la FILA medida, no con una firma del hook', () => {
    const registros = registrosDeIdentidad()
    expect(registros.length).toBeGreaterThan(0)
    // Evidencia del defecto que esta barrera protege: la ruta pasiva antigua
    // registraba con `turnMeasured:0` aunque hubiera firma de cluster.
    expect(registros.some((registro) => Number(registro.turnMeasured) === 0)).toBe(true)

    const hook = readFileSync(
      join(RAIZ, 'src/voice/hooks/useFluVoiceAssistant.js'),
      'utf8',
    )
    const modulo = readFileSync(join(RAIZ, 'src/voice/conversation/cierre.ts'), 'utf8')
    expect(hook).not.toMatch(/computeTurnSignature|selectVoicedWindow/)
    expect(hook).toContain('lastFirmaRef.current = Array.isArray(fila?.firma)')
    expect(hook).toContain('signatureVector: lastFirmaRef.current')
    expect(modulo).toContain('estado.turnosConFila.has(sugerido)')
    expect(modulo).toContain('estado.turnoActual = turno')
    expect(modulo).toContain('embebedor.medir(')
  })

  it('cada caso declara su dueño real y su techo medido', () => {
    for (const caso of BASELINE.cases) {
      expect(caso.owner).toMatch(/^src\/.+:\d+$/)
      const archivo = caso.owner.slice(0, caso.owner.lastIndexOf(':'))
      expect(existsSync(join(RAIZ, archivo)), caso.owner).toBe(true)
      expect(ACTUAL[caso.metric]).toBe(caso.ceiling)
    }
  })
})
