/**
 * voiceSingleSourceGuard — Invariante §9: UNA SOLA FUENTE DE VERDAD.
 *
 * Nace ROJO (§10.2): cuenta los duplicados por COMPORTAMIENTO (no por nombres
 * fijos) y falla mientras N>1, listando `archivo:línea:contenido`.
 *
 *   G1  1 almacén de conversación/transcripción (el motor NO almacena).
 *   G2  1 sola decisión de commit (App no re-decide).
 *   G3  1 sola derivación de query (`resolveFinalConversationAction`).
 *   G4  1 solo productor de escucha (`createSpeechRecognition`).
 *   G5  1 sola fuente de display (sin cascadas `live||last` en vistas).
 *   G6  Wake word SOLO desde config (sin literales fuera de fluConfig).
 *
 * Este guard NO valida runtime: es una barrera estructural anti-cascada (§8.6).
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'
import { ARBITER_DOMAINS, resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const FLU_CONFIG_REL = 'src/voice/lib/fluConfig.js'

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

/** Dueño único del reconocimiento del diario (alta por voz). */
export const DIARY_OWNER = 'src/core/diary/diaryIntentParser.ts'
/** Copias del patrón de comando de diario: regex que arranca en `^(?:verbos…)`. */
const DIARY_VERBOS = /\/\^\(\?:[^/\r\n]*\)[^/\r\n]*diario/i
/** Copias del prefijo directo: regex que arranca en `^diario`. */
const DIARY_PREFIJO = /\/\^diario\b/i
/**
 * Copias del patrón de comando de diario fuera del dueño, por COMPORTAMIENTO (la
 * forma de la regex, no el nombre con que se declare). Cualquier copia es una
 * ruta paralela: puede divergir del dueño en lo que acepta.
 */
export function diaryRouteOffenders(src: string, fileName: string): string[] {
  if (fileName === DIARY_OWNER) return []
  const out: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    const l = stripLineComment(line)
    if (DIARY_VERBOS.test(l) || DIARY_PREFIJO.test(l)) {
      out.push(`${fileName}:${i + 1}:${l.trim().slice(0, 100)}`)
    }
  })
  return out
}

/** Busca `re` en cada línea de `files` y devuelve `archivo:linea:contenido`. */
function grep(
  re: RegExp,
  files: string[],
  { strip = true }: { strip?: boolean } = {},
): string[] {
  const out: string[] = []
  for (const f of files) {
    fileLines(f).forEach((raw, index) => {
      const line = strip ? stripLineComment(raw) : raw
      re.lastIndex = 0
      if (re.test(line)) out.push(`${rel(f)}:${index + 1}:${line.trim().slice(0, 100)}`)
    })
  }
  return out
}

