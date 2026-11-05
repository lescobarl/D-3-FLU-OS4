/**
 * Politica UNICA de la suite completa (AGENTS.md §1.15 y §4: "PROHIBIDO ejecutar
 * la suite completa").
 *
 * POR QUE EXISTE: la barrera vivio antes SOLO en el script npm `test:full`, asi
 * que bloqueaba un nombre, no la CAPACIDAD. El atajo `npx vitest run` no pasa por
 * `npm run` y esquivaba la barrera mientras el guard miraba el TEXTO del script.
 *
 * Este modulo define el criterio UNA vez y lo aplican DOS puertas:
 *   - `scripts/require-full-suite-auth.mjs` (script npm `test:full`);
 *   - `vitest.config.ts`, que vitest carga en TODA corrida (npm, npx, IDE).
 * Ninguna corrida de vitest ocurre sin cargar su config: cerrar ahi cierra el
 * camino, no el nombre del comando.
 *
 * ALCANCE DECLARADO: se bloquea la corrida NO interactiva sin filtro (`run`,
 * `bench`). El modo watch (`vitest` a secas) no se bloquea: es interactivo y lo
 * ve el humano, pero avisa en la documentacion porque tambien corre el repo.
 */
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

/** Autorizacion expresa: la sesion humana la pide en ESE turno. */
export const AUTH_ENV_VAR = 'FLU_AUTH_FULL_SUITE'
export const AUTH_ENV_VALUE = '1'

/** Subcomandos de una corrida NO interactiva (la que se ejecuta y termina). */
const CIERRA_SOLO = new Set(['run', 'bench'])

/**
 * Flags que ACOTAN la corrida por si mismos, sin ruta posicional:
 * `--changed` (solo lo cambiado vs HEAD), `-t/--testNamePattern` (por nombre),
 * `--related` (por archivo tocado) y `--shard` (una particion).
 */
const FLAGS_QUE_ACOTAN = ['--changed', '-t', '--testNamePattern', '--related', '--shard']

/**
 * Entry points que ACOTAN por CONSTRUCCION: su `include` es una lista explicita
 * de guards, no el repo entero. Se declara aqui como DATO (el consumidor no
 * reimplementa el criterio) y el guard comprueba que ese include sigue siendo
 * `GUARD_FILES`, para que el atajo no se convierta en puerta trasera.
 */
const CONFIGS_QUE_ACOTAN = new Set(['vitest.guards.config.ts'])

/**
 * Una sesion con autorizacion expresa (humana o CI) puede correr la suite entera.
 * `CI` y `GITHUB_ACTIONS` los pone la plataforma: no los escribe el agente.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isSuiteAuthorized(env = process.env) {
  return (
    env[AUTH_ENV_VAR] === AUTH_ENV_VALUE || Boolean(env.CI) || Boolean(env.GITHUB_ACTIONS)
  )
}

/**
 * El token parece una RUTA de test (luego acota el alcance)?
 *
 * Se exige forma o existencia real a proposito: asi `--reporter dot` -- donde
 * `dot` es el VALOR de un flag, no un filtro -- no se confunde con una ruta, que
 * era la forma de colar la suite entera como "corrida filtrada".
 *
 * @param {string} token
 * @param {string} cwd
 * @returns {boolean}
 */
function esRutaDeTest(token, cwd) {
  if (!token || token.startsWith('-')) return false
  if (/[\\/]/.test(token)) return true
  if (/\.test\.(ts|tsx|js|jsx)$/.test(token)) return true
  try {
    return existsSync(cwd ? `${cwd}/${token}` : token)
  } catch {
    return false
  }
}

/**
 * La invocacion ACOTA el alcance (corre un subconjunto, no el repo entero)?
 *
 * @param {string[]} argv argv completo del proceso
 * @param {{cwd?: string}} [opts]
 * @returns {boolean}
 */
export function hasScopeFilter(argv = process.argv, { cwd = process.cwd() } = {}) {
  const args = argv.slice(2)
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (FLAGS_QUE_ACOTAN.some((flag) => token === flag || token.startsWith(`${flag}=`))) return true
    if (token === '--config' || token.startsWith('--config=')) {
      const value = token === '--config' ? args[i + 1] : token.slice('--config='.length)
      // El valor de `--config` NO es una ruta de test: se consume para que
      // `--config vitest.config.ts` no se cuele como "corrida filtrada" por
      // existir en disco (medido: el test lo marcaba como filtro).
      if (token === '--config') i += 1
      if (value && CONFIGS_QUE_ACOTAN.has(basename(value))) return true
      continue
    }
    if (esRutaDeTest(token, cwd)) return true
  }
  return false
}

/**
 * La invocacion es una corrida NO interactiva del repo entero?
 *
 * @param {string[]} argv
 * @param {{cwd?: string}} [opts]
 * @returns {boolean}
 */
export function isUnfilteredRun(argv = process.argv, opts = {}) {
  const [sub] = argv.slice(2)
  if (!CIERRA_SOLO.has(sub)) return false
  return !hasScopeFilter(argv, opts)
}

/** Texto UNICO de bloqueo: lo comparten el script npm y el config de vitest. */
export function blockedMessage() {
  return [
    '',
    'SUITE COMPLETA BLOQUEADA: esta PROHIBIDO ejecutarla (AGENTS.md §1.15).',
    '',
    'La validacion de un cambio es:',
    '  npm run test:file <ruta>            p.ej. npm run test:file tests/eolGuard.test.ts',
    '  npm run test:grep -- "<texto>"      filtra por nombre de caso',
    '  npm test                            solo lo cambiado vs HEAD (vitest --changed)',
    '  npm run lint && npm run typecheck   guards + tipos',
    '',
    'La suite completa la corre el CI (CI=true es autorizacion expresa).',
    `Solo si el USUARIO la pide en ese turno: ${AUTH_ENV_VAR}=${AUTH_ENV_VALUE} npm run test:full`,
    '',
  ].join('\n')
}

/**
 * Aborta si la corrida es la suite completa sin autorizacion. La llaman
 * `vitest.config.ts` (cualquier entrada) y `require-full-suite-auth.mjs`.
 *
 * @param {{argv?: string[], env?: NodeJS.ProcessEnv, cwd?: string}} [opts]
 */
export function assertSuiteScope({ argv = process.argv, env = process.env, cwd = process.cwd() } = {}) {
  if (!isUnfilteredRun(argv, { cwd })) return
  if (isSuiteAuthorized(env)) return
  const error = new Error(blockedMessage())
  error.name = 'FullSuiteBlocked'
  throw error
}
