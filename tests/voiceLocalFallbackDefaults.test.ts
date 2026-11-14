// @vitest-environment node
// ============================================================
// voiceLocalFallbackDefaults - UN solo dueño de los numeros del fallback
// ------------------------------------------------------------
// DEFECTO (revision 2026-10-21): `getLocalFallbackRuntimeConfig` y
// `getSilentDegradeConfig` repetian valores que YA estaban en FLU_CONFIG
// (20000, 3, 4000, 180, 300, 12000, 2, 600) y `stallMs + 1000`; el piso del ratio
// de modulacion era `media * 0.15` y la cadencia del degrade un `1000` literal.
//
// Aqui se fija:
//   1. Los respaldos viven UNA vez (`LOCAL_FALLBACK_DEFAULTS`, `VAD_DEFAULTS`) y
//      COINCIDEN con FLU_CONFIG (si uno cambia sin el otro, ROJO: no hay dos
//      fuentes que puedan derivar).
//   2. Los getters del fallback NO llevan numeros propios (solo 0/1 de comparacion).
//   3. `preRollMs: 0` se respeta (antes `Number(x) || 180` lo convertia en 180).
// ============================================================
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'
import { getLocalFallbackRuntimeConfig, getSilentDegradeConfig } from '../src/voice/lib/voiceLocalFallback.js'
import { LOCAL_FALLBACK_DEFAULTS, LOCAL_FINAL_DEFAULTS } from '../src/voice/lib/asr/asrDefaults.js'
import {
  VAD_DEFAULTS,
  getVadSegmentConfig,
  getVadSpeechLikeConfig,
} from '../src/voice/lib/asr/asrConfig.js'

const ROOT = process.cwd()

/** Quita comentarios de bloque y de linea. */
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Cuerpo de `export function nombre` hasta el siguiente `export`. */
function cuerpoDe(texto: string, nombre: string): string {
  const desde = texto.indexOf(`export function ${nombre}`)
  if (desde < 0) throw new Error(`no existe ${nombre}`)
  const hasta = texto.indexOf('\nexport ', desde + 1)
  return sinComentarios(texto.slice(desde, hasta < 0 ? undefined : hasta))
}

/** Numeros propios del cuerpo: se permiten SOLO 0 y 1 (comparaciones, Math.floor). */
export function numerosPropios(cuerpo: string): string[] {
  const encontrados = cuerpo.match(/(?<![\w.])\d+(?:\.\d+)?/g) || []
  return encontrados.filter((n) => n !== '0' && n !== '1')
}

