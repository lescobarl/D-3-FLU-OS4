// ============================================================
// voiceOfflineFallback.test.ts — Guard: fallback offline de voz
// ------------------------------------------------------------
// Invariantes (nace ROJO):
//   A) el motor local (Whisper WASM) está CONECTADO al hook principal de voz
//      (no solo al lab dev src/dev/asrLab).
//   B) existe una ruta que degrada a motor local ante error 'network'/'no-speech'.
// ============================================================
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

describe('voz — fallback offline (Whisper local) ante error de red', () => {
  it('A: el motor local se conecta al hook principal de voz (no solo dev)', () => {
    const hook = readFileSync(join(ROOT, 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8')
    expect(hook).toMatch(/voiceLocalFallback|whisperRecognitionEngine|whisperWasmTranscriber|createWhisperRecognitionEngine/)
  })

  it('B: hay degradación a motor local ante error network/no-speech', () => {
    const re = /(shouldUseLocalFallback|fallbackToLocal|localEngineOnError|resolveLocalFallback|degradeToLocal)/
    let found = false
    for (const f of walk(join(ROOT, 'src/voice'))) {
      if (re.test(readFileSync(f, 'utf8'))) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })
})
