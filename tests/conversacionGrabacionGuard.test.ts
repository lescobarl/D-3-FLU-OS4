/**
 * conversacionGrabacionGuard — barrera medida de la grabación real 14c1aa32.
 *
 * La fixture versionada es la MISMA sesión (2026-11-05) con texto y vectores
 * redactados: conserva tiempos, longitudes, hashes, turnId, hablante y motivos.
 * El guard mide esa grabación y la contrasta con la línea base versionada:
 * si una métrica sube, falla; si baja, la línea base se actualiza en el mismo
 * cambio. No hay tests sintéticos como prueba: el caso real es la fixture.
 */
// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hashTexto,
  leerGrabacion,
  medirGrabacion,
} from '../scripts/conversacionGrabacionMetricas.mjs'

type Grabacion = {
  eventos: Array<Record<string, any>>
  turnos: Array<Record<string, any>>
}

type Baseline = {
  stallMs: number
  minEvents: number
  metricas: Record<string, unknown>
  cases: Array<{ id: string; owner: string; metric: string; ceiling: unknown }>
}

const RAIZ = process.cwd()
const FIXTURE = join(
  RAIZ,
  'tests/fixtures/flu-recordings/14c1aa32-5b49-49ba-b119-d4755c9e8d7f',
)
const RUTA_BASELINE = 'scripts/conversacion-grabacion-baseline.json'
const BASELINE = JSON.parse(
  readFileSync(join(RAIZ, RUTA_BASELINE), 'utf8'),
) as Baseline

const DATOS = leerGrabacion(FIXTURE) as Grabacion
const ACTUAL = medirGrabacion(DATOS, { stallMs: BASELINE.stallMs }) as Record<
  string,
  unknown
>

/**
 * Línea base del commit anterior, o null si este commit la introduce.
 * @returns {Baseline|null} Línea base de HEAD.
 */
function baselineEnHead(): Baseline | null {
  try {
    const raw = execFileSync('git', ['show', `HEAD:${RUTA_BASELINE}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(raw) as Baseline
  } catch {
    return null
  }
}

describe('grabación real 14c1aa32 — barrera medida', () => {
  it('ANTI-VACUIDAD: la fixture tiene los eventos y commits de la sesión real', () => {
    expect(DATOS.eventos.length).toBeGreaterThanOrEqual(BASELINE.minEvents)
    expect(ACTUAL.commits).toBeGreaterThan(0)
    expect(ACTUAL.finals).toBeGreaterThan(0)
  })

  it('las métricas reales son EXACTAMENTE la línea base (solo baja)', () => {
    expect(ACTUAL).toEqual(BASELINE.metricas)
  })

  it('la línea base no sube respecto a HEAD', () => {
    const anterior = baselineEnHead()
    if (!anterior) return
    const subidas = Object.entries(anterior.metricas).filter(
      ([clave, valor]) =>
        typeof valor === 'number' &&
        typeof ACTUAL[clave] === 'number' &&
        (ACTUAL[clave] as number) > valor,
    )
    expect(subidas).toEqual([])
  })

  it('cada caso declara su dueño real y su techo medido', () => {
    for (const caso of BASELINE.cases) {
      expect(caso.owner).toMatch(/^src\/.+:\d+$/)
      const archivo = caso.owner.slice(0, caso.owner.lastIndexOf(':'))
      expect(existsSync(join(RAIZ, archivo)), caso.owner).toBe(true)
      expect(ACTUAL[caso.metric]).toBe(caso.ceiling)
    }
  })

  it('una fila infractora nueva sube las métricas (falsificación del detector)', () => {
    const mutado = JSON.parse(JSON.stringify(DATOS)) as Grabacion
    const stop = mutado.eventos
      .filter((evento) => String(evento?.data?.message ?? '').includes('[REC] stop'))
      .pop()
    const t = Number(stop?.t ?? 0) + 1
    mutado.eventos.push({
      t,
      event: 'fila.commiteada',
      data: { turnId: '1', hablante: 'Hablante 1', longitud: 1, locutionId: 'x' },
    })
    mutado.turnos.push({ kind: 'commit', textLen: 1, textHash: hashTexto('nuevo') })
    mutado.eventos.push({
      t: t + 1,
      event: 'LOG:VozProbe',
      data: {
        message:
          'identity-register-skip {"name":"NAME","reason":"tts-echo-window","ageMs":4,"windowMs":1200}',
      },
    })
    const lastRaw = mutado.eventos
      .filter((evento) => evento.event === 'chrome-raw')
      .map((evento) => Number(evento.t))
      .pop()
    mutado.eventos.push({ t: Number(lastRaw ?? t) + BASELINE.stallMs + 1, event: 'chrome-raw', data: {} })

    const medido = medirGrabacion(mutado, { stallMs: BASELINE.stallMs }) as Record<
      string,
      number
    >
    expect(medido.extraCommitsForDuplicateTurn).toBe(
      (ACTUAL.extraCommitsForDuplicateTurn as number) + 1,
    )
    expect(medido.rowsNotEqualAnyFinal).toBe(
      (ACTUAL.rowsNotEqualAnyFinal as number) + 1,
    )
    expect(medido.commitsAfterStop).toBe((ACTUAL.commitsAfterStop as number) + 1)
    expect(medido.identitySkips).toBe((ACTUAL.identitySkips as number) + 1)
    expect(medido.chromeRawGapsOverStall).toBe(
      (ACTUAL.chromeRawGapsOverStall as number) + 1,
    )
  })
})