describe('respaldos del fallback: una sola fuente con FLU_CONFIG', () => {
  const recognition = FLU_CONFIG.voiceIdentity.capture.recognition
  const asr = FLU_CONFIG.transcript.asr

  it('cada respaldo coincide EXACTAMENTE con su clave de config', () => {
    expect(LOCAL_FALLBACK_DEFAULTS.silentDegradeMs).toBe(recognition.silentDegradeMs)
    expect(LOCAL_FALLBACK_DEFAULTS.silentDegradeStallMarginMs).toBe(recognition.silentDegradeStallMarginMs)
    expect(LOCAL_FALLBACK_DEFAULTS.silentDegradeRebuilds).toBe(recognition.silentDegradeRebuilds)
    expect(LOCAL_FALLBACK_DEFAULTS.silentDegradeMinSpeechLikeMs).toBe(recognition.silentDegradeMinSpeechLikeMs)
    expect(LOCAL_FALLBACK_DEFAULTS.silentDegradeEvalMinMs).toBe(recognition.silentDegradeEvalMinMs)
    expect(LOCAL_FALLBACK_DEFAULTS.localRecoveryMs).toBe(recognition.localRecoveryMs)
    expect(LOCAL_FALLBACK_DEFAULTS.localRecoverySegments).toBe(recognition.localRecoverySegments)
    expect(LOCAL_FALLBACK_DEFAULTS.localRecoveryProbeMs).toBe(recognition.localRecoveryProbeMs)
    expect(LOCAL_FALLBACK_DEFAULTS.finalMinSpeechLikeMs).toBe(asr.finalMinSpeechLikeMs)
    expect(LOCAL_FALLBACK_DEFAULTS.partialMinSpeechLikeMs).toBe(asr.partialMinSpeechLikeMs)
  })

  it('los respaldos del VAD coinciden EXACTAMENTE con la config', () => {
    const vad = asr.vad
    expect(VAD_DEFAULTS.frameMs).toBe(vad.frameMs)
    expect(VAD_DEFAULTS.energyThreshold).toBe(vad.energyThreshold)
    expect(VAD_DEFAULTS.minSpeechMs).toBe(vad.minSpeechMs)
    expect(VAD_DEFAULTS.minSilenceMs).toBe(vad.minSilenceMs)
    expect(VAD_DEFAULTS.maxSegmentMs).toBe(vad.maxSegmentMs)
    expect(VAD_DEFAULTS.preRollMs).toBe(vad.preRollMs)
    expect(VAD_DEFAULTS.speechLikeZcrMin).toBe(vad.speechLikeZcrMin)
    expect(VAD_DEFAULTS.speechLikeZcrMax).toBe(vad.speechLikeZcrMax)
    expect(VAD_DEFAULTS.speechLikeModulationMin).toBe(vad.speechLikeModulationMin)
    expect(VAD_DEFAULTS.speechLikeModulationFloorRatio).toBe(vad.speechLikeModulationFloorRatio)
  })

  it('la config es lo que devuelven los getters (no un valor paralelo)', () => {
    const runtime = getLocalFallbackRuntimeConfig()
    expect(runtime.recoveryMs).toBe(recognition.localRecoveryMs)
    expect(runtime.recoverySegments).toBe(recognition.localRecoverySegments)
    expect(runtime.probeMs).toBe(recognition.localRecoveryProbeMs)
    expect(runtime.evalMinMs).toBe(recognition.silentDegradeEvalMinMs)
    expect(runtime.finalMinSpeechLikeMs).toBe(asr.finalMinSpeechLikeMs)
    expect(runtime.partialMinSpeechLikeMs).toBe(asr.partialMinSpeechLikeMs)

    const silent = getSilentDegradeConfig()
    expect(silent.rebuilds).toBe(recognition.silentDegradeRebuilds)
    expect(silent.minSpeechLikeMs).toBe(recognition.silentDegradeMinSpeechLikeMs)
    expect(silent.silentMs).toBeGreaterThan(Number(FLU_CONFIG.activeListen.restart.conversationStallMs))

    const speechLike = getVadSpeechLikeConfig()
    expect(speechLike.modulationFloorRatio).toBe(asr.vad.speechLikeModulationFloorRatio)
  })

  it('`preRollMs: 0` se RESPETA (no se convierte en el respaldo de 180)', () => {
    const cfg = getVadSegmentConfig({ ...FLU_CONFIG.transcript.asr.vad, preRollMs: 0 })
    expect(cfg.preRollMs).toBe(0)
    expect(getVadSegmentConfig({}).preRollMs).toBe(VAD_DEFAULTS.preRollMs)
  })

  it('los umbrales del RESPALDO POR TRAMO salen de su fuente única', () => {
    // El bloque `transcript.localFinal` toma sus valores de
    // `LOCAL_FINAL_DEFAULTS` (una sola declaración): si uno diverge, ROJO.
    const local = FLU_CONFIG.transcript.localFinal
    expect(local.enabled).toBe(LOCAL_FINAL_DEFAULTS.enabled)
    expect(local.modelId).toBe(LOCAL_FINAL_DEFAULTS.modelId)
    expect(local.timeoutMs).toBe(LOCAL_FINAL_DEFAULTS.timeoutMs)
    expect(local.minPalabras).toBe(LOCAL_FINAL_DEFAULTS.minPalabras)
    expect(local.minPalabrasPorSegundo).toBe(LOCAL_FINAL_DEFAULTS.minPalabrasPorSegundo)
    expect(local.minVozMs).toBe(LOCAL_FINAL_DEFAULTS.minVozMs)
    expect(local.minAudioSegundos).toBe(LOCAL_FINAL_DEFAULTS.minAudioSegundos)
    expect(local.maxPalabrasPorSegundo).toBe(LOCAL_FINAL_DEFAULTS.maxPalabrasPorSegundo)
    expect(local.minPalabrasUnicasRatio).toBe(LOCAL_FINAL_DEFAULTS.minPalabrasUnicasRatio)
    expect(local.sidecarProbeMs).toBe(LOCAL_FINAL_DEFAULTS.sidecarProbeMs)
    // El endpoint del sidecar vive en la config (la auditoría de hardcodes
    // exige que las URLs estén en un archivo de config) y NO en el cliente.
    expect(local.sidecarUrl).toMatch(/^https?:\/\/127\.0\.0\.1:\d+$/)
    // El getter del fallback (lector único) proyecta LOS MISMOS valores.
    const runtime = getLocalFallbackRuntimeConfig()
    expect(runtime.enabled).toBe(local.enabled)
    expect(runtime.timeoutMs).toBe(local.timeoutMs)
    expect(runtime.sidecarUrl).toBe(local.sidecarUrl)
    expect(runtime.sidecarProbeMs).toBe(local.sidecarProbeMs)
    expect(runtime.minPalabras).toBe(local.minPalabras)
    expect(runtime.minPalabrasPorSegundo).toBe(local.minPalabrasPorSegundo)
    expect(runtime.minVozMs).toBe(local.minVozMs)
    expect(runtime.minAudioSegundos).toBe(local.minAudioSegundos)
    expect(runtime.maxPalabrasPorSegundo).toBe(local.maxPalabrasPorSegundo)
    expect(runtime.minPalabrasUnicasRatio).toBe(local.minPalabrasUnicasRatio)
  })

  it('los umbrales medidos respetan la referencia b6d82bca', () => {
    // MEDIDO en la grabación de referencia: el máximo humano fue 5,31
    // palabras/s (ef5f8a23) y el tramo sano más lento 2,84 (7eb6b784); la
    // mujer rindió 0,34 y 0,24 palabras/s (c7013264 / 2ea145a2) — POR DEBAJO
    // del disparador — y su hueco midió vozMs=120 (3c37f4f6).
    expect(LOCAL_FINAL_DEFAULTS.maxPalabrasPorSegundo).toBeGreaterThan(5.31)
    expect(LOCAL_FINAL_DEFAULTS.minPalabrasPorSegundo).toBeGreaterThan(0.34)
    expect(LOCAL_FINAL_DEFAULTS.minPalabrasPorSegundo).toBeLessThan(2.84)
    expect(LOCAL_FINAL_DEFAULTS.minVozMs).toBe(350)
    // El mínimo de AUDIO sale de la ventana medida de §5-quinquies: 1,09 s
    // tardó 9,3–21,7 s (encoder fijo), así que 3 s es el piso del disparador.
    expect(LOCAL_FINAL_DEFAULTS.minAudioSegundos).toBe(3)
    // VoBo 2026-11-14 (opción c): 8 s por ventana de 12 s con faster-whisper
    // small en CPU (medido 3,3–5,4 s por ventana, §5-quinquies).
    expect(LOCAL_FINAL_DEFAULTS.timeoutMs).toBe(8000)
    // La sonda de salud no puede retener el cierre: 1,5 s y Chrome manda.
    expect(LOCAL_FINAL_DEFAULTS.sidecarProbeMs).toBe(1500)
    // ENCENDIDO tras la validación real del sidecar (§5-nonies): fila =
    // texto del sidecar, puerta aceptada y un commit por ventana.
    expect(LOCAL_FINAL_DEFAULTS.enabled).toBe(true)
    // El piso de VOZ es el MISMO que exige el embedder del producto.
    expect(LOCAL_FINAL_DEFAULTS.minVozMs).toBe(FLU_CONFIG.voiceIdentity.capture.conversationMinVoicedMs)
  })
})

