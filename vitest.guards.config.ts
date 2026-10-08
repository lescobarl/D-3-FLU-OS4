/**
 * Gate de guards: la LISTA vive en scripts/guard-files.mjs (un DATO) y aqui solo se
 * declara como el `include` de la corrida. `npm run lint:guards` carga ESTE config.
 *
 * POR QUE EXISTE (P9.22, medido): con la lista dentro del script de package.json el
 * comando medía 7980 chars y MORIA al añadir el fichero 220 ('The syntax of the
 * command is incorrect': cmd.exe corta en 8191), lo que impedía cumplir 0.24/0.25
 * (todo test que importe el src tocado tiene que correr en el gate).
 *
 * NO DEBILITA la barrera de la suite completa: `scripts/full-suite-policy.mjs`
 * declara este fichero en SCOPED_CONFIGS (su include es una lista EXPLICITA, no el
 * repo entero), asi que una corrida `vitest run --config vitest.guards.config.ts`
 * cuenta como ACOTADA y no pide autorizacion (lo fija tests/fullSuitePathBarrier).
 */
import { defineConfig } from 'vitest/config'
import base from './vitest.config'
import { GUARD_FILES } from './scripts/guard-files.mjs'

export default defineConfig({
    ...base,
    test: { ...((base as { test?: object }).test ?? {}), include: [...GUARD_FILES] },
})
