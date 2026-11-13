// @vitest-environment node
// BARRERA: watchdog-habla
/**
 * BARRERA: watchdog-habla — mientras FLU HABLA, el watchdog no toca el motor.
 *
 * DEFECTO MEDIDO EN VIVO (sesión 753c2361, 2026-11-12 18:59):
 *   - 18:59:42.129 SPEAKING: FLU empieza un TTS de 2,8 s. El `abort()` del
 *     habla cierra el reconocedor (onend) y `recognitionActive` queda false.
 *   - 18:59:43.096 y 18:59:43.847: dos ticks con `sinceEnd` 968 y 1719 ms
 *     (≥ `conversationDeadRecognitionMs` 900) disparan `[WD] rebuild
 *     kind=dead` EN MEDIO del TTS.
 *   - El reconocedor reconstruido escucha la COLA del TTS: row 04954dba
 *     «magistrado Luis», 15 caracteres, «Hablante XX».
 *
 * DOS DUEÑOS DEL MICRÓFONO: la pausa de voz (`voiceStallPolicy`) suspende y
 * reanuda el reconocedor durante el habla; el watchdog `dead` lo reconstruía en
 * paralelo. El hecho «FLU habla» ya tiene dueño (`isFluSpeaking`) y ahora es
 * ENTRADA del único paso del watchdog: hablando ⇒ `none`.
 *
 * FALSIFICACIÓN: sin el gate, los mismos valores del tick real devuelven
 * `rebuild/dead` (abajo, primer caso) — el defecto medido.
 */
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

/** Valores REALES del tick de la sesión 753c2361 (no sintéticos). */
const TICK_1_SINCE_END_MS = 968 // 18:59:43.096 − onend 18:59:42.128
const TICK_2_SINCE_END_MS = 1719 // 18:59:43.847 − onend

describe('BARRERA watchdog-habla — el habla de FLU frena el watchdog', () => {
  const cfg = getConversationRestartConfig(true)

  it('falsificación: sin el gate, el tick real del TTS reconstruye el reconocedor', () => {
    // El defecto medido, tal cual: dos rebuild `dead` dentro del TTS.
    for (const sinceEnd of [TICK_1_SINCE_END_MS, TICK_2_SINCE_END_MS]) {
      const step = resolveWatchdogStep({
        sinceEnd,
        recognitionActive: false,
        restartPending: false,
        hasRecentSpeech: false,
        restartCfg: cfg,
      })
      expect(step).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'dead' })
    }
  })

  it('con FLU hablando, los MISMOS ticks reales no tocan el motor', () => {
    for (const sinceEnd of [TICK_1_SINCE_END_MS, TICK_2_SINCE_END_MS]) {
      const step = resolveWatchdogStep({
        sinceEnd,
        recognitionActive: false,
        restartPending: false,
        hasRecentSpeech: false,
        fluSpeaking: true,
        restartCfg: cfg,
      })
      expect(step).toEqual({ action: WATCHDOG_ACTIONS.NONE })
    }
  })

  it('al terminar el habla la recuperación NO se queda hambrienta', () => {
    const step = resolveWatchdogStep({
      sinceEnd: Number(cfg.deadRecognitionMs) + 1,
      recognitionActive: false,
      restartPending: false,
      fluSpeaking: false,
      restartCfg: cfg,
    })
    expect(step).toEqual({ action: WATCHDOG_ACTIONS.REBUILD, kind: 'dead' })
  })

  it('el gate es del paso único y el hecho lo aporta su dueño isFluSpeaking', () => {
    const paso = leer('src/voice/lib/asrWatchdog.js')
    // El freno va ANTES de todas las ramas: ni rebuild ni recuperación.
    const freno = paso.indexOf('if (fluSpeaking) return')
    expect(freno).toBeGreaterThan(-1)
    expect(freno).toBeLessThan(paso.indexOf('if (probeExpired'))
    expect(paso).toMatch(/fluSpeaking = false/)

    const consumidor = leer('src/voice/hooks/useLocalAsrFallback.js')
    expect(consumidor).toMatch(/import \{ isFluSpeaking \} from '\.\.\/lib\/fluSpeech\.js'/)
    expect(consumidor).toMatch(/fluSpeaking: isFluSpeaking\(\)/)
  })
})
