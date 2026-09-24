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
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Codigos de "nombre inexistente". */
export const CODIGOS = ['TS2304', 'TS2552']

/** Lineas de error de `tsc` con checkJs que son un nombre inexistente. */
export function erroresDeNombreLibre(raiz = process.cwd()) {
  const tsc = join(raiz, 'node_modules', 'typescript', 'bin', 'tsc')
  const r = spawnSync(
    process.execPath,
    [tsc, '-p', join(raiz, 'tsconfig.json'), '--noEmit', '--checkJs'],
    { cwd: raiz, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  )
  const salida = `${r.stdout || ''}${r.stderr || ''}`
  const re = new RegExp(`error (${CODIGOS.join('|')}):`)
  return salida.split('\n').filter((l) => re.test(l))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errores = erroresDeNombreLibre()
  if (process.env.JS_REF_DETAIL === '1') {
    for (const e of errores) console.error(`  ${e}`)
  }
  console.log(errores.length)
}