describe('guard de fuente: los defaults viven UNA vez (asrDefaults.js)', () => {
  const defaults = sinComentarios(readFileSync(join(ROOT, 'src/voice/lib/asr/asrDefaults.js'), 'utf8'))
  const config = sinComentarios(readFileSync(join(ROOT, 'src/voice/lib/fluConfig.js'), 'utf8'))
  const asrCfg = sinComentarios(readFileSync(join(ROOT, 'src/voice/lib/asr/asrConfig.js'), 'utf8'))
  const fallback = sinComentarios(readFileSync(join(ROOT, 'src/voice/lib/voiceLocalFallback.js'), 'utf8'))

  it('los defaults se declaran SOLO en asrDefaults.js', () => {
    expect(defaults).toContain('export const VAD_DEFAULTS')
    expect(defaults).toContain('export const LOCAL_FALLBACK_DEFAULTS')
    expect(asrCfg, 'asrConfig no puede redefinir VAD_DEFAULTS').not.toContain('export const VAD_DEFAULTS')
    expect(fallback, 'voiceLocalFallback no puede redefinir los defaults').not.toContain(
      'export const LOCAL_FALLBACK_DEFAULTS',
    )
  })

  it('fluConfig toma los VALORES del modulo unico (no los recopia)', () => {
    expect(config).toContain("from './asr/asrDefaults.js'")
    expect(config).toContain('silentDegradeMs: LOCAL_FALLBACK_DEFAULTS.silentDegradeMs')
    expect(config).toContain('frameMs: VAD_DEFAULTS.frameMs')
    expect(config).toContain('preRollMs: VAD_DEFAULTS.preRollMs')
    expect(config).toContain('finalMinSpeechLikeMs: LOCAL_FALLBACK_DEFAULTS.finalMinSpeechLikeMs')
    expect(config).toContain('minAudioSegundos: LOCAL_FINAL_DEFAULTS.minAudioSegundos')
    expect(config).toContain('sidecarProbeMs: LOCAL_FINAL_DEFAULTS.sidecarProbeMs')
  })

  it('el detector no es decorativo: una copia literal en config se marca', () => {
    expect(config).not.toContain('silentDegradeMs: 12000')
    expect(config).not.toContain('preRollMs: 180')
    expect(config).not.toContain('finalMinSpeechLikeMs: 180')
  })
})

