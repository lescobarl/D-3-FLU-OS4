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
import { readFileSync, readdirSync } from 'node:fs'
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

/**
 * Fallback de wake DESNUDO: un literal de wake usado como sustituto de
 * `voiceCommands.wakeWords` cuando la lista viene vacia. Es el hueco que C56 no
 * veia: WAKE_TOKEN exige un wake COMPLETO ("ok flu"), asi que
 * `wakeWords?.[0] ?? 'FLU'` pasaba desapercibido (P5.1). La fuente unica es la
 * primera entrada de FLU_WAKE_WORDS (o cualquiera de sus tokens).
 */
const WAKE_FALLBACK_RE = /wakeWords[\s\S]{0,120}?(?:\|\||\?\?)\s*['"`]?\s*(?:(?:oye|ok|okay|hey)\s+)?(?:flu|flow|blue|flo)['"`]?\b/i

export function bareWakeFallbackLines(src: string): number[] {
  const out: number[] = []
  src.split(/\r?\n/).forEach((raw, i) => {
    if (isCommentLine(raw)) return
    if (WAKE_FALLBACK_RE.test(raw)) out.push(i + 1)
  })
  return out
}

const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs)$/

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(full))
    else if (SCAN_EXT.test(entry.name)) found.push(full)
  }
  return found
}

describe('P5.1 wakeInternal - sin fallback de wake literal', () => {
  it('src/ no sustituye voiceCommands.wakeWords por un literal de wake', () => {
    const root = process.cwd()
    const hits: string[] = []
    for (const abs of walk(join(root, 'src'))) {
      const rel = abs.slice(root.length + 1).replace(/\\/g, '/')
      bareWakeFallbackLines(readFileSync(abs, 'utf8')).forEach((n) => hits.push(`${rel}:${n}`))
    }
    expect(
      hits,
      `Fallback de wake literal (N=${hits.length}):\n  ${hits.join('\n  ')}\n` +
        'La fuente unica es FLU_WAKE_WORDS: usa getCanonicalWakeWord().',
    ).toEqual([])
  })
})

describe('P5.1 wakeInternal - el detector no es decorativo', () => {
  it('marca los dos fallbacks que existian (?? y ||)', () => {
    expect(bareWakeFallbackLines("const w = C?.voiceCommands?.wakeWords?.[0] ?? 'FLU'")).toEqual([1])
    expect(bareWakeFallbackLines("const w = C.voiceCommands.wakeWords?.[0] || 'FLU';")).toEqual([1])
  })
  it('marca tambien un wake completo como fallback', () => {
    expect(bareWakeFallbackLines("const w = vc.wakeWords[0] || 'ok flu'")).toEqual([1])
  })
  it('no marca derivar de la fuente unica sin fallback', () => {
    expect(bareWakeFallbackLines('  wakeWords: [...FLU_WAKE_WORDS],')).toEqual([])
    expect(bareWakeFallbackLines('const w = FLU_CONFIG.voiceCommands?.wakeWords?.[0]')).toEqual([])
  })
  it('no marca un default vacio (|| [])', () => {
    expect(bareWakeFallbackLines('const wakeWords = vc.wakeWords || []')).toEqual([])
  })
  it('ignora comentarios', () => {
    expect(bareWakeFallbackLines("// antes: wakeWords?.[0] ?? 'FLU'")).toEqual([])
  })
})
