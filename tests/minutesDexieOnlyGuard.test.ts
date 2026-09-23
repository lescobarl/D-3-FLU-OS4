// ============================================================
// P1.1 - Las minutas viven SOLO en Dexie (doctrina C31).
// ============================================================
/**
 * backupSystem extractaba y restauraba el historial de minutas por localStorage con una
 * clave (flu-minute-history) que NADIE mas escribia: el backup salia siempre vacio, y la
 * restauracion escribia en esa clave muerta. Encima espejaba el resultado en
 * integrationStore, un SEGUNDO publicador contra la doctrina de P1.2 (solo el dueno de la
 * minuta publica).
 *
 * C31 ya bendijo el patron para voiceProfiles: si el dato vive SOLO en Dexie, que ya es
 * persistente, el backup no duplica esa ruta (extract -> [], restore -> false). Las
 * minutas eran el caso que se quedo fuera.
 *
 * AMBITO: todo src/, sin exclusiones (AGENTS.md 7.7.d).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const STORE = 'src/store/integrationStore.ts'
/** La clave localStorage retirada y su literal. */
export const KEY_RE = /MINUTE_HISTORY|flu-minute-history/
/** Escritura del espejo del historial en el store. */
export const MIRROR_RE = /minuteHistory\s*:/
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/')
const isComment = (t: string) => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
/** Lineas de CODIGO (no comentario) que usan la clave localStorage de minutas. */
export function keySites(src: string, fileName: string): string[] {
  const out: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (isComment(line.trim())) return
    if (KEY_RE.test(line)) out.push(fileName + ':' + (i + 1))
  })
  return out
}
/** Lineas que ESCRIBEN el espejo en el store, excluyendo al propio store. */
export function mirrorSites(src: string, fileName: string): string[] {
  if (fileName === STORE) return []
  const out: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (isComment(line.trim())) return
    if (MIRROR_RE.test(line)) out.push(fileName + ':' + (i + 1))
  })
  return out
}
/** Cuerpo de un metodo, delimitado por su llave de cierre a 4 espacios. */
function methodBody(src: string, sig: string): string {
  const lines = src.split(/\r?\n/)
  const start = lines.findIndex((l) => l.includes(sig))
  if (start < 0) return ''
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '    }') return lines.slice(start, i + 1).join(String.fromCharCode(10))
  }
  return ''
}

/** Quita las lineas de comentario: un comentario que NOMBRA lo prohibido no lo comete. */
function codeOnly(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join(String.fromCharCode(10))
}

const FILES = walk(SRC)
const read = (f: string) => readFileSync(f, 'utf8')
describe('P1.1 minutas - un solo almacen (Dexie)', () => {
  it('la clave localStorage de minutas ya no existe en src/', () => {
    const refs = FILES.flatMap((f) => keySites(read(f), rel(f)))
    expect(refs, 'clave de minutas viva (N=' + refs.length + '): ' + refs.join(', ')).toEqual([])
  })
  it('el historial no se espeja en integrationStore fuera del store', () => {
    const mirrors = FILES.flatMap((f) => mirrorSites(read(f), rel(f)))
    expect(mirrors, 'espejos (N=' + mirrors.length + '): ' + mirrors.join(', ')).toEqual([])
  })
  it('el backup aplica C31 a las minutas (extract [] / restore false)', () => {
    const src = read('src/core/autonomy/backupSystem.ts')
    const extract = methodBody(src, 'extractMinuteHistory(): MinuteUIEntry[] {')
    const restore = methodBody(src, 'restoreMinuteHistory(data: MinuteUIEntry[] | null): boolean {')
    expect(extract.length, 'cuerpo del extractor vacio').toBeGreaterThan(20)
    expect(restore.length, 'cuerpo del restaurador vacio').toBeGreaterThan(20)
    const extractCode = codeOnly(extract)
    expect(extractCode, 'el extractor sigue leyendo localStorage').not.toContain('localStorage')
    expect(extractCode, 'el extractor sigue leyendo el espejo').not.toContain('minuteHistory')
    expect(/return \[\];/.test(extract), 'el extractor no devuelve []').toBe(true)
    expect(/void data;/.test(restore), 'el restaurador no ignora data').toBe(true)
    expect(/return false;/.test(restore), 'el restaurador no devuelve false').toBe(true)
  })
})
describe('P1.1 - el detector no es decorativo (7.7.d)', () => {
  it('keySites caza la clave por constante y por literal, e ignora comentarios', () => {
    expect(keySites("localStorage.getItem(STORAGE_KEYS.MINUTE_HISTORY)", 'a.ts')).toEqual(['a.ts:1'])
    expect(keySites("localStorage.setItem('flu-minute-history', s)", 'a.ts')).toEqual(['a.ts:1'])
    expect(keySites('    // se elimino MINUTE_HISTORY', 'a.ts')).toEqual([])
    expect(keySites("localStorage.getItem(STORAGE_KEYS.UI_THEME)", 'a.ts')).toEqual([])
  })
  it('mirrorSites distingue escritura de lectura y excluye al store', () => {
    expect(mirrorSites('minuteHistory: data,', 'b.ts')).toEqual(['b.ts:1'])
    expect(mirrorSites('minuteHistory: data,', STORE)).toEqual([])
    expect(mirrorSites('const minuteHistory = useIntegrationStore.getState().minuteHistory', 'b.ts')).toEqual([])
  })
})