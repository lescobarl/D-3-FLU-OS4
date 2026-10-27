// @vitest-environment node
/**
 * ETAPA 6 · PLAYBACK: misma tubería sobre la grabación, sin reglas propias. Solo es
 * COMPARABLE si el ASR es determinista; Chrome en vivo se declara NO COMPARABLE (no se
 * maquilla).
 *
 * RETIRADA la ETAPA 5 (corte 2026-10-26): la cadena de TRES candidatos (caja / línea
 * viva / final confirmado) vivía en `fraseDeCierreDeLocucion`
 * (src/voice/lib/conversationStream.js, isla de la tubería vieja sin consumidores en
 * src). En el módulo nuevo el texto único de la locución lo conserva revision.ts
 * (unirRevision: nunca pierde palabras), cubierto por tests/conversacionRevision.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { declararPlayback } from '../scripts/replay/report.mjs'

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
