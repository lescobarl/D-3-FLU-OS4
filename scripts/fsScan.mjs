/**
 * fsScan ? dueno UNICO del escaneo de fuentes y del corte de bloques del
 * instrumental de auditoria (A7: antes walk/readSources/block estaban copiados en
 * duplication.mjs, auditoria-codigo.mjs, auditoria.mjs y audit-metric.mjs).
 *
 * El FILTRO de extensiones es del CONSUMIDOR (cada instrumental declara su alcance);
 * lo que vive aqui es el bucle, la resolucion de rutas y el corte de llaves.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Ficheros de `dir` (recursivo) cuyo NOMBRE pasa `filter`; orden de lectura. */
export function walkFiles(dir, filter, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walkFiles(p, filter, acc)
    else if (filter(entry)) acc.push(p)
  }
  return acc
}

/** Alcance del instrumental de duplicacion: ts/tsx/js/jsx, sin .d.ts. */
export const scanSourceFilter = (entry) => /\.(ts|tsx|js|jsx)$/.test(entry) && !entry.endsWith('.d.ts')

/** Lee todos los fuentes de `root` (ts/tsx/js/jsx, sin .d.ts), relativos al cwd. */
export function readSources(root = 'src') {
  return walkFiles(join(process.cwd(), root), scanSourceFilter).map((f) => ({
    file: relative(process.cwd(), f).replace(/\\/g, '/'),
    source: readFileSync(f, 'utf8'),
  }))
}

/** Cuerpo `{...}` balanceado que empieza en `openIdx` (o null). */
export function block(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(openIdx, i + 1)
    }
  }
  return null
}
