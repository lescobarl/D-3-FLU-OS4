/**
 * P5.2/P5.3/P5.4 - configSingleSource: los parametros compartidos viven en la config.
 *
 * Un valor repetido como literal en la logica es un valor que se puede desincronizar:
 * cambiar el sample rate en la config no cambiaba los 23 defaults quemados en los
 * modulos de voz, y los presupuestos de tokens estaban repartidos por aiServiceBase y
 * deepseek sin nombre ni origen. Este guard fija el origen unico.
 *
 * Reglas (todas sobre el MECANISMO, no sobre prosa):
 *   1. `48000` no puede aparecer en src/ fuera de src/voice/lib/audioConstants.js.
 *   2. fluConfig.audio.sampleRate debe derivar de DEFAULT_SAMPLE_RATE.
 *   3. aiServiceBase.ts no puede llevar `maxTokens: <numero>` (usa TEXT_TOKEN_BUDGETS).
 *   4. deepseek.ts no puede llevar `temperature || 0.7` ni `max_tokens: <numero>`
 *      (usa TEXT_TEMPERATURE_DEFAULT / TEXT_TOKEN_LIMITS).
 *
 * El segundo describe comprueba el propio detector: un guard que nunca puede fallar no
 * es una barrera (AGENTS.md 0.12).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
/** Origen unico declarado del sample rate. */
export const SAMPLE_RATE_OWNER = 'src/voice/lib/audioConstants.js'
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/')
/** Archivos de src/ (excepto el dueno) que contienen el literal del sample rate. */
export function sampleRateOffenders(files: string[], read: (f: string) => string): string[] {
  return files.filter((f) => rel(f) !== SAMPLE_RATE_OWNER && /48000/.test(read(f))).map(rel)
}
/** Numeros sueltos de las reglas 3 y 4 en un fuente dado. */
export function literalOffenders(src: string, fileName: string): string[] {
  const out: string[] = []
  if (/aiServiceBase\.ts$/.test(fileName)) {
    for (const m of src.matchAll(/maxTokens:\s*\d+/g)) out.push(`${fileName}: ${m[0]}`)
  }
  if (/services\/deepseek\.ts$/.test(fileName)) {
    for (const m of src.matchAll(/temperature\s*\|\|\s*0\.7|max_tokens:\s*\d+/g)) out.push(`${fileName}: ${m[0]}`)
  }
  return out
}
describe('P5.2 configSingleSource - el sample rate tiene un solo origen', () => {
  it('ningun modulo de src repite el literal 48000', () => {
    const files = walk(SRC)
    expect(files.map(rel)).toContain(SAMPLE_RATE_OWNER)
    const offenders = sampleRateOffenders(files, (f) => readFileSync(f, 'utf8'))
    expect(offenders, `literales 48000 fuera de ${SAMPLE_RATE_OWNER}:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
  it('fluConfig deriva audio.sampleRate del origen unico', () => {
    const cfg = readFileSync(join(ROOT, 'src/voice/lib/fluConfig.js'), 'utf8')
    expect(cfg).toContain("import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'")
    expect(cfg).toContain('sampleRate: DEFAULT_SAMPLE_RATE,')
  })
})
describe('P5.3/P5.4 configSingleSource - presupuestos de texto con nombre', () => {
  it('ni aiServiceBase ni deepseek llevan los limites quemados', () => {
    const offenders = [
      ...literalOffenders(readFileSync(join(ROOT, 'src/core/ai/aiServiceBase.ts'), 'utf8'), 'aiServiceBase.ts'),
      ...literalOffenders(readFileSync(join(ROOT, 'src/services/deepseek.ts'), 'utf8'), 'services/deepseek.ts'),
    ]
    expect(offenders, `limites quemados en la logica:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
  it('el catalogo declara el origen unico', () => {
    const cfg = readFileSync(join(ROOT, 'src/core/config/appConfig.ts'), 'utf8')
    for (const k of ['TEXT_TOKEN_BUDGETS', 'TEXT_TEMPERATURE_DEFAULT', 'TEXT_TOKEN_LIMITS']) {
      expect(cfg, `falta ${k} en appConfig`).toContain(k)
    }
  })
})
describe('P5 configSingleSource - el detector no es decorativo', () => {
  it('marca el literal 48000 fuera del dueno', () => {
    expect(sampleRateOffenders([join(SRC, 'a.js'), join(SRC, 'b.js')], (f) => (f.endsWith('a.js') ? 'x = 48000' : 'y = 1'))).toEqual([
      'src/a.js',
    ])
  })
  it('no marca el archivo dueno', () => {
    const own = join(ROOT, SAMPLE_RATE_OWNER)
    expect(sampleRateOffenders([own], () => 'export const DEFAULT_SAMPLE_RATE = 48000')).toEqual([])
  })
  it('marca un maxTokens numerico en aiServiceBase', () => {
    expect(literalOffenders('completeText({ maxTokens: 1800 })', 'src/core/ai/aiServiceBase.ts')).toHaveLength(1)
  })
  it('marca temperature||0.7 y max_tokens numerico en deepseek', () => {
    expect(literalOffenders('temperature: temperature || 0.7, max_tokens: 500,', 'src/services/deepseek.ts')).toHaveLength(2)
  })
  it('no marca el uso de las constantes', () => {
    expect(literalOffenders('maxTokens: TEXT_TOKEN_BUDGETS.single', 'src/core/ai/aiServiceBase.ts')).toEqual([])
    expect(literalOffenders('temperature: temperature || TEXT_TEMPERATURE_DEFAULT,', 'src/services/deepseek.ts')).toEqual([])
  })
})/** Fuente unica declarada de los locales de voz. */
export const LOCALE_OWNER = 'src/core/config/localeConfig.ts'
/** Fuentes unicas declaradas de los presupuestos de tokens. */
export const TOKEN_BUDGET_OWNERS = ['src/voice/lib/fluConfig.js', 'src/core/config/appConfig.ts']
/** Literales BCP-47 (xx-YY) en un fuente dado. */
export function localeLiteralOffenders(src: string, fileName: string): string[] {
  if (fileName === LOCALE_OWNER) return []
  return [...src.matchAll(/'[a-z]{2}-[A-Z]{2}'/g)].map((m) => `${fileName}: ${m[0]}`)
}
/** Ids de proveedor escritos como literal en una comparacion o asignacion. */
export function providerLiteralOffenders(src: string, fileName: string): string[] {
  const re = /(?:===|!==|==|!=)\s*'(openrouter|gemini|local)'|(?:provider|providerId|providerKey)\s*:\s*'(openrouter|gemini|local)'/g
  return [...src.matchAll(re)].map((m) => `${fileName}: ${m[0]}`)
}
/** Presupuesto de tokens quemado fuera del catalogo. */
export function tokenBudgetOffenders(src: string, fileName: string): string[] {
  if (TOKEN_BUDGET_OWNERS.includes(fileName)) return []
  const re = /(?:maxTokens|max_tokens|maxOutputTokens|maxOutput)\s*[:=]\s*\d+/g
  return [...src.matchAll(re)].map((m) => `${fileName}: ${m[0]}`)
}
describe('P5.5/P5.6/P5.7 configSingleSource - locales, proveedores y presupuestos', () => {
  it('ningun modulo de src declara un locale BCP-47 fuera del catalogo hoja', () => {
    const offenders = walk(SRC).flatMap((f) => localeLiteralOffenders(readFileSync(f, 'utf8'), rel(f)))
    expect(offenders, `locales fuera de ${LOCALE_OWNER}:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
  it('ningun modulo compara o asigna un id de proveedor con literal', () => {
    const offenders = walk(SRC).flatMap((f) => providerLiteralOffenders(readFileSync(f, 'utf8'), rel(f)))
    expect(offenders, `ids de proveedor literales (usa AI_PROVIDER_IDS):\n  ${offenders.join('\n  ')}`).toEqual([])
  })
  it('ningun modulo fuera del catalogo quema un presupuesto de tokens', () => {
    const offenders = walk(SRC).flatMap((f) => tokenBudgetOffenders(readFileSync(f, 'utf8'), rel(f)))
    expect(offenders, `presupuestos quemados:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
  it('el catalogo de proveedores sigue siendo el origen unico', () => {
    const cfg = readFileSync(join(ROOT, 'src/core/config/sharedConfig.ts'), 'utf8')
    expect(cfg).toContain('AI_PROVIDER_IDS')
    expect(readFileSync(join(ROOT, LOCALE_OWNER), 'utf8')).toContain('SCRIPT_SPEECH_LOCALES')
  })
})
describe('P5.5/P5.6/P5.7 configSingleSource - el detector no es decorativo', () => {
  it('marca un locale BCP-47 fuera del dueno y no marca al dueno', () => {
    expect(localeLiteralOffenders("return 'ja-JP'", 'src/voice/lib/fluSpeech.js')).toHaveLength(1)
    expect(localeLiteralOffenders("return 'ja-JP'", LOCALE_OWNER)).toEqual([])
  })
  it('marca un id de proveedor literal', () => {
    expect(providerLiteralOffenders("if (p === 'openrouter') return 1", 'src/a.ts')).toHaveLength(1)
    expect(providerLiteralOffenders("provider: 'local'", 'src/a.ts')).toHaveLength(1)
  })
  it('no marca el uso de las constantes de proveedor', () => {
    expect(providerLiteralOffenders('if (p === AI_PROVIDER_IDS.OPENROUTER) return 1', 'src/a.ts')).toEqual([])
  })
  it('marca un presupuesto de tokens quemado y no marca al catalogo', () => {
    expect(tokenBudgetOffenders('maxTokens = 2048,', 'src/voice/lib/gemini.js')).toHaveLength(1)
    expect(tokenBudgetOffenders('maxOutputTokens: 2048,', 'src/voice/lib/fluConfig.js')).toEqual([])
  })
})