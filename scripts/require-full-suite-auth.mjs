/**
 * Puerta 1 de la suite COMPLETA: `npm run test:full` solo corre con autorizacion
 * expresa (AGENTS.md §1.15). Sin ella imprime la via rapida y sale con codigo 1.
 *
 * Por que: la suite completa tarda minutos y no es la unidad de validacion de un
 * cambio; para eso estan `test:file`, `test:grep` y `npm test` (--changed).
 *
 * Autorizacion explicita:
 *   - `FLU_AUTH_FULL_SUITE=1`  (sesion humana que la pide en ESE turno)
 *   - `CI=true` / `GITHUB_ACTIONS`  (la plataforma, no el agente)
 *
 * OJO: esta NO es la unica barrera. Bloquear solo este script fue el defecto
 * medido (el atajo `npx vitest run` no pasa por aqui); la barrera real esta en
 * `vitest.config.ts`, por donde SI pasa cualquier corrida. El criterio (que es
 * "sin filtro" y que cuenta como autorizacion) vive UNA vez en
 * `full-suite-policy.mjs`.
 */
import { AUTH_ENV_VAR, AUTH_ENV_VALUE, isSuiteAuthorized, blockedMessage } from './full-suite-policy.mjs'

if (isSuiteAuthorized()) {
  const via = process.env.GITHUB_ACTIONS || process.env.CI ? 'CI' : `${AUTH_ENV_VAR}=${AUTH_ENV_VALUE}`
  console.log(`test:full autorizado (${via})`)
  process.exit(0)
}

console.error(blockedMessage())
process.exit(1)