describe('voiceSingleSourceGuard — una sola fuente de verdad (§9)', () => {
  it('G1 — el motor no almacena conversación/transcripción (1 fuente: el store)', () => {
    // Refs con array propio en el pipeline de voz cuyo nombre sugiere conversación/log.
    const ownArrayRef = /const\s+([A-Za-z0-9_$]+)\s*=\s*useRef\(\s*\[\s*\]\s*\)/
    const findings: string[] = []
    for (const f of FILES) {
      fileLines(f).forEach((line, index) => {
        const m = ownArrayRef.exec(line)
        if (m && /(dialogue|conversation|transcript|logrow|rows|log)/i.test(m[1])) {
          findings.push(`${rel(f)}:${index + 1}:${m[1]} (almacén propio)`)
        }
      })
    }
    // Fachadas con getter/setter no-op (regresión §9; el setter ignora un param `_`).
    const facades = grep(/set\s+current\s*\(\s*_[A-Za-z0-9_$]*\s*\)/, FILES)
    const all = [...findings, ...facades.map((f) => `${f} (fachada no-op)`)]
    expect(
      all,
      `Almacenes propios del motor (N=${all.length}); debe quedar SOLO conversationHistory:\n  ${all.join('\n  ')}`,
    ).toEqual([])
  })

  it('G2 — App no re-decide el commit (obedece al motor)', () => {
    const app = join(SRC, 'App.tsx')
    const findings = grep(/spokenUtteranceRevision/, [app])
    expect(
      findings,
      `App re-decide dedup (N=${findings.length}); la decisión vive en el motor:\n  ${findings.join('\n  ')}`,
    ).toEqual([])
  })

  it('G3 — una sola derivación de la query a la IA', () => {
    const calls = grep(/resolveFinalConversationAction\s*\(/, FILES).filter(
      (f) => !/export function resolveFinalConversationAction/.test(f),
    )
    expect(
      calls,
      `Derivaciones de query duplicadas (N=${calls.length}); debe quedar 1:\n  ${calls.join('\n  ')}`,
    ).toHaveLength(1)
  })

  it('G4 — un solo punto de creación de escucha', () => {
    // La fábrica de Web Speech API SOLO se invoca en speechRecognitionLocal.
    // Todo consumidor (motor de voz, onboarding) usa acquireSpeechRecognition.
    const rawFactory = /createSpeechRecognition\s*\(/
    const central = 'src/voice/lib/speechRecognitionLocal.js'
    const offenders = FILES
      .filter((f) => rel(f) !== central && grep(rawFactory, [f]).length > 0)
      .map(rel)
    expect(
      offenders,
      `Fábricas de escucha fuera del módulo central (N=${offenders.length}), usa acquireSpeechRecognition:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('G5 — una sola fuente de display (sin cascadas en vistas)', () => {
    const candidates = FILES.filter(
      (f) => rel(f).startsWith('src/components/') || rel(f) === 'src/App.tsx',
    )
    const findings = grep(/liveTranscript\s*\|\|[\s\S]*lastTranscript/, candidates)
    expect(
      findings,
      `Cascadas de display duplicadas (N=${findings.length}); deben leer 1 selector:\n  ${findings.join('\n  ')}`,
    ).toEqual([])
  })

  it('G6 — wake word solo desde config', () => {
    const wakeWords: string[] = FLU_CONFIG?.voiceCommands?.wakeWords || []
    const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(['"\`])(${wakeWords.map(escape).join('|')})\\1`, 'i')
    const files = FILES.filter((f) => rel(f) !== FLU_CONFIG_REL)
    const findings = grep(re, files)
    expect(
      findings,
      `Wake word hardcodeada fuera de fluConfig (N=${findings.length}):\n  ${findings.join('\n  ')}`,
    ).toEqual([])
  })

  it('G7 — la barra de búsqueda es pura (sin almacén propio)', () => {
    const bar = join(SRC, 'components', 'WorkspaceSearch.tsx')
    const findings = grep(/useIntegrationStore/, [bar])
    expect(
      findings,
      `La barra cachea estado en el store (N=${findings.length}); recibe la frase canónica por props:\n  ${findings.join('\n  ')}`,
    ).toEqual([])
  })

  it('G8 — el diario se reconoce en una sola fuente (sin copias de su patrón)', () => {
    const offenders = FILES
      .filter((f) => rel(f) !== DIARY_OWNER)
      .flatMap((f) => diaryRouteOffenders(readFileSync(f, 'utf8'), rel(f)))
    expect(offenders, `Patrón de comando de diario copiado fuera de ${DIARY_OWNER} (N=${offenders.length}):\n  ${offenders.join('\n  ')}`).toEqual([])
    const owner = readFileSync(join(ROOT, DIARY_OWNER), 'utf8')
    expect(owner, 'el dueño debe publicar el resolver compartido').toContain('export function resolveDiaryVoiceIntent')
    expect(readFileSync(join(SRC, 'App.tsx'), 'utf8'), 'App debe reconocer el diario con la fuente única').toContain('resolveDiaryVoiceIntent')
  })

  it('G8 — el detector no es decorativo', () => {
    const copia = "const r = /^(?:escribe|anota)\\s+diario\\s*[:,-]?\\s+(.+)$/i.exec(x);"
    expect(diaryRouteOffenders(copia, 'src/App.tsx')).toHaveLength(1)
    expect(diaryRouteOffenders(copia, DIARY_OWNER)).toEqual([])
    expect(diaryRouteOffenders('const x = 1; // diario', 'src/App.tsx')).toEqual([])
  })

  it('G9 — el orden declarado del árbitro es el que se ejecuta', () => {
    // El array declara el ORDEN DE RESOLUCIÓN. Si se reordena la resolución sin
    // mover el array (o al revés), estos solapes reales lo dicen. Nació de un
    // defecto medido: el array describía el comportamiento ANTERIOR (navegación
    // al final) y quien lo creyera reintroducía el secuestro de comandos.
    const pos = (d: string) => (ARBITER_DOMAINS as readonly string[]).indexOf(d)
    expect(pos('config'), 'config es el primero').toBe(0)
    expect(pos('navigation'), 'el enunciado manda sobre la partida').toBeLessThan(pos('game'))
    expect(pos('diary'), 'el diario es más específico que la nota').toBeLessThan(pos('note'))
    expect(resolveDeterministicCommand('iniciar conversacion').domain).toBe('navigation')
    expect(resolveDeterministicCommand('anota en el diario que fui al parque').domain).toBe('diary')
  })
})