describe('guard de fuente: ningun getter repite numeros', () => {
  const fallbackSrc = readFileSync(join(ROOT, 'src/voice/lib/voiceLocalFallback.js'), 'utf8')
  const asrSrc = readFileSync(join(ROOT, 'src/voice/lib/asr/asrConfig.js'), 'utf8')

  it('los getters del fallback no llevan numeros propios', () => {
    expect(numerosPropios(cuerpoDe(fallbackSrc, 'getSilentDegradeConfig'))).toEqual([])
    expect(numerosPropios(cuerpoDe(fallbackSrc, 'getLocalFallbackRuntimeConfig'))).toEqual([])
  })

  it('los getters del VAD no llevan numeros propios', () => {
    expect(numerosPropios(cuerpoDe(asrSrc, 'getVadSegmentConfig'))).toEqual([])
    expect(numerosPropios(cuerpoDe(asrSrc, 'getVadSpeechLikeConfig'))).toEqual([])
  })

  it('el detector no es decorativo: marca un getter con literal paralelo', () => {
    const infractor = cuerpoDe(
      'export function getX(){ return { a: Math.max(1, 12000) } }\nexport const fin = 1\n',
      'getX',
    )
    expect(numerosPropios(infractor)).toEqual(['12000'])
    const correcto = cuerpoDe(
      'export function getY(){ return { a: DEFAULTS.x } }\nexport const fin = 1\n',
      'getY',
    )
    expect(numerosPropios(correcto)).toEqual([])
  })
})
