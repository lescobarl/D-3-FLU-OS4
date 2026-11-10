// BARRERA: conversacion-vivo
/**
 * conversacionLiveBarrierGuard — la conversación pinta lo que se dicta y el
 * stop no tira texto.
 *
 * Las fixtures son las sesiones REALES 5318166b y 69a4fa97 (2026-11-10); la
 * miden los dueños `medirIncidenteLive` / `medirCorteDeWake` y este guard.
 * No es un test sintético: los números salen de las sesiones del dueño.
 *
 * Defectos medidos:
 *  - 5318166b: Chrome transcribía en vivo y la caja no avanzaba; la línea
 *    abierta vivió 76 s, 0 srGap; al parar se descartaron 2 pendientes con texto.
 *  - 69a4fa97: el final llegó sin wake y la wake+frase solo como intermedio; el
 *    srGap cortó antes de la revisión y la fila quedó sin consulta.
 *
 * Los casos de fuente son 0: si el patrón viejo reaparece, el guard falla.
 * Cada detector se falsifica con su entrada infractora.
 */
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  leerGrabacion,
  medirCorteDeWake,
  medirIncidenteLive,
} from '../scripts/conversacionGrabacionMetricas.mjs'

type Baseline = {
  sessionId: string
  minEvents: number
  metricas: Record<string, unknown>
  sessionCorte: string
  minEventsCorte: number
  metricasCorte: Record<string, unknown>
  casos: Array<{ id: string; owner: string; limite: number }>
}

const RAIZ = process.cwd()
const FIXTURE = join(
  RAIZ,
  'tests/fixtures/flu-recordings/5318166b-80e1-4a8c-80e0-871f7f1b21ab',
)
const RUTA_BASELINE = 'scripts/conversacion-live-baseline.json'
const BASELINE = JSON.parse(
  readFileSync(join(RAIZ, RUTA_BASELINE), 'utf8'),
) as Baseline
const FIXTURE_CORTE = join(
  RAIZ,
  'tests/fixtures/flu-recordings/69a4fa97-0cca-453a-8de1-26bd458f7c28',
)
const DATOS = leerGrabacion(FIXTURE) as { eventos: Array<Record<string, any>>; turnos: Array<Record<string, any>> }
const ACTUAL = medirIncidenteLive(DATOS) as Record<string, unknown>
const DATOS_CORTE = leerGrabacion(FIXTURE_CORTE) as {
  eventos: Array<Record<string, any>>
  turnos: Array<Record<string, any>>
}
const ACTUAL_CORTE = medirCorteDeWake(DATOS_CORTE) as Record<string, unknown>

const FUENTES = {
  ingesta: readFileSync(join(RAIZ, 'src/voice/conversation/ingesta.ts'), 'utf8'),
  texto: readFileSync(join(RAIZ, 'src/voice/conversation/texto.ts'), 'utf8'),
  sesion: readFileSync(join(RAIZ, 'src/voice/conversation/sesion.ts'), 'utf8'),
  producto: readFileSync(
    join(RAIZ, 'src/voice/compose/conversationMotorProducto.js'),
    'utf8',
  ),
  cola: readFileSync(join(RAIZ, 'src/voice/conversation/cola.ts'), 'utf8'),
} as const

type Fuente = keyof typeof FUENTES
type CasoId =
  | 'caja-sin-pendiente'
  | 'descarte-por-audio'
  | 'medida-sin-paso'
  | 'srGap-corta-wake'

/** Patrón viejo de cada caso y en qué dueño vivía. */
const PATRONES: Readonly<Record<CasoId, { fuente: Fuente; patron: string }>> = {
  'caja-sin-pendiente': {
    fuente: 'producto',
    patron: "const viva = evento.abierta ? String(evento.fraseCanonica || '') : ''",
  },
  'descarte-por-audio': {
    fuente: 'texto',
    patron: 'tramo.fin > previa.tramo.fin',
  },
  'medida-sin-paso': {
    fuente: 'ingesta',
    patron: 'estado.muestrasEnUltimoIntento < minimo',
  },
  'srGap-corta-wake': {
    fuente: 'texto',
    patron: 'function marcarVigente',
  },
}

/**
 * Cuenta las apariciones del patrón viejo en la fuente indicada.
 * @param fuentes Fuentes reales o mutadas.
 * @param id Caso a medir.
 * @returns Ocurrencias del patrón.
 * @revisor CREAR NUEVO — detector de la barrera; no hay dueño previo.
 */
