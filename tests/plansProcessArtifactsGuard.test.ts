/**
 * C52 — plans/: sin artefactos de proceso versionados.
 *
 * `plans/` acumulaba 76 ficheros versionados, de los que la mayoría son artefactos de
 * una sesión concreta: 43 en `plans/contratos/**` (el sistema de contratos por tarea que
 * hoy vive en `.task/contract.json` + `plans/ledger.json`) y 7 informes
 * `estado-sesion-*` / `estado-entrega-*`. Nada los lee (verificado con git grep: la única
 * referencia viva es `plans/ledger.json` y `plans/unificacion-duplicados.md`), y cada uno
 * es una copia congelada de un estado que el ledger ya cuenta mejor.
 *
 * Se quedan los documentos de diseño (`plan-*.md`, `propuesta-*.md`,
 * `catalogo-comandos-voz.md`, ...) y, por supuesto, `plans/ledger.json`, que es la fuente
 * de verdad de pendientes/cierres. El historial completo sigue en git: no se pierde
 * información, se deja de arrastrarla en el árbol de trabajo.
 *
 * El último describe prueba que el detector no es decorativo.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PLANS = join(process.cwd(), 'plans')

/** Un artefacto de proceso es un contrato viejo o un informe de sesión/entrega. */
export function isProcessArtifact(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/')
  if (/(^|\/)contratos\//.test(p)) return true
  return /(^|\/)(estado-sesion|estado-entrega)-[^/]*\.md$/.test(p)
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

function processArtifacts(): string[] {
  return walk(PLANS)
    .map((p) => p.slice(PLANS.length + 1))
    .filter(isProcessArtifact)
    .sort()
}

describe('C52 plans — sin artefactos de proceso', () => {
  it('no hay contratos viejos ni informes de sesión versionados', () => {
    const found = processArtifacts()
    expect(
      found,
      `Artefactos de proceso (N=${found.length}):\n  ${found.slice(0, 10).join('\n  ')}`,
    ).toEqual([])
  })

  it('el ledger sigue ahí (es la fuente de verdad, no un artefacto)', () => {
    expect(processArtifacts()).not.toContain('ledger.json')
    expect(statSync(join(PLANS, 'ledger.json')).isFile()).toBe(true)
  })
})

describe('C52 plans — el detector no es decorativo', () => {
  it('marca un contrato viejo', () => {
    expect(isProcessArtifact('contratos/contracts/C1.json')).toBe(true)
    expect(isProcessArtifact('contratos/README.md')).toBe(true)
  })
  it('marca un informe de sesión o entrega', () => {
    expect(isProcessArtifact('estado-sesion-2026-09-17.md')).toBe(true)
    expect(isProcessArtifact('estado-entrega-2026-09-10.md')).toBe(true)
  })
  it('no marca el ledger ni los documentos de diseño', () => {
    expect(isProcessArtifact('ledger.json')).toBe(false)
    expect(isProcessArtifact('plan-motor-unico-escucha.md')).toBe(false)
    expect(isProcessArtifact('plan-motor-temporal-generico.md')).toBe(false)
  })
})
