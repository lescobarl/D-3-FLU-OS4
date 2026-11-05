/**
 * Helpers compartidos por los guards de TEXTO (los que recorren `src/` para
 * medir una propiedad). Antes cada guard re-declaraba su propio `walk`, con 15
 * variantes distintas: este es el punto UNICO del recorrido de ficheros.
 *
 * No confundir con `isTextGuard` (instrumentIntegrityGuard 0.24): los guards
 * siguen leyendo con `readFileSync` en su propio codigo, que es lo que ese guard
 * usa para saber quien lee `src`. Aqui solo vive el RECORRIDO.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Recorre `dir` recursivamente y devuelve las rutas (join) de los ficheros cuyo
 * nombre casa `ext`. El regex se pasa SIEMPRE explicito por el llamante para que
 * cada guard conserve EXACTAMENTE su filtro previo (p. ej. con o sin `.mjs`).
 */
export function walkFiles(dir: string, ext: RegExp): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full, ext))
    else if (ext.test(entry.name)) out.push(full)
  }
  return out
}