function ocurrencias(fuentes: typeof FUENTES, id: CasoId): number {
  const { fuente, patron } = PATRONES[id]
  return fuentes[fuente].split(patron).length - 1
}

describe('sesión real 5318166b — la caja pinta lo que se dicta', () => {
  it('ANTI-VACUIDAD: la fixture es la sesión real y conserva el defecto medido', () => {
    expect(String(ACTUAL.sessionId)).toBe(BASELINE.sessionId)
    expect(DATOS.eventos.length).toBeGreaterThanOrEqual(BASELINE.minEvents)
    expect(Number(ACTUAL.maxLocucionAbiertaMs)).toBeGreaterThanOrEqual(75000)
    expect(Number(ACTUAL.maxFinalsEnUnaLocucion)).toBeGreaterThanOrEqual(3)
    expect(Number(ACTUAL.descarteObsoleto)).toBeGreaterThanOrEqual(1)
    expect(Number(ACTUAL.srGap)).toBe(0)
    expect(Number(ACTUAL.vozMedidaEntreStopYCierre)).toBeGreaterThanOrEqual(31)
  })

  it('las métricas reales son EXACTAMENTE la línea base', () => {
    expect(ACTUAL).toEqual(BASELINE.metricas)
  })

  it('los casos viejos no reaparecen (límite 0) y su dueño existe', () => {
    for (const caso of BASELINE.casos) {
      const ocurrenciasActuales = ocurrencias(FUENTES, caso.id as CasoId)
      expect(ocurrenciasActuales, caso.id).toBeLessThanOrEqual(caso.limite)
      const archivo = caso.owner.slice(0, caso.owner.lastIndexOf(':'))
      expect(existsSync(join(RAIZ, archivo)), caso.owner).toBe(true)
    }
  })

  it('los dueños nuevos viven en su archivo', () => {
    expect(FUENTES.ingesta).toContain(
      'estado.ultimoResultadoMs = dependencias.reloj.ahora()',
    )
    expect(FUENTES.texto).not.toContain('function marcarVigente')
    expect(FUENTES.texto).toContain('sesion.mostrarPendiente(')
    expect(FUENTES.sesion).toContain('function mostrarPendiente')
    expect(FUENTES.sesion).toContain('fraseCanonicaPendiente')
    expect(FUENTES.producto).toContain('fraseCanonicaPendiente')
    expect(FUENTES.cola).toContain('ultimo:')
    expect(FUENTES.ingesta).toContain('pasoReintento')
    expect(FUENTES.ingesta).toContain('minNuevaVozMs')
  })
})

describe('sesión real 69a4fa97 — la wake no se corta antes de la revisión', () => {
  it('ANTI-VACUIDAD: la fixture es la sesión real y conserva el corte', () => {
    expect(String(ACTUAL_CORTE.sessionId)).toBe(BASELINE.sessionCorte)
    expect(DATOS_CORTE.eventos.length).toBeGreaterThanOrEqual(
      BASELINE.minEventsCorte,
    )
    expect(Number(ACTUAL_CORTE.finalSinWake)).toBe(1)
    expect(Number(ACTUAL_CORTE.wakeInterim)).toBe(1)
    expect(Number(ACTUAL_CORTE.revisionCompleta)).toBe(1)
    expect(Number(ACTUAL_CORTE.srGapAntesDeRevision)).toBe(1)
    expect(Number(ACTUAL_CORTE.filaCommiteada)).toBe(1)
  })

  it('las métricas reales del corte son EXACTAMENTE la línea base', () => {
    expect(ACTUAL_CORTE).toEqual(BASELINE.metricasCorte)
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  const INFRACTORES: Readonly<Record<CasoId, string>> = {
    'caja-sin-pendiente':
      "const viva = evento.abierta ? String(evento.fraseCanonica || '') : ''",
    'descarte-por-audio': 'tramo.fin > previa.tramo.fin',
    'medida-sin-paso': 'estado.muestrasEnUltimoIntento < minimo',
    'srGap-corta-wake': 'function marcarVigente',
  }

  for (const id of Object.keys(PATRONES) as CasoId[]) {
    it(`${id}: con el patrón viejo => 1; sin él => 0`, () => {
      const fuente = PATRONES[id].fuente
      const mutado = {
        ...FUENTES,
        [fuente]: `${FUENTES[fuente]}\n${INFRACTORES[id]}`,
      }
      expect(ocurrencias(mutado, id)).toBe(1)
      expect(ocurrencias(FUENTES, id)).toBe(0)
    })
  }
})
