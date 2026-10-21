// @vitest-environment node
// ============================================================
// voiceLocalFallbackPolicy - produccion vuelve a Chrome-only
// ------------------------------------------------------------
// El respaldo `rescate/wip-pre-s9` no tenia motor Whisper en produccion:
// escuchaba con Chrome y, si se colgaba, lo reconstruia. El fallback local se
// colo despues y sus alucinaciones con ruido/TV acabaron como filas reales.
//
// Aqui se fija la politica:
//   - `localFallbackEnabled` nace en false (produccion Chrome-only);
//   - el permiso es UNICO (`isLocalFallbackEnabled`) y el hook lo consulta
//     antes de precalentar, de degradar y al decidir el error;
//   - activarlo es explicito (lab dev / validacion controlada), no un default.
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { isLocalFallbackEnabled } from '../src/voice/lib/voiceLocalFallback.js'

const HOOK = readFileSync(join(process.cwd(), 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8')

describe('politica del fallback local: produccion Chrome-only', () => {
  it('el default de produccion es NO cargar Whisper', () => {
    expect(FLU_CONFIG.voiceIdentity.capture.recognition.localFallbackEnabled).toBe(false)
    expect(isLocalFallbackEnabled()).toBe(false)
  })

  it('activarlo es explicito y se lee de un solo dueno', () => {
    const cfg = FLU_CONFIG.voiceIdentity.capture.recognition
    const antes = cfg.localFallbackEnabled
    cfg.localFallbackEnabled = true
    expect(isLocalFallbackEnabled()).toBe(true)
    cfg.localFallbackEnabled = antes
  })

  it('el hook consulta la politica antes de precalentar y de degradar', () => {
    expect(HOOK).toContain('if (isLocalFallbackEnabled()) prewarmLocalRecognition()')
    expect(HOOK).toContain('degradeEnabled: isLocalFallbackEnabled()')
    expect(HOOK).toContain('isLocalFallbackEnabled() &&')
    expect(HOOK).toContain('shouldUseLocalFallback(errorCode)')
  })

  it('el detector no es decorativo: un hook sin la politica no la satisface', () => {
    const sinPolitica = 'prewarmLocalRecognition()\nconst x = shouldUseLocalFallback(code)'
    expect(sinPolitica.includes('isLocalFallbackEnabled()')).toBe(false)
  })
})
