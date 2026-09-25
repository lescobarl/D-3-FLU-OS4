// ============================================================
// voiceOfflineFallbackBehavior.test.ts — Comportamiento del
// fallback offline de voz (config-driven, sin hardcode).
// ------------------------------------------------------------
// Verifica la decisión de degradar a motor local (Whisper WASM):
//   - 'network'  → true  (sin red, Chrome SR no puede transcribir)
//   - 'no-speech'→ true  (Chrome SR no detectó voz)
//   - 'not-allowed' → false (permiso denegado: NO es fallback de red)
// ============================================================
import { describe, expect, it } from 'vitest'
import { shouldUseLocalFallback } from '../src/voice/lib/voiceLocalFallback.js'

describe('voz — shouldUseLocalFallback (decisión de degradar a motor local)', () => {
  it("degrada a motor local ante error 'network'", () => {
    expect(shouldUseLocalFallback('network')).toBe(true)
  })

  it("degrada a motor local ante error 'no-speech'", () => {
    expect(shouldUseLocalFallback('no-speech')).toBe(true)
  })

  it("NO degrada ante error 'not-allowed' (permiso denegado)", () => {
    expect(shouldUseLocalFallback('not-allowed')).toBe(false)
  })
})
