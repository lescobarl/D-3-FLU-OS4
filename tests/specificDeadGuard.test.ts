/**
 * Guard T fix-muertos-basura — código muerto y basura específicos.
 *
 * Nace ROJO enumerando `archivo:símbolo:línea` de cada muerto presente y pasa a
 * VERDE cuando los tipos, stubs, deps, directorio e import muertos se eliminan
 * físicamente. Complementa (no sustituye) los guards C16/C17 ya congelados.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** Símbolos declarados sin implementación o sin consumidor (meta: 0 ocurrencias). */
const DEAD_SYMBOLS = [
  // src/types/fluWindow.d.ts — tipos declarados sin implementación.
  '__fluHandleReminderText',
  '__fluHandleTemporalText',
  '__fluHandleHorarioText',
  // src/voice/lib/listenLog.js — stubs/deprecados sin consumidor.
  'isMicRawConsoleEnabled',
  'logMicPacket',
  'logStreamPublish',
  'resetMicConsole',
  'printListenSummary',
  // src/voice/lib/micIngressLog.js — stub sin consumidor.
  'logMicIngress',
  // src/voice/lib/activeListen.js — deprecados/lectores sin consumidor.
  'appendNewHeard',
  'readSessionTranscript',
  'readDisplayText',
  'shouldEmitLog',
  // src/voice/lib/voiceCommands.js — wrapper deprecado sin consumidor.
  'getNavigationCommandSpeech',
]

const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs)$/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (SCAN_EXT.test(entry.name)) out.push(full)
  }
  return out
}

/** true si la línea es solo comentario (no código ejecutable). */
function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')
}

/**
 * Enumera `archivo:símbolo:línea` de cada símbolo muerto aún presente como
 * CÓDIGO en src/. Ignora comentarios: el criterio es código muerto, no texto.
 */
function deadHits(): string[] {
  const hits: string[] = []
  for (const abs of walk(join(ROOT, 'src'))) {
    const rel = abs.slice(ROOT.length + 1).replace(/\\/g, '/')
    readFileSync(abs, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (isCommentLine(line)) return
        for (const sym of DEAD_SYMBOLS) {
          if (line.includes(sym)) hits.push(`${rel}:${sym}:${i + 1}`)
        }
      })
  }
  return hits
}

describe('specificDeadGuard — sin código muerto ni basura específicos', () => {
  it('src/ no debe contener ningún símbolo muerto declarado', () => {
    const hits = deadHits()
    expect(
      hits,
      `Símbolos muertos que siguen existiendo (N=${hits.length}):\n  ${hits.join('\n  ')}`,
    ).toEqual([])
  })

  it('package.json no declara deps sin uso (jszip, ws)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const deps = pkg.dependencies ?? {}
    const unused = ['jszip', 'ws'].filter((name) => name in deps)
    expect(
      unused,
      `Deps declaradas sin uso (N=${unused.length}):\n  ${unused.join('\n  ')}`,
    ).toEqual([])
  })

  it('FluAvatarVoiceBridge no importa el símbolo muerto WELCOME_MESSAGE', () => {
    const src = readFileSync(join(ROOT, 'src', 'components', 'FluAvatarVoiceBridge.tsx'), 'utf8')
    const present = src.split(/\r?\n/).some((line) => line.includes('WELCOME_MESSAGE'))
    expect(present, 'Import muerto presente en src/components/FluAvatarVoiceBridge.tsx').toBe(false)
  })

  it('gemini.js no conserva el comentario obsoleto sobre generación de imágenes nativa', () => {
    const src = readFileSync(join(ROOT, 'src', 'voice', 'lib', 'gemini.js'), 'utf8')
    const obsolete = 'Ya no se usa la generación de imágenes nativa de Gemini'
    expect(
      src.includes(obsolete),
      'Comentario obsoleto presente en src/voice/lib/gemini.js',
    ).toBe(false)
  })

  it('la API viva de los módulos de voz sigue intacta (comportamiento)', async () => {
    const listen = await import('../src/voice/lib/listenLog.js')
    expect(typeof listen.fluEvent).toBe('function')
    expect(typeof listen.logMicRaw).toBe('function')
    expect('logMicPacket' in listen).toBe(false)
    expect('logStreamPublish' in listen).toBe(false)
    expect('printListenSummary' in listen).toBe(false)
    expect('isMicRawConsoleEnabled' in listen).toBe(false)

    const ingress = await import('../src/voice/lib/micIngressLog.js')
    expect(typeof ingress.logMicProducerRaw).toBe('function')
    expect('logMicIngress' in ingress).toBe(false)

    const commands = await import('../src/voice/lib/voiceCommands.js')
    expect(typeof commands.getCommandSpeech).toBe('function')
    expect('getNavigationCommandSpeech' in commands).toBe(false)

    const active = await import('../src/voice/lib/activeListen.js')
    expect(typeof active.mergeSpeechText).toBe('function')
    expect('appendNewHeard' in active).toBe(false)
    expect('readSessionTranscript' in active).toBe(false)
    expect('readDisplayText' in active).toBe(false)
    expect('shouldEmitLog' in active).toBe(false)
  })
})
