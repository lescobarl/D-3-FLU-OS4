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
 */
const authorized = process.env.FLU_AUTH_FULL_SUITE === '1' || Boolean(process.env.CI) || Boolean(process.env.GITHUB_ACTIONS)

if (authorized) {
  const via = process.env.GITHUB_ACTIONS || process.env.CI
    ? 'CI'
    : 'FLU_AUTH_FULL_SUITE=1'
  console.log(`test:full autorizado (${via})`)
  process.exit(0)
}

console.error(
  [
    '',
    'test:full BLOQUEADO: la suite completa necesita autorizacion expresa.',
    '',
    'Usa la via rapida (los casos que tocas):',
    '  npm run test:file <ruta>            p.ej. npm run test:file tests/eolGuard.test.ts',
    '  npm run test:grep -- "<texto>"      filtra por nombre de caso',
    '  npm test                            solo lo cambiado vs HEAD (vitest --changed)',
    '',
    'Si de verdad quieres la suite completa:',
    '  FLU_AUTH_FULL_SUITE=1 npm run test:full',
    '',
  ].join('\n'),
)
process.exit(1)
