/**
 * Politica UNICA de la suite completa (AGENTS.md seccion 5: "exige autorizacion
 * EXPRESA (regla dura)").
 *
 * DEFECTO QUE CIERRA (incumplimiento registrado, ver plans/ledger.json):
 * la barrera vivia SOLO en el script npm `test:full`, asi que bloqueaba UN
 * camino, no la capacidad. `npx vitest run --reporter=dot --silent` -- exactamente
 * el atajo que AGENTS.md prohibe -- no pasa por `npm run` y por tanto no tocaba
 * `require-full-suite-auth.mjs`: el agente corrio la suite entera sin autorizacion
 * y el guard que la vigila (`tests/fullSuiteAuthGuard.test.ts`) seguia verde,
 * porque miraba el TEXTO del script y no la conducta.
 *
 * Este modulo define el criterio UNA vez y lo aplican los DOS caminos:
 *   - `scripts/require-full-suite-auth.mjs` (script npm `test:full`);
 *   - `vitest.config.ts` (se ejecuta cuando vitest CARGA el config, sea cual sea
 *     la entrada: npm, npx, IDE o un script). Como ninguna corrida de vitest
 *     ocurre sin cargar su config, cerrar ahi cierra el camino, no el nombre.
 *
 * ALCANCE DECLARADO: se bloquea la corrida NO interactiva sin filtro (`run`,
 * `bench`). El modo watch no se bloquea -- es interactivo y el humano lo ve -- pero
 * avisa, porque un watch sin filtro tambien corre todo el repo.
 */
import { existsSync } from 'node:fs'

/** Autorizacion expresa de la sesion humana. */
export const AUTH_ENV_VAR = 'FLU_AUTH_FULL_SUITE'
export const AUTH_ENV_VALUE = '1'

/** Subcomandos de una corrida NO interactiva (la que se ejecuta y termina). */
const CIERRA_SOLO = new Set(['run', 'bench'])

/**
 * Flags que ACOTAN la corrida por si mismos, sin ruta posicional.
 * `--changed` (solo lo cambiado vs HEAD), `-t/--testNamePattern` (por nombre) y
 * `--related` (por archivo tocado) son la via rapida de AGENTS.md seccion 5.
 */
const FLAGS_QUE_ACOTAN = ['--changed', '-t', '--testNamePattern', '--related', '--shard']

/**
 * Una sesion con autorizacion expresa (humana o CI) puede correr la suite entera.
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
 * era la forma de colar la suite entera com una "corrida filtrada".
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
  for (const token of args) {
    if (FLAGS_QUE_ACOTAN.some((flag) => token === flag || token.startsWith(`${flag}=`))) return true
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
    'test:full BLOQUEADO: la suite completa necesita autorizacion expresa (AGENTS.md seccion 5).',
    '',
    'Usa la via rapida (los casos que tocas):',
    '  npm run test:file <ruta>            p.ej. npm run test:file tests/eolGuard.test.ts',
    '  npm run test:grep -- "<texto>"      filtra por nombre de caso',
    '  npm test                            solo lo cambiado vs HEAD (vitest --changed)',
    '',
    'Si de verdad quieres la suite completa:',
    `  ${AUTH_ENV_VAR}=${AUTH_ENV_VALUE} npm run test:full`,
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
