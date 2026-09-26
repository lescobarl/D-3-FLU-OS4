/**
 * Repara la clase EOL del árbol de trabajo para que coincida con la del índice
 * (`git ls-files --eol`), que es exactamente lo que exige `tests/eolGuard.test.ts`.
 *
 * Por qué existe: `core.autocrlf=false` y sin `.gitattributes`, cualquier editor
 * que guarde en CRLF convierte un cambio de 20 líneas en un diff de miles, y
 * `.task/frozen.json` hashea BYTES del árbol. Se falló dos veces por esto.
 *
 * Reglas:
 *   - índice `lf`   -> todo el archivo a LF.
 *   - índice `crlf` -> todo el archivo a CRLF.
 *   - índice `mixed`-> se reconstruye el patrón mezclado del blob del índice por
 *                      CONTENIDO de línea (no por número: insertar líneas no
 *                      desalinea). Líneas nuevas usan la EOL dominante del índice.
 *   - `.task/**` nunca se toca (inmutable).
 *
 * Uso: `npm run fix:eol`            (solo archivos con desajuste)
 *      `npm run fix:eol -- <ruta>`  (forzar esas rutas)
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const EOL = { lf: '\n', crlf: '\r\n' }

function kindOf(field) {
  const idx = field.indexOf('/')
  return idx === -1 ? '' : field.slice(idx + 1)
}

function eolRows() {
  return execSync('git ls-files --eol', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t')
      const meta = line.slice(0, tab).trim().split(/\s+/)
      return { i: kindOf(meta[0]), w: kindOf(meta[1]), path: line.slice(tab + 1) }
    })
}

function readLines(buf) {
  // Divide conservando la EOL de cada línea.
  return buf.split(/(?<=\n)/)
}

function dominantEol(buf) {
  const crlf = (buf.match(/\r\n/g) || []).length
  const lf = (buf.match(/(?<!\r)\n/g) || []).length
  if (crlf === 0 && lf === 0) return EOL.lf
  return crlf > lf ? EOL.crlf : EOL.lf
}

/** Contenido de línea (sin EOL) -> EOL usada en el blob del índice. */
function indexEolMap(path) {
  const blob = execSync(`git show :"${path}"`, { encoding: 'utf8' })
  const map = new Map()
  for (const raw of readLines(blob)) {
    const eol = raw.endsWith('\r\n') ? EOL.crlf : raw.endsWith('\n') ? EOL.lf : ''
    if (!eol) continue
    const key = raw.slice(0, -eol.length)
    if (!map.has(key)) map.set(key, eol)
  }
  return map
}

function normalize(path, indexKind, workKind) {
  const buf = fs.readFileSync(path, 'utf8')
  let out
  if (indexKind === 'mixed') {
    const fallback = dominantEol(buf)
    const map = indexEolMap(path)
    out = readLines(buf)
      .map((raw) => {
        const eol = raw.endsWith('\r\n') ? EOL.crlf : raw.endsWith('\n') ? EOL.lf : ''
        if (!eol) return raw
        const key = raw.slice(0, -eol.length)
        return key + (map.get(key) ?? fallback)
      })
      .join('')
  } else {
    const eol = EOL[indexKind]
    if (!eol) return { path, changed: false, note: `clase no soportada: ${indexKind}` }
    out = buf.replace(/\r\n/g, '\n').replace(/\n/g, eol)
  }
  if (out === buf) return { path, changed: false }
  fs.writeFileSync(path, out, 'utf8')
  return { path, changed: true, from: workKind, to: indexKind }
}

const forced = process.argv.slice(2)
const rows = eolRows()
const targets = forced.length
  ? forced.map((path) => {
      const row = rows.find((r) => r.path === path)
      return { path, i: row?.i ?? 'lf', w: row?.w ?? '?' }
    })
  : rows.filter((r) => r.i !== r.w && r.i !== '-text' && r.i !== 'none' && r.w !== '-text' && r.w !== 'none')

const skipped = targets.filter((t) => t.path.startsWith('.task/'))
const results = targets
  .filter((t) => !t.path.startsWith('.task/'))
  .map((t) => normalize(t.path, t.i, t.w))

const fixed = results.filter((r) => r.changed)
for (const r of fixed) console.log(`fix:eol  ${r.path}  ${r.from} -> ${r.to}`)
for (const s of skipped) console.log(`fix:eol  ${s.path}  (omitido: .task/** es inmutable)`)
console.log(`fix:eol: ${fixed.length} reparado(s), ${results.length - fixed.length} ya correcto(s)`)
