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
const MINI = join(ROOT, 'tests', 'fixtures', 'playback', 'mini')

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  })
}

describe('FLU Playback CLI', () => {
  it('valida una sesión con --dry-run y no abre navegador', () => {
    const result = run(['--session', MINI, '--dry-run'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('mini-600ms')
    expect(result.stdout).toContain('"sampleRate": 16000')
  })

  it('falla sin --session', () => {
    const result = run([])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Falta --session')
  })

  it('falla con un modo inválido', () => {
    const result = run(['--session', MINI, '--mode', 'otro', '--dry-run'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--mode invalido')
  })

  it('restore-start exige base-start y no lo inventa', () => {
    const result = run(['--session', MINI, '--mode', 'restore-start', '--dry-run'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('base-start')
  })

  it('falla si la sesión no existe', () => {
    const result = run(['--session', join(ROOT, 'no-existe'), '--dry-run'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Sesion no encontrada')
  })
})
