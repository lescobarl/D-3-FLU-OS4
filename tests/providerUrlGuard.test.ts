/**
 * C41 providerUrlLiterals — las URLs de proveedor viven SOLO en la config canónica.
 *
 * Antes (RED): `src/voice/lib/fluConfig.js` re-hardcodeaba el endpoint de
 * OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) pese a importar
 * ya `OPENROUTER_DEFAULTS` de `sharedConfig` (la ruta doble motor/proxy).
 * Ahora se deriva de `OPENROUTER_DEFAULTS.API_URL`.
 *
 * Canónico: `src/core/config/sharedConfig.ts` (OpenRouter/Pollinations) y
 * `src/core/config/appConfig.ts` (Gemini/DeepSeek legacy). Los `.tsx` de UI
 * (placeholders) quedan fuera: los cubre `tests/remoteResourceGuard.test.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPENROUTER_DEFAULTS } from '../src/core/config/sharedConfig'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const PROVIDER_URL =
  /(openrouter\.ai|image\.pollinations\.ai|api\.deepseek\.com|generativelanguage\.googleapis\.com)/
const CANONICAL = new Set([
  'src/core/config/sharedConfig.ts',
  'src/core/config/appConfig.ts',
])
const isCommentLine = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line)

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|js)$/.test(e)) acc.push(p)
  }
  return acc
}

/** `archivo:línea` con un literal de URL de proveedor fuera de la config canónica. */
export function providerUrlLiterals(files: string[] = walk(SRC)): string[] {
  const hits: string[] = []
  for (const f of files) {
    const rel = relative(ROOT, f).split(sep).join('/')
    if (CANONICAL.has(rel)) continue
    const lines = readFileSync(f, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return
      if (PROVIDER_URL.test(line)) hits.push(`${rel}:${i + 1}`)
    })
  }
  return hits
}

describe('C41 providerUrlLiterals — URLs de proveedor solo en config', () => {
  it('ningún archivo fuera de la config canónica hardcodea una URL de proveedor', () => {
    const hits = providerUrlLiterals()
    expect(
      hits,
      `Literales de proveedor fuera de config (N=${hits.length}): ${hits.join(', ')}`,
    ).toEqual([])
  })
})

describe('C41 providerUrlLiterals — contrato de comportamiento', () => {
  it('el endpoint de OpenRouter se compone desde la config canónica', () => {
    expect(`${OPENROUTER_DEFAULTS.API_URL}/chat/completions`).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    )
  })
})
