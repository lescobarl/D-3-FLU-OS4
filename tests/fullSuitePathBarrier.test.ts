// ============================================================
// fullSuitePathBarrier - la suite completa no se alcanza por OTRO camino
// ------------------------------------------------------------
// Defecto medido (incumplimiento registrado en plans/ledger.json): la barrera
// vivia SOLO en el script npm `test:full`, asi que bloqueaba un nombre, no la
// CAPACIDAD. El agente corrio `npx vitest run --reporter=dot --silent` -- el
// atajo que AGENTS.md prohibe -- sin pasar por `npm run`, la suite entera se
// ejecuto sin autorizacion, y el guard que la vigila seguia verde porque
// (`tests/fullSuiteAuthGuard.test.ts`) mira el TEXTO del script y no la conducta.
//
// Este guard mide la CONDUCTA de verdad, no la forma del comando:
//   B1 un proceso REAL de vitest, sin filtro y sin autorizacion, MUERE pidiendola;
//   B2 el detector no se deja enganar por el VALOR de un flag (`--reporter dot`);
//   B3 una corrida acotada NO se bloquea (no rompe la via rapida);
//   B4 la autorizacion expresa abre la puerta;
//   B5 los dos caminos (script npm y config de vitest) comparten UN criterio.
// ============================================================
import { describe, expect, it } from 'vitest'
import { runAsync } from './_asyncExec'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertSuiteScope, hasScopeFilter, isUnfilteredRun } from '../scripts/full-suite-policy.mjs'

const ROOT = process.cwd()
const VITEST_BIN = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

/** Entorno SIN autorizacion: el bloqueo no depende de la maquina que lo corre. */
function envSinAuth() {
  const env = { ...process.env }
  delete env.CI
  delete env.GITHUB_ACTIONS
  delete env.FLU_AUTH_FULL_SUITE
  return env
}

/** argv como el de una invocacion real (`node <bin> <args...>`). */
function argvDe(...args: string[]) {
  return ['node', VITEST_BIN, ...args]
}

describe('B1 la suite completa sin filtro y sin autorizacion MUERE (proceso real)', () => {
  it('`vitest run` sin filtro aborta en la carga del config pidiendo autorizacion', async () => {
    // Si la barrera NO saltara, esto correria la suite entera (>2 min): el timeout
    // del hijo mata el proceso y el test cae en rojo. La sensibilidad a la mutacion
    // es el punto: un guard que no puede fallar no vigila nada.
    const r = await runAsync(process.execPath, [VITEST_BIN, 'run'], {
      cwd: ROOT,
      env: envSinAuth(),
      timeout: 60_000,
    })
    const code = r.status
    const salida = `${r.stdout}${r.stderr}`
    expect(code).not.toBe(0)
    expect(salida).toContain('BLOQUEADO')
    expect(salida).toContain('autorizacion expresa')
  }, 90_000)
})

describe('B2 el detector no se deja enganar por el VALOR de un flag', () => {
  it('`--reporter dot` (valor suelto) NO cuenta como filtro', async () => {
    // La forma de colar la suite entera como "corrida filtrada": `dot` no es una
    // ruta, es el valor de --reporter. Si contara, quedaria abierta.
    expect(isUnfilteredRun(argvDe('run', '--reporter', 'dot'))).toBe(true)
    expect(hasScopeFilter(argvDe('run', '--reporter', 'dot'))).toBe(false)
  })

  it('una ruta de test SI acota', async () => {
    expect(isUnfilteredRun(argvDe('run', 'tests/eolGuard.test.ts'))).toBe(false)
    expect(isUnfilteredRun(argvDe('run', 'tests/'))).toBe(false)
  })

  it('las vias rapidas de AGENTS.md acotan sin ruta posicional', async () => {
    expect(isUnfilteredRun(argvDe('run', '--changed'))).toBe(false)
    expect(isUnfilteredRun(argvDe('run', '-t', 'una locucion una fila'))).toBe(false)
  })

  it('el modo watch (interactivo) no es una corrida que se cierra sola', async () => {
    expect(isUnfilteredRun(argvDe())).toBe(false)
    expect(isUnfilteredRun(argvDe('--reporter=dot'))).toBe(false)
  })
})

describe('B3 la via rapida NO se bloquea / B4 la autorizacion expresa abre', () => {
  it('una corrida acotada no lanza (no rompe lo ya validado)', async () => {
    expect(() => assertSuiteScope({ argv: argvDe('run', 'tests/eolGuard.test.ts'), env: envSinAuth() })).not.toThrow()
  })

  it('sin filtro y sin autorizacion lanza', async () => {
    expect(() => assertSuiteScope({ argv: argvDe('run'), env: envSinAuth() })).toThrow(/BLOQUEADO/)
  })

  it('con autorizacion expresa (humana o CI) no lanza', async () => {
    const auth = [{ FLU_AUTH_FULL_SUITE: '1' }, { CI: 'true' }, { GITHUB_ACTIONS: 'true' }]
    for (const env of auth) {
      expect(() => assertSuiteScope({ argv: argvDe('run'), env })).not.toThrow()
    }
  })
})

describe('B5 los dos caminos comparten UN criterio (no dos copias)', () => {
  const policy = join(ROOT, 'scripts', 'full-suite-policy.mjs')

  it('el config de vitest aplica la barrera (es el camino por el que pasa cualquiera)', async () => {
    expect(readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8')).toContain('assertSuiteScope()')
  })

  it('el script npm delega en la politica en vez de reimplementarla', async () => {
    const script = readFileSync(join(ROOT, 'scripts', 'require-full-suite-auth.mjs'), 'utf8')
    expect(script).toContain("from './full-suite-policy.mjs'")
    expect(script, 'no puede volver a decidir la autorizacion por su cuenta').not.toContain('process.env.FLU_AUTH_FULL_SUITE')
  })

  it('la politica es el unico sitio que decide que es autorizacion', async () => {
    expect(readFileSync(policy, 'utf8')).toContain('export function isSuiteAuthorized')
  })
})

describe('B6 un config DECLARADO acotado cuenta como corrida acotada (P9.22)', () => {
  it('`--config vitest.guards.config.ts` no pide autorizacion', async () => {
    // El gate de guards lleva su lista en un config (`include` EXPLICITO, no el repo
    // entero) porque la lista no cabe en la linea de comandos (cmd.exe corta en 8191:
    // P9.22). Si esto no contara como acotado, `npm run lint:guards` se BLOQUEARIA solo.
    expect(hasScopeFilter(argvDe('run', '--config', 'vitest.guards.config.ts'))).toBe(true)
    expect(isUnfilteredRun(argvDe('run', '--config', 'vitest.guards.config.ts'))).toBe(false)
    expect(() => assertSuiteScope({ argv: argvDe('run', '--config', 'vitest.guards.config.ts'), env: envSinAuth() })).not.toThrow()
  })

  it('PRUEBA DE DETECTOR: solo el config DECLARADO acota; otro config no', async () => {
    // SCOPED_CONFIGS es una lista CERRADA: el config base (o cualquiera otro) sigue
    // contando como corrida SIN filtro, asi que el atajo no se abre por esta via.
    expect(isUnfilteredRun(argvDe('run', '--config', 'vitest.config.ts'))).toBe(true)
    expect(isUnfilteredRun(argvDe('run', '--config', 'otro.config.ts'))).toBe(true)
    expect(isUnfilteredRun(argvDe('run', '--config=vitest.guards.config.ts'))).toBe(false)
  })
})
