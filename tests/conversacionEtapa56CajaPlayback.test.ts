// @vitest-environment node
/**
 * ETAPAS 5 y 6.
 *
 * 5 · CAJA: la caja ES el texto de la locución abierta. Se borró la cadena de TRES candidatos
 *     (caja / línea viva / final confirmado): la fila ya no elige, sigue a la caja. Los
 *     invariantes de caja (pérdidas, acortes, congelación, fila más corta que la caja) se
 *     midieron en 0 sobre la grabación real (replay events, 2026-10-23).
 *
 * 6 · PLAYBACK: misma tubería sobre la grabación, sin reglas propias. Solo es COMPARABLE si
 *     el ASR es determinista; Chrome en vivo se declara NO COMPARABLE (no se maquilla).
 */
import { describe, expect, it } from 'vitest'
import { fraseDeCierreDeLocucion } from '../src/voice/lib/conversationStream.js'
import { declararPlayback } from '../scripts/replay/report.mjs'

describe('ETAPA 5 · la caja es el texto de la locución (sin cadena de candidatos)', () => {
  it('con caja: manda la caja, aunque el final y la viva traigan más texto', () => {
    const cierre = fraseDeCierreDeLocucion({
      caja: 'vamos a preparar la receta',
      lineaViva: 'pon la mesa y trae los platos y los cubiertos para la cena',
      finalConfirmado: 'quiero que me expliques con calma todos los pasos del sistema',
    })
    expect(cierre.texto).toBe('vamos a preparar la receta')
    expect(cierre.motivo).toBe('caja')
  })

  it('MUTACIÓN: antes la fila saltaba al final confirmado; ahora NO (no hay segundo candidato)', () => {
    const cierre = fraseDeCierreDeLocucion({
      caja: 'quiero que me expliques con calma',
      lineaViva: '',
      finalConfirmado: 'quiero que me expliques con calma todos los pasos',
    })
    expect(cierre.texto, 'la caja no cede ante el final').toBe('quiero que me expliques con calma')
  })

  it('sin caja (cierre sin preview): entra el final confirmado', () => {
    const cierre = fraseDeCierreDeLocucion({ caja: '', lineaViva: 'texto vivo', finalConfirmado: 'texto confirmado' })
    expect(cierre.texto).toBe('texto confirmado')
    expect(cierre.motivo).toBe('final')
  })

  it('sin caja ni final: la línea viva es el último rescate', () => {
    const cierre = fraseDeCierreDeLocucion({ caja: '', lineaViva: 'texto vivo', finalConfirmado: '' })
    expect(cierre.texto).toBe('texto vivo')
    expect(cierre.motivo).toBe('linea-viva')
  })

  it('sin nada: texto vacío (no se inventa una fila)', () => {
    expect(fraseDeCierreDeLocucion({}).texto).toBe('')
  })
})

describe('ETAPA 6 · playback: misma tubería, comparabilidad declarada', () => {
  it('Chrome en vivo -> NO COMPARABLE (el ASR no se reproduce)', () => {
    const playback = declararPlayback([{ event: 'chrome-raw', data: { kind: 'final' } }])
    expect(playback.asr).toBe('chrome-web-speech')
    expect(playback.determinista).toBe(false)
    expect(playback.comparable).toBe(false)
    expect(playback.motivo).toMatch(/no se reproducen/)
  })

  it('stub determinista -> COMPARABLE (misma entrada, misma salida)', () => {
    const playback = declararPlayback([{ event: 'stub-asr', data: { kind: 'final' } }])
    expect(playback.asr).toBe('stub')
    expect(playback.comparable).toBe(true)
  })

  it('MUTACIÓN: una grabación sin motor declarado NO se vende como comparable', () => {
    const playback = declararPlayback([])
    expect(playback.asr).toBe('desconocido')
    expect(playback.comparable).toBe(false)
  })
})
