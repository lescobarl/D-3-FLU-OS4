/**
 * providerLiteralGuard — el proveedor de IA solo se declara en config.
 *
 * Regla #1 (NO HARDCODE): la identidad, el default y el orden de fallback de
 * los proveedores de IA viven en UN único módulo de configuración
 * (`src/core/config/`, hoy `sharedConfig.ts`). Ningún consumidor puede
 * re-declarar la lista ni quemar `'openrouter' | 'gemini' | 'deepseek' | 'local'`.
 *
 * Alcance (por qué no es un escaneo de cualquier string con esa palabra):
 *   - Módulos de SELECCIÓN de proveedor → prohibido CUALQUIER literal de
 *     proveedor (identidad, default, fallback). Deben derivar de config.
 *   - Resto de `src/` → prohibida la RE-DECLARACIÓN del catálogo, entendida
 *     como un ARRAY con ≥2 nombres de proveedor. Un nombre suelto, o una
 *     unión de otro dominio (p. ej. `MinuteLookupMode = 'local' | 'gemini'`),
 *     NO es identidad de proveedor y no se marca.
 *
 * Nace ROJO (17 literales en los módulos de selección) y pasa cuando todos
 * importan la fuente única. Patrón fs-scan (AGENTS.md §8.6 / §10.2).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** Directorio de configuración: única zona donde se declaran proveedores. */
const CONFIG_DIR = 'src/core/config/'

/** Nombres canónicos de proveedor cuya identidad no debe quemarse. */
const PROVIDER_NAMES = ['openrouter', 'gemini', 'deepseek', 'local'] as const
const PROVIDER_LITERAL_RE = /['"](openrouter|gemini|deepseek|local)['"]/g
const ARRAY_RE = /\[[^\]]*\]/gs

/**
 * Módulos que seleccionan/derivan el proveedor de IA. Cero literales de
 * proveedor permitidos: importan de `src/core/config/sharedConfig.ts`.
 */
const SELECTION_MODULES = new Set<string>([
  'src/services/aiServiceFactory.ts',
  'src/core/autonomy/decisionEngine.ts',
  'src/core/autonomy/autoRecovery.ts',
  'src/core/autonomy/backupSystem.ts',
  'src/core/branding/useEnhancedBranding.ts',
  'src/components/FluSettingsPanel.tsx',
])

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p)
  }
  return acc
}

/** Quita comentarios preservando el número de línea (bloques → saltos). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Nombres de proveedor aparecidos como literal en un texto. */
function providerLiteralsIn(text: string): string[] {
  return text.match(PROVIDER_LITERAL_RE) ?? []
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

describe('providerLiteralGuard — proveedores de IA solo desde config', () => {
  it('el escáner cubre los módulos de selección (no es un no-op)', () => {
    expect(SELECTION_MODULES.size).toBeGreaterThanOrEqual(6)
  })

  it('no hay literales de proveedor fuera del módulo de configuración', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const relPath = relative(ROOT, file).replace(/\\/g, '/')
      if (relPath.startsWith(CONFIG_DIR)) continue

      const raw = readFileSync(file, 'utf8')
      const stripped = stripComments(raw)
      const lines = stripped.split(/\r?\n/)

      if (SELECTION_MODULES.has(relPath)) {
        lines.forEach((line, i) => {
          if (providerLiteralsIn(line).length > 0) {
            offenders.push(`${relPath}:${i + 1}:${line.trim().slice(0, 120)}`)
          }
        })
        continue
      }

      let match: RegExpExecArray | null
      ARRAY_RE.lastIndex = 0
      while ((match = ARRAY_RE.exec(stripped)) !== null) {
        if (providerLiteralsIn(match[0]).length >= 2) {
          const line = lineAt(stripped, match.index)
          offenders.push(`${relPath}:${line}:${(lines[line - 1] ?? '').trim().slice(0, 120)}`)
        }
      }
    }
    const report = offenders.join('\n  ')
    expect(
      offenders,
      `Literales de proveedor fuera de la config (N=${offenders.length}); usa ` +
        `AI_PROVIDERS / AI_PROVIDER_IDS / DEFAULT_AI_PROVIDER de sharedConfig.ts:\n  ${report}`,
    ).toEqual([])
  })
})
