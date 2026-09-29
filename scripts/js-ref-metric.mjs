/**
 * js-ref-metric - mide el invariante de P6.7 (SOLO LECTURA).
 *
 * Imprime UN entero: cuantos errores de "nombre que no existe" (TS2304
 * `Cannot find name` + TS2552 `Cannot find name. Did you mean?`) da `tsc` sobre
 * el proyecto con checkJs ACTIVADO.
 *
 * POR QUE ESTA CLASE DE ERROR Y NO LAS 1764: con `--checkJs` el proyecto da 1764
 * errores, y 1735 son ruido de tipado incremental (TS2339 745 propiedades,
 * TS7006/7003x 539+ parametros implicitos...). TS2304/TS2552 es la unica clase
 * que significa "este codigo llama a algo que no existe": es un ReferenceError
 * esperando a ejecutarse, no una opinion de tipos. Fue exactamente lo que dejo
 * pasar `tsc -b` (que no mira los .js porque no hay checkJs), y por eso el item
 * estaba sin cerrar aunque el tipo de bug sea el mas caro de los 1764.
 *
 * El mismo modulo lo importa tests/jsReferenceGuard.test.ts, para que la metrica
 * del contrato y el guard no puedan divergir.
 *
 * ASINCRONO A PROPOSITO (medido, no supuesto): antes lanzaba `tsc` con
 * `spawnSync`, que BLOQUEA el event loop del worker de vitest mientras corre. En
 * una maquina de 12 CPUs logicas maxWorkers es 10 y, bajo esa contencion, un
 * `tsc --checkJs` de ~9s en limpio puede pasar de los 60 s del timeout del RPC de
 * vitest: el worker deja de responder y la corrida COMPLETA queda roja por
 * "Unhandled Error: [vitest-worker]: Timeout calling onTaskUpdate" con los 3868
 * tests en verde (medido: jsReferenceGuard 70573ms en el log de CI que cita P6.7,
 * y re-medido hoy: 1 de 3 corridas con 3867/3868 verdes y 1 error no controlado,
 * fichero senalado jsReferenceGuard). Bajar maxWorkers -lo que se hizo entonces-
 * solo reduce la contencion: la causa, un subproceso sincrono dentro del worker,
 * seguia ahi. Con `execFile` + await el event loop queda libre, el RPC late y se
 * mide EXACTAMENTE lo mismo.
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Codigos de "nombre inexistente". */
export const CODIGOS = ['TS2304', 'TS2552']

/** Postfijo del error de tsc que cuenta como nombre inexistente. */
const RE_ERROR = new RegExp(`error (${CODIGOS.join('|')}):`)

/** Lineas de la salida de `tsc` que son un nombre inexistente. DUENO UNICO del criterio. */
export function lineasDeNombreLibre(salida) {
  return String(salida || '')
    .split('\n')
    .filter((l) => RE_ERROR.test(l))
}

/** Comando que mide el invariante. DUENO UNICO del argv (la metrica y el guard no divergen). */
export function comandoCheckJs(raiz = process.cwd()) {
  return {
    bin: process.execPath,
    args: [
      join(raiz, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      join(raiz, 'tsconfig.json'),
      '--noEmit',
      '--checkJs',
    ],
    cwd: raiz,
    maxBuffer: 128 * 1024 * 1024,
  }
}

/**
 * Lineas de error de `tsc` con checkJs que son un nombre inexistente.
 * ASINCRONO: no bloquea el event loop del worker (ver cabecera).
 */
export function erroresDeNombreLibre(raiz = process.cwd()) {
  const { bin, args, cwd, maxBuffer } = comandoCheckJs(raiz)
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, maxBuffer, encoding: 'utf8' }, (err, stdout, stderr) => {
      // tsc sale con codigo != 0 cuando ENCUENTRA errores: la salida sigue siendo valida.
      const salida = `${stdout ?? err?.stdout ?? ''}${stderr ?? ''}`
      resolve(lineasDeNombreLibre(salida))
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errores = await erroresDeNombreLibre()
  if (process.env.JS_REF_DETAIL === '1') {
    for (const e of errores) console.error(`  ${e}`)
  }
  console.log(errores.length)
}
