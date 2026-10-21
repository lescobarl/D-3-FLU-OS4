/**
 * fullSuitePathBarrier — la suite completa está PROHIBIDA (AGENTS.md §1.15).
 *
 * DEFECTO MEDIDO que este guard cierra: la barrera vivía SOLO en el script npm
 * `test:full`, así que bloqueaba un NOMBRE, no la CAPACIDAD. El atajo
 * `npx vitest run --reporter=dot --silent` no pasa por `npm run`, la suite entera
 * se ejecutó sin autorización y el guard de entonces seguía verde porque miraba
 * el TEXTO del script.
 *
 * Aquí se mide la CONDUCTA, no la forma del comando:
 *   B1 un proceso REAL de vitest, sin filtro y sin autorización, MUERE pidiéndola;
 *   B2 el detector no se deja engañar por el VALOR de un flag ni por `--config`;
 *   B3 una corrida acotada NO se bloquea (no se rompe la vía rápida);
 *   B4 la autorización expresa abre la puerta;
 *   B5 las dos puertas comparten UN criterio y el gate ya no corre la suite.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertSuiteScope, hasScopeFilter, isUnfilteredRun } from '../scripts/full-suite-policy.mjs'
import { GUARD_FILES } from '../scripts/guard-files.mjs'

const ROOT = process.cwd()
const VITEST_BIN = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

/** Entorno SIN autorización: el bloqueo no depende de la máquina que lo corre. */
function envSinAuth(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CI
  delete env.GITHUB_ACTIONS
  delete env.FLU_AUTH_FULL_SUITE
  return env
}

/** argv como el de una invocación real (`node <bin> <args...>`). */
function argvDe(...args: string[]): string[] {
  return ['node', VITEST_BIN, ...args]
}

describe('B1 la suite completa sin filtro y sin autorización MUERE (proceso real)', () => {
  it('`vitest run` sin filtro aborta en la carga del config pidiendo autorización', () => {
    let code: number | null = null
    let salida = ''
    try {
      const out = execFileSync(process.execPath, [VITEST_BIN, 'run'], {
        cwd: ROOT,
        env: envSinAuth(),
        encoding: 'utf8',
        stdio: 'pipe',
        // Si la barrera NO saltara, aquí correría el repo entero (minutos): el
        // timeout mata el proceso y el test cae en ROJO. Esa sensibilidad es el
        // punto: un guard que no puede fallar no vigila nada.
        timeout: 60_000,
      })
      salida = String(out)
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string }
      code = e.status ?? null
      salida = `${e.stdout || ''}${e.stderr || ''}`
    }
    expect(code, 'la suite completa arrancó sin autorización').not.toBe(0)
    expect(salida).toContain('BLOQUEADA')
    expect(salida).toContain('PROHIBIDO')
  }, 90_000)
})

