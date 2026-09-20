/**
 * C19 — fetchProveedor: el cliente no llama proveedores externos directo.
 * Nace ROJO (3 módulos usan fetch directo: ocrService, healthMonitor, fluVisualStockSearch).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TARGETS = [
  'src/services/ocrService.ts',
  'src/core/autonomy/healthMonitor.ts',
  'src/voice/lib/fluVisualStockSearch.js',
]

describe('C19 fetchProveedor — sin fetch directo a proveedor', () => {
  it('los módulos de cliente no llaman fetch a proveedores externos', () => {
    const offenders: string[] = []
    for (const p of TARGETS) {
      const full = join(ROOT, p)
      if (!existsSync(full)) continue
      const src = readFileSync(full, 'utf8')
      src.split(/\r?\n/).forEach((line, i) => {
        if (/fetch\s*\(/.test(line)) offenders.push(`${p}:${i + 1}:${line.trim().slice(0, 110)}`)
      })
    }
    expect(
      offenders,
      `fetch directo a proveedor (N=${offenders.length}); usa el proxy:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
