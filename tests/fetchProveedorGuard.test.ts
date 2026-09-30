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

/** Llamadas a fetch directo (mismo criterio del guard), alimentable. */
export function fetchCalls(src: string, file: string): string[] {
  const offenders: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (/fetch\s*\(/.test(line)) offenders.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return offenders
}

describe('C19 fetchProveedor — sin fetch directo a proveedor', () => {
  it('los módulos de cliente no llaman fetch a proveedores externos', () => {
    const offenders: string[] = []
    for (const p of TARGETS) {
      const full = join(ROOT, p)
      if (!existsSync(full)) continue
      offenders.push(...fetchCalls(readFileSync(full, 'utf8'), p))
    }
    expect(
      offenders,
      `fetch directo a proveedor (N=${offenders.length}); usa el proxy:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('C19 fetchProveedor - el detector no es decorativo', () => {
  it('marca el fetch directo y deja pasar el proxy', () => {
    expect(fetchCalls('const r = await fetch(url)', 'f.ts')).toHaveLength(1)
    expect(fetchCalls('const r = await fetchProveedor(url)', 'f.ts')).toEqual([])
  })
})