describe('B2 el detector no se deja engañar por el VALOR de un flag ni por --config', () => {
  it('`--reporter dot` (valor suelto) NO cuenta como filtro', () => {
    // La forma de colar la suite entera como "corrida filtrada": `dot` no es una
    // ruta, es el valor de --reporter. Si contara, la puerta quedaría abierta.
    expect(isUnfilteredRun(argvDe('run', '--reporter', 'dot'))).toBe(true)
    expect(hasScopeFilter(argvDe('run', '--reporter', 'dot'))).toBe(false)
  })

  it('una ruta de test SÍ acota', () => {
    expect(isUnfilteredRun(argvDe('run', 'tests/eolGuard.test.ts'))).toBe(false)
    expect(isUnfilteredRun(argvDe('run', 'tests/'))).toBe(false)
  })

  it('las vías rápidas de AGENTS.md acotan sin ruta posicional', () => {
    expect(isUnfilteredRun(argvDe('run', '--changed'))).toBe(false)
    expect(isUnfilteredRun(argvDe('run', '-t', 'una locucion una fila'))).toBe(false)
    expect(isUnfilteredRun(argvDe('run', '--shard=1/2'))).toBe(false)
  })

  it('`--config vitest.guards.config.ts` acota; cualquier otra config NO', () => {
    expect(isUnfilteredRun(argvDe('run', '--config', 'vitest.guards.config.ts'))).toBe(false)
    expect(isUnfilteredRun(argvDe('run', '--config=vitest.guards.config.ts'))).toBe(false)
    expect(isUnfilteredRun(argvDe('run', '--config', 'vitest.config.ts'))).toBe(true)
    expect(isUnfilteredRun(argvDe('run', '--config', 'otra.config.ts'))).toBe(true)
  })

  it('el atajo declarado acota de VERDAD (su include es la lista de guards)', () => {
    const config = readFileSync(join(ROOT, 'vitest.guards.config.ts'), 'utf8')
    expect(config).toContain("from './scripts/guard-files.mjs'")
    expect(config).toContain('include: [...GUARD_FILES]')
    expect(GUARD_FILES.length, 'la lista de guards no puede estar vacía').toBeGreaterThan(0)
    expect(
      GUARD_FILES.every((f: string) => /^tests\/.+\.test\.(ts|tsx)$/.test(f)),
      'un guard debe ser un test del directorio tests/',
    ).toBe(true)
  })

  it('el modo watch (interactivo) no es una corrida que se cierra sola', () => {
    expect(isUnfilteredRun(argvDe())).toBe(false)
    expect(isUnfilteredRun(argvDe('--reporter=dot'))).toBe(false)
  })
})

describe('B3 la vía rápida NO se bloquea / B4 la autorización expresa abre', () => {
  it('una corrida acotada no lanza', () => {
    expect(() =>
      assertSuiteScope({ argv: argvDe('run', 'tests/eolGuard.test.ts'), env: envSinAuth() }),
    ).not.toThrow()
  })

  it('sin filtro y sin autorización lanza', () => {
    expect(() => assertSuiteScope({ argv: argvDe('run'), env: envSinAuth() })).toThrow(/BLOQUEADA/)
  })

  it('con autorización expresa (humana o CI) no lanza', () => {
    const autorizaciones = [{ FLU_AUTH_FULL_SUITE: '1' }, { CI: 'true' }, { GITHUB_ACTIONS: 'true' }]
    for (const env of autorizaciones) {
      expect(() => assertSuiteScope({ argv: argvDe('run'), env })).not.toThrow()
    }
  })
})

describe('B5 las dos puertas comparten UN criterio y el gate no corre la suite', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')

  it('el config de vitest aplica la barrera (es el camino por el que pasa cualquiera)', () => {
    expect(readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8')).toContain('assertSuiteScope()')
  })

  it('el script npm delega en la política en vez de reimplementarla', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'require-full-suite-auth.mjs'), 'utf8')
    expect(script).toContain("from './full-suite-policy.mjs'")
    expect(script, 'no puede volver a decidir la autorización por su cuenta').not.toContain(
      'process.env.FLU_AUTH_FULL_SUITE',
    )
  })

  it('la política es el único sitio que decide qué es autorización', () => {
    const policy = readFileSync(join(ROOT, 'scripts', 'full-suite-policy.mjs'), 'utf8')
    expect(policy).toContain('export function isSuiteAuthorized')
  })

  it('`test:full` pasa por la puerta y `gate` NO ejecuta la suite', () => {
    expect(pkg.scripts['test:full']).toContain('scripts/require-full-suite-auth.mjs')
    expect(pkg.scripts.gate, 'gate no puede volver a correr la suite prohibida').not.toContain('test:full')
    expect(pkg.scripts['test:file']).toBeTruthy()
    expect(pkg.scripts['test:grep']).toBeTruthy()
  })

  it('AGENTS.md declara la prohibición y la vía rápida', () => {
    expect(agents).toContain('PROHIBIDO ejecutar la suite completa')
    expect(agents).toContain('FLU_AUTH_FULL_SUITE=1')
    expect(agents).toContain('npm run test:file')
  })

  it('este guard está registrado en lint:guards (si no, no es barrera)', () => {
    expect(GUARD_FILES).toContain('tests/fullSuitePathBarrier.test.ts')
  })
})
