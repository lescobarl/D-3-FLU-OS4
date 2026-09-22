/**
 * C48 — remoteResource: los hosts remotos usados por código viven en config.
 *
 * Antes (RED): `src/voice/lib/geminiDiagnostics.js` quemaba
 * `https://aistudio.google.com/apikey` y `src/voice/lib/visualConfig.js` quemaba
 * `https://api.openverse.org/v1/images/`. Ahora vienen de `sharedConfig`
 * (`REMOTE_RESOURCE_URLS`).
 *
 * Excluye de la cuenta: `src/core/config/**` y `src/voice/lib/fluConfig.js`
 * (son config), hosts locales (`localhost/127.0.0.1/::1`), el namespace XML
 * `www.w3.org` y las URLs que solo son texto de UI (placeholders, hints).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG_OWNED = (r: string) =>
  r.startsWith('src/core/config/') || r === 'src/voice/lib/fluConfig.js'
const HOST_EXCLUDE = new Set(['localhost', '127.0.0.1', '::1', 'www.w3.org'])
// URL en posición de CÓDIGO (propiedad/arg/asignación), no en texto JSX/atributo.
const CODE_POS = /(?:[:,(]\s*|=\s+)['"`]https?:\/\//
const URL_LITERAL = /['"`](https?:\/\/[^'"`\s]+)['"`]/

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Host remoto quemado en una línea, o null si no aplica. */
export function hardcodedRemoteHost(line: string): string | null {
  if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return null
  if (!CODE_POS.test(line)) return null
  const m = line.match(URL_LITERAL)
  if (!m) return null
  try {
    const host = new URL(m[1]).hostname
    return HOST_EXCLUDE.has(host) ? null : host
  } catch {
    return null
  }
}

/** Archivos fuera de config con algún host remoto quemado. */
function offenders(): string[] {
  const hits: string[] = []
  for (const f of walk(SRC)) {
    const r = relative(ROOT, f).replace(/\\/g, '/')
    if (CONFIG_OWNED(r)) continue
    const bad = readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .some((line) => hardcodedRemoteHost(line) !== null)
    if (bad) hits.push(r)
  }
  return hits.sort()
}

describe('C48 remoteResource — hosts remotos solo desde config', () => {
  it('ningún módulo fuera de config quema un host remoto', () => {
    const hits = offenders()
    expect(hits, `Hosts remotos quemados fuera de config (N=${hits.length}):\n  ${hits.join('\n  ')}`).toEqual([])
  })
})

describe('C48 remoteResource — el detector no es decorativo', () => {
  it('marca una URL remota en asignación', () => {
    expect(hardcodedRemoteHost("const X = 'https://api.example.com/v1'")).toBe('api.example.com')
  })
  it('marca una URL remota en propiedad', () => {
    expect(hardcodedRemoteHost("  apiBase: 'https://api.openverse.org/v1/images/',")).toBe('api.openverse.org')
  })
  it('ignora localhost y el namespace XML', () => {
    expect(hardcodedRemoteHost("const U = 'http://localhost'")).toBeNull()
    expect(hardcodedRemoteHost('const S = "http://www.w3.org/2000/svg"')).toBeNull()
  })
  it('ignora texto de UI en atributo JSX (placeholder="https://…")', () => {
    expect(hardcodedRemoteHost('placeholder="https://openrouter.ai/api/v1"')).toBeNull()
  })
  it('ignora comentarios', () => {
    expect(hardcodedRemoteHost("// const X = 'https://api.example.com'")).toBeNull()
  })
})
