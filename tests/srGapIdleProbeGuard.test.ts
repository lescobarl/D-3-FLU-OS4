/**
 * srGapIdleProbeGuard — la sonda `srGap` no se emite sin LOCUCION VIVA.
 *
 * DEFECTO MEDIDO (debug.log del dueno, 2026-10-08 17:48:56-17:50:01): en reposo
 * —sin nadie hablando y sin locucion abierta— el watchdog llamaba a
 * `resolveSrGapTrigger` en cada tick; como `sinceLastResultMs` y
 * `sinceLastCommitMs` solo crecen en reposo, la sonda `sr-live-turn-stale`
 * salia una vez cada 5 s durante minutos, y CERO eventos `commit`/`row`. El
 * freno de 5 s (a58f209) acota la frecuencia pero NO la condicion: un log que
 * inunda en reposo es un defecto (§10.7). El disparador ya no sondea si no hay
 * locucion viva que cerrar.
 *
 * INVARIANTE: `resolveSrGapTrigger` con `hasOpenLine=false` NO dispara y NO
 * sondea (reason `sr-no-open-line`); con locucion viva se comporta igual que antes.
 *
 * Nace ROJO: hoy con `hasOpenLine=false` devuelve `fire:true`.
 */
import { describe, it, expect } from 'vitest'
import { resolveSrGapTrigger } from '../src/voice/lib/fluTranscriptPause.js'

describe('srGap no sondea en reposo', () => {
  it('sin locucion viva no dispara (Hoy: fire=true)', () => {
    const r = resolveSrGapTrigger({
      sinceLastResultMs: 60000,
      sinceLastCommitMs: 60000,
      hasOpenLine: false,
    })
    expect(r.fire).toBe(false)
    expect(r.reason).toBe('sr-no-open-line')
  })

  it('con locucion viva y silencio, dispara igual que antes', () => {
    const r = resolveSrGapTrigger({
      sinceLastResultMs: 60000,
      sinceLastCommitMs: 60000,
      hasOpenLine: true,
    })
    expect(r.fire).toBe(true)
    expect(r.reason).toBe('sr-silence')
  })

  it('con locucion viva y turno viva estancada, dispara con la razon de antes', () => {
    const r = resolveSrGapTrigger({
      sinceLastResultMs: 0,
      sinceLastCommitMs: 60000,
      hasOpenLine: true,
    })
    expect(r.fire).toBe(true)
    expect(r.reason).toBe('sr-live-turn-stale')
  })
})

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
  it('el MISMO gap cambia de veredicto solo por la locucion viva', () => {
    const sin = resolveSrGapTrigger({ sinceLastResultMs: 60000, sinceLastCommitMs: 0, hasOpenLine: false })
    const con = resolveSrGapTrigger({ sinceLastResultMs: 60000, sinceLastCommitMs: 0, hasOpenLine: true })
    expect(sin.fire).toBe(false)
    expect(con.fire).toBe(true)
  })
})
