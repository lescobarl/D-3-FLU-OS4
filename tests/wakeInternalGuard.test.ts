/**
 * C56 — wakeInternal: sin wake literales fuera de la fuente única.
 *
 * Antes (RED): dentro de `src/voice/lib/fluConfig.js`
 *   - `LISTENING_ACK_PHRASES` horneaba "oye flu"/"hey flu";
 *   - `passiveMustExclude` horneaba "okay flu".
 * Fuera de `FLU_WAKE_WORDS` no debe quedar ningún wake literal en datos de
 * decisión. Se excluyen: comentarios, el bloque canónico, copy localizada
 * (`es:`/`en:`, texto de UI) y utterance capturada / fixture
 * (`capture:`/`phrase:`/`userPhrase:`/`fluParticipa:`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WAKE_CONFIG_FILE = join(process.cwd(), 'src/voice/lib/fluConfig.js')
const WAKE_TOKEN = /\b(?:oye|ok|okay|hey)\s+(?:flu|flow|blue|flo)\b/i
const isCommentLine = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line)

/** Líneas con wake literal en datos de decisión (ver cabecera). */
export function wakeInternalLines(src: string): number[] {
  const out: number[] = []
  let inBlock = false
  let prevCapture = false
  src.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim()
    if (/const FLU_WAKE_WORDS\b/.test(t)) {
      inBlock = true
      prevCapture = false
      return
    }
    if (inBlock) {
      if (/^\s*\]\)/.test(raw)) inBlock = false
      return
    }
    if (isCommentLine(raw)) {
      prevCapture = false
      return
    }
    if (prevCapture) {
      prevCapture = false
      return
    }
    if (/\b(?:capture|phrase|userPhrase|fluParticipa)\s*:/.test(t)) {
      prevCapture = /capture\s*:\s*$/.test(t)
      return
    }
    if (/^(?:es|en):/.test(t)) return
    if (WAKE_TOKEN.test(t)) out.push(i + 1)
  })
  return out
}

describe('C56 wakeInternal — wakes solo desde FLU_WAKE_WORDS', () => {
  it('no hay wake literales en datos de decisión de fluConfig', () => {
    const lines = wakeInternalLines(readFileSync(WAKE_CONFIG_FILE, 'utf8'))
    expect(
      lines,
      `Wakes internas fuera de FLU_WAKE_WORDS (N=${lines.length}) en líneas: ${lines.join(', ')}`,
    ).toEqual([])
  })
})

describe('C56 wakeInternal — el detector no es decorativo', () => {
  const withBlock = 'const FLU_WAKE_WORDS = Object.freeze([\n  \'ok flu\',\n])\n'
  it('marca un wake literal tras el bloque canónico', () => {
    expect(wakeInternalLines(withBlock + "  'oye flu estas escuchando',\n")).toEqual([4])
  })
  it('ignora el bloque canónico', () => {
    expect(wakeInternalLines(withBlock)).toEqual([])
  })
  it('ignora comentarios y copy localizada', () => {
    expect(
      wakeInternalLines(withBlock + "  // di 'ok flu'\n  es: 'di ok flu adelante',\n"),
    ).toEqual([])
  })
  it('ignora captura y fixtures', () => {
    expect(
      wakeInternalLines(withBlock + "  capture:\n    'ok flu platicame',\n  phrase: 'ok flu x',\n"),
    ).toEqual([])
  })
})
