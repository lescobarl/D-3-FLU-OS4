/**
 * Barrera de la suite COMPLETA: `npm run test:full` solo corre con autorización
 * expresa. Sin ella, imprime la ruta rápida y sale con código 1.
 *
 * Por qué: la suite completa no es un gate de trabajo (342 archivos, >2 min de
 * reloj). Correrla "por si acaso" después de cada edición es el mayor gasto de
 * tiempo del proyecto, y el repo ya trae las vías rápidas (`test:file`,
 * `test:grep`, `test` = solo lo cambiado).
 *
 * Autorización explícita:
 *   - `FLU_AUTH_FULL_SUITE=1`  (sesión humana que la pide)
 *   - `CI=true`                (CI es autorización expresa por definición)
 *
 * OJO: esta salida NO es la única barrera. Bloquear solo este script fue el
 * defecto medido (el atajo `npx vitest run` no pasa por aquí); la barrera real
 * está en `vitest.config.ts`, por donde SÍ pasa cualquier corrida.
 */
import { AUTH_ENV_VAR, AUTH_ENV_VALUE, isSuiteAuthorized, blockedMessage } from './full-suite-policy.mjs'

if (isSuiteAuthorized()) {
  const via = process.env.GITHUB_ACTIONS || process.env.CI ? 'CI' : `${AUTH_ENV_VAR}=${AUTH_ENV_VALUE}`
  console.log(`test:full autorizado (${via})`)
  process.exit(0)
}

console.error(blockedMessage())
process.exit(1)
