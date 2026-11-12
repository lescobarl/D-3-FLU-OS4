import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WATCHDOG_ACTIONS,
  resolveWatchdogStep,
} from '../src/voice/lib/asrWatchdog'
import { getConversationRestartConfig } from '../src/voice/lib/fluConfig'

const root = process.cwd()
const leer = (ruta: string) => readFileSync(join(root, ruta), 'utf8')
const baseline = JSON.parse(leer('scripts/voz-flujo-baseline.json'))

describe('flujo de voz: watchdog y cierre medidos', () => {
  const cfg = getConversationRestartConfig(true)

  it('con voz reciente NO reinicia Chrome por stall', () => {
    const step = resolveWatchdogStep({
      sinceMeaningful: Number(cfg.stallMs) + 1000,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: true,
      restartCfg: cfg,
    })
    expect(step.action).toBe(WATCHDOG_ACTIONS.NONE)
  })

  it('sin voz y sin resultado SÍ reinicia por stall', () => {
    const step = resolveWatchdogStep({
      sinceMeaningful: Number(cfg.stallMs) + 1000,
      sinceRebuild: Number(cfg.stallRebuildMinMs) + 1,
      recognitionActive: true,
      hasRecentSpeech: false,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'stall' })
  })

  it('onend muerto se recupera aunque haya voz reciente', () => {
    const step = resolveWatchdogStep({
      sinceEnd: Number(cfg.deadRecognitionMs) + 1,
      recognitionActive: false,
      restartPending: false,
      hasRecentSpeech: true,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'dead' })
  })

  it('watchdogTick alimenta la voz desde el dueño de voicedActivity', () => {
    const src = leer('src/voice/hooks/useLocalAsrFallback.js')
    expect(src).toMatch(/countVoicedSamplesInBlocks\(chunksRef\.current/)
    expect(src).toMatch(/getConversationMinVoicedSamples\(rate\)/)
    expect(src).toMatch(/hasRecentSpeech/)
  })

  it('la decisión stall exige ausencia de voz', () => {
    const src = leer('src/voice/lib/asrWatchdog.js')
    expect(src).toMatch(/!hasRecentSpeech[\s\S]{0,220}silentMicStallMs/)
    expect(src).toMatch(/!hasRecentSpeech[\s\S]{0,220}stallMs/)
  })

  it('el cierre del producto corta la entrada antes de encolar y no vuelca PCM', () => {
    const src = leer('src/voice/conversation/producto.ts')
    const desde = src.indexOf('cerrar: (motivo)')
    const cierre = src.slice(desde)
    expect(cierre).toMatch(
      /estadoMotor = 'cerrando'[\s\S]*descartarAudioPendiente\(\)[\s\S]*cierreEnCurso = encadenar/,
    )
    expect(cierre).not.toMatch(/encolarAudioPendiente/)
  })

  it('el hook espera el cierre del motor antes de declarar IDLE', () => {
    const src = leer('src/voice/hooks/useFluVoiceAssistant.js')
    const desde = src.indexOf('const cerrarMotorConversacion')
    const hasta = src.indexOf('useEffect(', desde)
    expect(src.slice(desde, hasta)).toMatch(/await motor\.cerrar\(motivo\)/)
    expect(src).toMatch(/await cerrarMotorConversacion\(closing \? 'user' : 'system'\)/)
    const stop = src.slice(
      src.indexOf('const stopListening'),
      src.indexOf('const toggleListening'),
    )
    expect(stop).toMatch(/\[REC\] stop: request/)
    expect(stop.indexOf('await cerrarMotorConversacion')).toBeLessThan(
      stop.indexOf('await finalizeRecognition'),
    )
  })

  it('el medidor real (voz:log) está enchufado a la línea base', () => {
    const src = leer('scripts/analiza-voz-log.mjs')
    expect(src).toMatch(/voz-flujo-baseline\.json/)
    expect(src).toMatch(/BARRERA FLUJO/)
    expect(src).toMatch(/aperturasTrasStop/)
    expect(src).toMatch(/process\.exitCode = 1/)
  })

  it('la línea base congela el antes y prohíbe los casos medidos', () => {
    expect(baseline.measuredBefore.stallConVozUltimos3s).toBeGreaterThan(0)
    expect(baseline.measuredBefore.locucionesCerradasTrasStop).toBeGreaterThan(0)
    expect(baseline.forbiddenNow.stallConVoz).toBe(0)
    expect(baseline.forbiddenNow.locucionesConTextoTrasStop).toBe(0)
    expect(baseline.forbiddenNow.cierreTrasStopMs).toBeLessThanOrEqual(2500)
    expect(baseline.measuredBefore.locucionesConTextoTrasStop).toBeGreaterThan(0)
  })
})
