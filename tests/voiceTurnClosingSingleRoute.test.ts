// ============================================================
// voiceTurnClosingSingleRoute.test.ts — GUARD §9 (ruta única de cierre + query)
// ------------------------------------------------------------
// Dos invariantes que HOY tienen N>1 rutas:
//
//   I1 — CIERRE ÚNICO: toda rama cierra el turno por el par único
//        `commitAndResolveTurn` (commit + resolución). `commitTurnPhrase` suelto
//        fuera de ese helper (y de `emitConversationLog`, que tiene throttle
//        propio) = una rama con su propio cierre.
//
//   I2 — QUERY ÚNICA: la IA (`requestFluContractForTranscript`) debe recibir la
//        query derivada (`deriveQueryFromRow`), no el texto propio de
//        `processCapture` (`bufferedTranscript`).
//
// Nace ROJO (§B11): lista `archivo:linea` de cada ruta duplicada.
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FILE = 'src/voice/hooks/useFluVoiceAssistant.js'

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length
}

function lineTextAt(source: string, index: number): string {
  const ls = source.lastIndexOf('\n', index) + 1
  const le = source.indexOf('\n', index)
  return source.slice(ls, le === -1 ? source.length : le).trim().slice(0, 110)
}

/**
 * Funciones que SÍ pueden llamar `commitTurnPhrase` directamente:
 *  - `commitAndResolveTurn`: el par único de cierre.
 *  - `emitConversationLog`: ruta rawOnly con throttle de streaming.
 */
function allowedRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const helperStart = source.indexOf('const commitAndResolveTurn = useCallback(')
  const helperEnd = source.indexOf('const [lastContract', helperStart)
  if (helperStart >= 0 && helperEnd > helperStart) ranges.push([helperStart, helperEnd])

  const logStart = source.indexOf('const emitConversationLog = useCallback(')
  const logEnd = source.indexOf('const commitSessionTurn = useCallback(', logStart)
  if (logStart >= 0 && logEnd > logStart) ranges.push([logStart, logEnd])
  return ranges
}

export function findClosingRouteViolations(source: string): Array<{ line: number; text: string }> {
  const ranges = allowedRanges(source)
  const re = /commitTurnPhrase\(/g
  const out: Array<{ line: number; text: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const idx = m.index
    if (ranges.some(([s, e]) => idx >= s && idx < e)) continue
    out.push({ line: lineAt(source, idx), text: lineTextAt(source, idx) })
  }
  return out
}

export function findQueryRouteViolations(source: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = []
  const call = 'requestFluContractForTranscript({'
  let i = source.indexOf(call)
  while (i >= 0) {
    const block = source.slice(i, Math.min(source.length, i + 500))
    if (/transcript:\s*bufferedTranscript\b/.test(block)) {
      const at = i + block.indexOf('transcript: bufferedTranscript')
      out.push({
        line: lineAt(source, at),
        text: 'requestFluContractForTranscript recibe bufferedTranscript (texto propio)',
      })
    }
    i = source.indexOf(call, i + 1)
  }
  return out
}

describe('§9 — cierre del turno y query por ruta única', () => {
  it('I1 — toda rama cierra por commitAndResolveTurn (no commitTurnPhrase suelto)', () => {
    const src = readFileSync(join(process.cwd(), FILE), 'utf8')
    const v = findClosingRouteViolations(src)
    const detail = v.map((x) => `${FILE}:${x.line}:${x.text}`).join('\n')
    expect(
      v,
      `\nRamas que cierran fuera de commitAndResolveTurn (N=${v.length}):\n${detail}`,
    ).toEqual([])
  })

  it('I2 — la IA recibe la query derivada (deriveQueryFromRow), no bufferedTranscript', () => {
    const src = readFileSync(join(process.cwd(), FILE), 'utf8')
    const v = findQueryRouteViolations(src)
    const detail = v.map((x) => `${FILE}:${x.line}:${x.text}`).join('\n')
    expect(v, `\nQuery derivada por ruta propia (N=${v.length}):\n${detail}`).toEqual([])
  })
})
