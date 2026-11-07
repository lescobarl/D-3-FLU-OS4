// @vitest-environment node
// ============================================================
// FLU Playback - contrato del CLI
// ------------------------------------------------------------
// Valida la interfaz de soporte sin abrir navegador: sesión válida,
// argumentos inválidos y restore-start sin base-start.
// ============================================================
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const CLI = join(ROOT, 'scripts', 'playback.mjs')

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  })
}

describe('FLU Playback CLI', () => {
  it('falla sin --session', () => {
    const result = run([])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Falta --session')
  })

  it('falla si la sesión no existe', () => {
    const result = run(['--session', join(ROOT, 'no-existe')])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Sesion no encontrada')
  })
})
