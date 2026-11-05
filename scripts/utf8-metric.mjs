/**
 * utf8-metric - mide el invariante de P6.18 (SOLO LECTURA).
 *
 * Imprime UN entero: cuantos ficheros de texto de src/ NO son UTF-8 valido.
 * Es el mismo modulo que importa tests/utf8Guard.test.ts, para que la metrica del
 * contrato y el guard no puedan divergir.
 *
 * Por que importa aunque sean bytes en comentarios: un fichero que no es UTF-8 no
 * se puede leer con la herramienta normal (Python, grep de otro editor, este mismo
 * medidor). En esta sesion bloqueo lecturas reales: `open(f, encoding='utf-8')`
 * reventaba y la consola mostraba `L?nea`. Ademas el error tapa los demas: el
 * primer fallo de decodificacion esconde los 11 siguientes, asi que un recuento
 * parcial (5) parece una respuesta y no lo es.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Extensiones de texto que se exigen UTF-8. */
export const EXT = ['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '.html', '.svg']

const DECODER = new TextDecoder('utf-8', { fatal: true })

/** true si los bytes son UTF-8 valido. */
export function esUtf8Valido(bytes) {
  try {
    DECODER.decode(bytes)
    return true
  } catch {
    return false
  }
}

/** Ficheros de texto de un arbol que NO son UTF-8 valido. */
export function ficherosNoUtf8(raiz, acc = []) {
  for (const e of readdirSync(raiz, { withFileTypes: true })) {
    const p = join(raiz, e.name)
    if (e.isDirectory()) ficherosNoUtf8(p, acc)
    else if (EXT.some((x) => e.name.endsWith(x))) {
      if (!esUtf8Valido(readFileSync(p))) acc.push(p.split('\\').join('/'))
    }
  }
  return acc
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raiz = process.argv[2] || 'src'
  const malos = ficherosNoUtf8(raiz)
  if (process.env.UTF8_DETAIL === '1') {
    for (const f of malos) console.error(`  ${f}`)
  }
  console.log(malos.length)
}
