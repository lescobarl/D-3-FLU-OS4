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
  it('MISMA locucion: manda la caja (aunque el final traiga mas texto)', () => {
    // Si el final es la misma revision y trae mas, la CAJA crece antes de cerrar; esta
    // funcion nunca devuelve otra candidata para la misma locucion.
    const cierre = fraseDeCierreDeLocucion({
      caja: 'quiero que me expliques con calma',
      lineaViva: '',
      finalConfirmado: 'quiero que me expliques con calma todos los pasos del sistema',
    })
    expect(cierre.texto).toBe('quiero que me expliques con calma')
    expect(cierre.motivo).toBe('caja')
  })

  it('OTRA locucion en la caja: cierra el FINAL de la que se cierra (la caja es de la siguiente)', () => {
    // Defecto medido 2026-10-23: el ASR ya habia emitido la locucion SIGUIENTE (la caja
    // mostraba su interino) y el final confirmado de la anterior se perdia. La caja no puede
    // cerrar una locucion que no es la suya.
    const cierre = fraseDeCierreDeLocucion({
      caja: 'Es algo extraño Porque muchos de ustedes creo',
      lineaViva: '',
      finalConfirmado: 'papás de pollo frito coreano picante y estas son creo que de caramelo',
    })
    expect(cierre.texto).toBe('papás de pollo frito coreano picante y estas son creo que de caramelo')
    expect(cierre.motivo).toBe('final')
  })

  it('la linea viva NUNCA compite con la caja', () => {
    const cierre = fraseDeCierreDeLocucion({ caja: 'la caja manda', lineaViva: 'una linea viva mas larga y distinta' })
    expect(cierre.texto).toBe('la caja manda')
  })
  it('MUTACIÓN: sin caja no hay segundo candidato que gane (entra el final)', () => {
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
