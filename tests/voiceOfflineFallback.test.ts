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

/** Predicados del guard, expuestos para poder FALSIFICARLOS con entradas sinteticas. */
export const LOCAL_ENGINE_RE = /voiceLocalFallback|whisperRecognitionEngine|whisperWasmTranscriber|createWhisperRecognitionEngine/
export const FALLBACK_ROUTE_RE = /(shouldUseLocalFallback|fallbackToLocal|localEngineOnError|resolveLocalFallback|degradeToLocal)/

/** true si el hook principal de voz conecta el motor local (no solo el lab dev). */
export function hookConnectsLocalEngine(hook: string): boolean {
  return LOCAL_ENGINE_RE.test(hook)
}

/** true si alguna fuente declara la ruta de degradacion al motor local. */
export function hasLocalFallbackRoute(sources: string[]): boolean {
  return sources.some((s) => FALLBACK_ROUTE_RE.test(s))
}

describe('voz — fallback offline (Whisper local) ante error de red', () => {
  it('A: el motor local se conecta al hook principal de voz (no solo dev)', () => {
    const hook = readFileSync(join(ROOT, 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8')
    expect(hookConnectsLocalEngine(hook)).toBe(true)
  })

  it('B: hay degradación a motor local ante error network/no-speech', () => {
    const sources = walk(join(ROOT, 'src/voice')).map((f) => readFileSync(f, 'utf8'))
    expect(hasLocalFallbackRoute(sources)).toBe(true)
  })
})

// P2.4 — prueba de detector: alimentadas las entradas sinteticas, la marca.
describe('voz offline — el detector no es decorativo', () => {
  it('marca la conexion y la ruta sinteticas, y no marca lo que no las tiene', () => {
    expect(hookConnectsLocalEngine('startContinuousVoice({ engine: createWhisperRecognitionEngine() })')).toBe(true)
    expect(hookConnectsLocalEngine('startContinuousVoice({ engine: webSpeechEngine })')).toBe(false)
    expect(hasLocalFallbackRoute(['const x = degradeToLocal()'])).toBe(true)
    expect(hasLocalFallbackRoute(['const x = webSpeechOnly()'])).toBe(false)
  })
})
