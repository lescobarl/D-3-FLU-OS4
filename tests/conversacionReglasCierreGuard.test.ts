// @vitest-environment node
/**
 * conversacionReglasCierreGuard — barrera MEDIDA de las reglas de cierre y voz.
 *
 * La sesión real 2026-11-11 (20:54-20:58) midió:
 *  - 23 locuciones cerradas, solo 3 con medida y 6 sin vector;
 *  - 4 locuciones cerradas con TEXTO y sin medida (quedaban en `Hablante X`);
 *  - 1 `XX` falso: 9,96 s de voz y vector 512, pero 7 palabras (< 8 del gate);
 *  - 15 descartes `turnoYaEscrito` por ASR tardío tras cerrar con `srGap`;
 *  - 10 locuciones fantasma abiertas/cerradas en el stop.
 *
 * El baseline congela esos números y deja en CERO los patrones que los
 * producían. El guard falla si cualquiera vuelve al código. Dueño declarado:
 * `cierre.ts` (medida), `identidad.ts` (decisión), `texto.ts` (pendientes),
 * `motor.ts` (stop) e `ingesta.ts` (ingesta ASR).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Baseline = {
  version: number
  source: string
  measuredBefore: Record<string, number>
  forbiddenNow: Record<string, number>
  allowedNow: Record<string, number>
  owners: Record<string, string>
}

const baseline: Baseline = JSON.parse(
  readFileSync('scripts/conversacion-reglas-baseline.json', 'utf8'),
)
const fuente = (archivo: string): string =>
  readFileSync(`src/voice/conversation/${archivo}`, 'utf8')
const contar = (texto: string, patron: RegExp): number => (texto.match(patron) ?? []).length

describe('conversación — reglas de cierre y voz (barrera congelada)', () => {
  it('los números de la sesión real están congelados', () => {
    expect(baseline.version).toBe(1)
    expect(baseline.measuredBefore.locucionesCerradas).toBe(23)
    expect(baseline.measuredBefore.locucionesCerradasSinMedida).toBe(4)
    expect(baseline.measuredBefore.falsasXX).toBe(1)
    expect(baseline.measuredBefore.turnoYaEscrito).toBe(15)
    expect(baseline.measuredBefore.fantasmasPostStop).toBe(10)
  })

  it('X no se commitea: la medida al cerrar usa el audio real y no hay gate de palabras', () => {
    // Una fila cerrada sin voz es XX (insuficiente), nunca X.
    expect(contar(fuente('cierre.ts'), /muestrasAbierta\.length === 0/g)).toBeLessThanOrEqual(
      baseline.forbiddenNow.medida_sin_muestras,
    )
    expect(fuente('cierre.ts')).toContain('tramos.muestras(locucion.locutionId')
    expect(fuente('cierre.ts')).toContain('insuficiente: true')
    // El texto corto no decide la voz: solo el audio/vector.
    expect(contar(fuente('identidad.ts'), /minNuevaVozPalabras/g)).toBeLessThanOrEqual(
      baseline.forbiddenNow.gate_palabras_identidad,
    )
  })

  it('el hueco del ASR no es una tercera puerta de cierre', () => {
    expect(contar(fuente('ingesta.ts'), /hueco\.fire/g)).toBeLessThanOrEqual(
      baseline.forbiddenNow.srGap_close,
    )
    // El hueco sigue midiéndose (observabilidad), pero no cierra.
    expect(fuente('ingesta.ts')).toContain('estado.ultimoResultadoMs = ')
    expect(fuente('frontera.ts')).toContain("causa: 'voz'")
    expect(fuente('frontera.ts')).toContain("textoAjeno ? 'frontera' : 'silencio'")
  })

  it('el stop congela la entrada y no inventa filas sin audio', () => {
    const motor = fuente('motor.ts')
    expect(motor).toContain('estado.cerrando = true')
    expect(motor).toContain('await ingesta.drenarResultadosAsr(true)')
    // El volcado normal del inicio no es una infracción: solo se permite uno.
    expect(contar(motor, /await ingesta\.drenarResultadosAsr\(\)/g)).toBeLessThanOrEqual(
      baseline.allowedNow.stop_drena_asr_sin_forzar,
    )
    expect(contar(fuente('texto.ts'), /tramoDePendiente\(siguiente, true\)/g)).toBeLessThanOrEqual(
      baseline.forbiddenNow.tramo_sintetico_stop,
    )
    expect(fuente('texto.ts')).toContain('estado.filas.has(tramoId)')
  })

  it('los dueños declarados siguen existiendo (el guard no es vacuo)', () => {
    expect(fuente('cierre.ts')).toContain('async function medirVozAlCerrar')
    expect(fuente('identidad.ts')).toContain('export function decidirIdentidad')
    expect(fuente('texto.ts')).toContain('async function finalizarPendientes')
    expect(fuente('motor.ts')).toContain('async function detener')
    expect(fuente('ingesta.ts')).toContain('async function ingestaAsr')
    for (const ruta of Object.values(baseline.owners)) {
      expect(ruta.startsWith('src/voice/conversation/')).toBe(true)
    }
  })

  it('FALSIFICACIÓN: si vuelve el gate de palabras o el cierre por srGap, el detector lo ve', () => {
    expect(contar('if (palabras < minNuevaVozPalabras) {}', /minNuevaVozPalabras/g)).toBe(1)
    expect(contar('if (hueco.fire) { cerrar() }', /hueco\.fire/g)).toBe(1)
    expect(contar('const x = 1', /hueco\.fire/g)).toBe(0)
  })
})
