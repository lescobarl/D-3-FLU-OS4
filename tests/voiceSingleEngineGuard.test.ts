/**
 * voiceSingleEngineGuard — Objetivo de la unificación:
 *   (1) UN solo motor de escucha (una captura + un transcriptor).
 *   (2) UNA sola fuente de verdad para la query (deriva de la fila canónica).
 *
 * Nace ROJO (§10.2). Se pone verde por hitos; mientras haya N>1, lista
 * `archivo:línea:contenido`.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p)
  }
  return acc
}

const FILES = walk(SRC)
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/')
const fileLines = (f: string) => readFileSync(f, 'utf8').split(/\r?\n/)
const stripLineComment = (line: string) => {
  const trimmed = line.trim()
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}
function grep(re: RegExp, files: string[] = FILES): string[] {
  const out: string[] = []
  for (const f of files) {
    fileLines(f).forEach((raw, index) => {
      const line = stripLineComment(raw)
      re.lastIndex = 0
      if (re.test(line)) out.push(`${rel(f)}:${index + 1}:${line.trim().slice(0, 110)}`)
    })
  }
  return out
}
const count = (re: RegExp, files?: string[]) => grep(re, files).length

describe('voiceSingleEngineGuard — 1 motor + 1 fuente de verdad', () => {
  it('E1 — el motor operativo adquiere Chrome SR exactamente una vez', () => {
    const motor = join(SRC, 'voice', 'hooks', 'useFluVoiceAssistant.js')
    const acquisitions = grep(/acquireSpeechRecognition\s*\(/, [motor])
    expect(
      acquisitions.length,
      `El motor debe adquirir Chrome SR en UN solo punto (N=${acquisitions.length}):\n  ${acquisitions.join('\n  ')}`,
    ).toBe(1)
  })

  it('E2 — el motor es Chrome SR (no Whisper)', () => {
    const motor = join(SRC, 'voice', 'hooks', 'useFluVoiceAssistant.js')
    const whisper = grep(/createWhisperRecognitionEngine/, [motor])
    expect(
      whisper,
      `El motor no debe usar el motor Whisper (N=${whisper.length}):\n  ${whisper.join('\n  ')}`,
    ).toEqual([])
    const sr = grep(/window\.SpeechRecognition|window\.webkitSpeechRecognition/, [motor])
    expect(
      sr.length,
      `El motor debe exigir/consultar SpeechRecognition (N=${sr.length})`,
    ).toBeGreaterThanOrEqual(1)
  })

  it('E3 — sin selección dual de fuente de transcripción', () => {
    const findings = grep(/commandsFromBrowser|conversationFromStream|shouldIngestBrowserConversation|shouldIngestStreamTranscript/)
    expect(
      findings,
      `Selección dual de transcriptor (N=${findings.length}):\n  ${findings.join('\n  ')}`,
    ).toEqual([])
  })

  it('S1 — la query se deriva de la fila canónica (deriveQueryFromRow)', () => {
    const defined = count(/export function deriveQueryFromRow/)
    expect(defined, `deriveQueryFromRow debe definirse 1 vez (N=${defined})`).toBe(1)
    const used = grep(/deriveQueryFromRow\s*\(/).length - defined
    expect(used, `deriveQueryFromRow debe consumirse (N=${used})`).toBeGreaterThanOrEqual(1)
  })

  it('S2 — una sola derivación de query (resolveFinalConversationAction)', () => {
    const calls = grep(/resolveFinalConversationAction\s*\(/).filter(
      (f) => !/export function resolveFinalConversationAction/.test(f),
    )
    expect(
      calls.length,
      `Derivadores de query (N=${calls.length}); debe quedar 1 (dentro de deriveQueryFromRow):\n  ${calls.join('\n  ')}`,
    ).toBeLessThanOrEqual(1)
  })

  it('C1 — un solo punto de escritura de la frase visible', () => {
    const motor = join(SRC, 'voice', 'hooks', 'useFluVoiceAssistant.js')
    const direct = grep(/setLastTranscript\s*\(/, [motor])
    expect(
      direct.length,
      `setLastTranscript directo (N=${direct.length}); debe quedar 1 (dentro de commitVisibleTranscript):\n  ${direct.join('\n  ')}`,
    ).toBeLessThanOrEqual(1)
    const commit = grep(/commitVisibleTranscript\s*\(/, [motor])
    expect(
      commit.length,
      `commitVisibleTranscript debe consumirse (N=${commit.length})`,
    ).toBeGreaterThanOrEqual(1)
  })

  it('C2 — un solo escritor de clusters de hablante', () => {
    const motor = join(SRC, 'voice', 'hooks', 'useFluVoiceAssistant.js')
    const writes = grep(/speakerClustersRef\.current\s*=/, [motor])
    expect(
      writes.length,
      `Escrituras directas de speakerClustersRef (N=${writes.length}); debe quedar 1 (dentro de setSpeakerClusters):\n  ${writes.join('\n  ')}`,
    ).toBeLessThanOrEqual(1)
    const setter = grep(/setSpeakerClusters\s*\(/, [motor])
    expect(
      setter.length,
      `setSpeakerClusters debe consumirse (N=${setter.length})`,
    ).toBeGreaterThanOrEqual(1)
  })

  it('T1 — TTS por la ruta única (sin speechSynthesis.speak directo)', () => {
    const offenders = grep(/window\.speechSynthesis\.speak\s*\(/)
    expect(
      offenders,
      `TTS directo fuera de speakResponse (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('C3 — una sola vía de cálculo de firma por turno', () => {
    const motor = join(SRC, 'voice', 'hooks', 'useFluVoiceAssistant.js')
    const direct = grep(/computeAudioSignature\s*\(/, [motor])
    expect(
      direct.length,
      `computeAudioSignature directo (N=${direct.length}); debe quedar ≤2 (helper + matchSegmentNames):\n  ${direct.join('\n  ')}`,
    ).toBeLessThanOrEqual(2)
    const viaHelper = grep(/computeTurnSignature\s*\(/, [motor])
    expect(
      viaHelper.length,
      `computeTurnSignature debe consumirse (N=${viaHelper.length})`,
    ).toBeGreaterThanOrEqual(1)
  })
})
