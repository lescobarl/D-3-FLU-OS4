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
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'
import { ARBITER_DOMAINS, resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter'
import { resolveConfigCommandFromText } from '../src/voice/lib/configCommands'
import { detectNextSpeakerPhrase } from '../src/voice/lib/activeListen'
import { VOICE_CONFIG_CATALOG } from '../src/core/config/voiceConfigCatalog'
import { getGameEngine } from '../src/core/games/gameCatalog'
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore'
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const FLU_CONFIG_REL = 'src/voice/lib/fluConfig.js'

const FILES = walkFiles(SRC, /\.(ts|tsx|js|jsx|mjs)$/)
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

/**
 * Frases declaradas como comando en config que NO reaccionan. Solo mira las
 * entradas del catalogo de tipo `action`: son las que declaran su lista de
 * frases en `FLU_CONFIG.voiceCommands[clave]` y no necesitan valor aparte.
 * Cualquier frase de esa lista que no resuelva es interface declarada y muerta.
 */
export function declaredPhrasesWithoutEffect(
  config: unknown = FLU_CONFIG,
  resolve: (text: string) => unknown = resolveConfigCommandFromText,
): string[] {
  const out: string[] = []
  const voiceCommands = (config as { voiceCommands?: Record<string, unknown> })?.voiceCommands || {}
  for (const entry of VOICE_CONFIG_CATALOG) {
    if ((entry as { tipo?: string })?.tipo !== 'action') continue
    const clave = String((entry as { clave?: string })?.clave || '')
    const phrases = voiceCommands[clave]
    if (!Array.isArray(phrases)) continue
    for (const phrase of phrases as string[]) {
      if (!String(phrase || '').trim()) continue
      if (!resolve(String(phrase))) out.push(`${clave}: "${phrase}"`)
    }
  }
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

  it('G10 — todo comando declarado en config reacciona (sin config muerta)', () => {
    const muertas = declaredPhrasesWithoutEffect()
    expect(
      muertas,
      `Frases declaradas como comando que NO reaccionan (N=${muertas.length}):\n  ${muertas.join('\n  ')}`,
    ).toEqual([])
  })

  it('G10 — el detector no es decorativo', () => {
    const config = { voiceCommands: { resetAvatarColors: ['restablecer colores del avatar'] } }
    expect(declaredPhrasesWithoutEffect(config, () => null), 'si el resolver no responde, lo marca').toHaveLength(1)
    expect(declaredPhrasesWithoutEffect(config, () => ({ clave: 'resetAvatarColors' }))).toEqual([])
  })
})

// ------------------------------------------------------------
// G11 - Las frases de mando de turno declaradas en la config tienen lector.
// 'nextSpeaker' no lo resuelve el arbitro (es control de TURNO, no un dominio):
// lo consume 'detectNextSpeakerPhrase' en la capa de turno, ANTES de que la
// navegacion o el juego vean el texto. Una frase declarada que su consumidor no
// reconoce es config muerta y aqui se cae.
// ------------------------------------------------------------
describe('G11 voiceSingleSource - las frases de nextSpeaker declaradas tienen consumidor', () => {
    it('detectNextSpeakerPhrase reconoce TODAS las frases declaradas', () => {
        const phrases: readonly string[] = FLU_CONFIG.voiceCommands.nextSpeaker || []
        expect(phrases.length).toBeGreaterThan(0)
        const sinLector = phrases.filter((p) => !detectNextSpeakerPhrase(`oye flu ${p}`))
        expect(sinLector, `frases sin lector: ${sinLector.join(', ')}`).toEqual([])
    })

    it('el detector no es decorativo', () => {
        expect(detectNextSpeakerPhrase('oye flu pon una alarma a las siete')).toBeFalsy()
    })

    // Defecto MEDIDO en el log del dueno (2026-10-12 21:16, sesion de prueba):
    // mientras dictaba "en la ultima frase no hay ni cambio de hablante ni ni silencio
    // para que lo escriba" el commit salio `src=explicit-next name="Hablante 2"` y la
    // sesion (UNA sola voz) quedo partida en "Hablante 1"/"Hablante 2"/"Luis".
    // El cue era una MENCION dentro del dictado, no una ORDEN: la orden ABRE el mandato.
    it('una MENCION del cue dentro del dictado NO es una orden de cambio de hablante', () => {
        const dictado =
            'en la ultima frase no hay ni cambio de hablante ni ni silencio para que lo escriba entonces eso esta provocando delay'
        expect(
            detectNextSpeakerPhrase(dictado),
            'mencionar "cambio de hablante" no ordena cambiar de hablante',
        ).toBe(false)
        // La ORDEN sigue reconociendose: el mandato abre con el cue.
        expect(detectNextSpeakerPhrase('ok flu cambio de hablante')).toBe(true)
        expect(detectNextSpeakerPhrase('ahora habla otra persona')).toBe(true)
    })
})

// ------------------------------------------------------------
// G12 - Con una partida ACTIVA, un comando que OTRO dominio sabe ejecutar no
// puede ser consumido por el juego (regla: "permite ejecutar cualquier comando").
// Defecto real (portal 11:19): con la loteria abierta, "agrega guitarra en la
// nota" no lo reconocia ningun dominio y el juego lo tomaba como jugada
// (respondia "La carta es..."), asi que la nota se perdia. Las notas y la IA
// deben seguir accesibles con la partida en curso.
// ------------------------------------------------------------
describe('G12 voiceSingleSource - el juego no secuestra comandos de otros dominios', () => {
    function conLoteriaActiva(fn: () => void) {
        const engine = getGameEngine('loteria' as Parameters<typeof getGameEngine>[0])
        expect(engine, 'el motor de loteria existe').toBeTruthy()
        if (!engine) return
        const session = engine.createSession({})
        engine.start(session, {})
        setActiveGameSession(session)
        try {
            fn()
        } finally {
            clearActiveGameSession()
        }
    }

    it('las notas generales llegan al dominio note con la partida activa', () => {
        conLoteriaActiva(() => {
            for (const frase of [
                'agrega guitarra en la nota',
                'en la nota adicionale guitarra',
                'anota guitarra',
            ]) {
                expect(resolveDeterministicCommand(frase).domain, `"${frase}" debe ser nota`).toBe('note')
            }
        })
    })

    it('el motor sigue mandando en lo suyo: su comando es turno del juego', () => {
        conLoteriaActiva(() => {
            const resuelto = resolveDeterministicCommand('siguiente carta')
            expect(resuelto.domain).toBe('game')
            expect((resuelto.action as { action?: string })?.action).toBe('turn')
        })
    })

    it('cambiar de juego y terminarlo con la partida activa', () => {
        conLoteriaActiva(() => {
            const cambio = resolveGameCommandFromText('cambia a trivia')
            expect(cambio?.action, '"cambia a trivia" es un CAMBIO, no una jugada').toBe('switch')
            expect(cambio?.gameId).toBe('trivia')
            expect(resolveGameCommandFromText('trivia')?.action).toBe('switch')
            expect(resolveGameCommandFromText('terminar el juego')?.action).toBe('end')
            expect(resolveGameCommandFromText('para el juego')?.action).toBe('end')
            // El motor conserva su prioridad: el nombre del juego activo es SU
            // comando (en la loteria, "loteria" canta la carta).
            expect(resolveGameCommandFromText('loteria')?.action).toBe('turn')
            expect(resolveGameCommandFromText('siguiente carta')?.action).toBe('turn')
        })
    })

    it('la orden de cambio no secuestra conversacion sin alias de juego', () => {
        conLoteriaActiva(() => {
            // Comandos de config DECLARADOS: los resuelve su dueno, no el juego.
            expect(resolveGameCommandFromText('restablece los colores del avatar')).toBeNull()
            expect(resolveGameCommandFromText('resetear colores')).toBeNull()
            expect(resolveGameCommandFromText('colores por defecto')).toBeNull()
            // Navegacion DECLARADA (web): tambien se ejecuta durante la partida.
            expect(resolveGameCommandFromText('abre youtube')).toBeNull()
            expect(resolveGameCommandFromText('navega a wikipedia')).toBeNull()
            // Sin alias de juego, "cambia…" sigue siendo conversacion del jugador.
            expect(resolveGameCommandFromText('cambia el color')).toEqual(
                expect.objectContaining({ gameId: 'loteria', action: 'turn' }),
            )
        })
    })

    it('el guard no es decorativo: sin partida activa la loteria no arranca sola', () => {
        clearActiveGameSession()
        expect(resolveDeterministicCommand('agrega guitarra en la nota').domain).toBe('note')
        expect(resolveDeterministicCommand('siguiente carta').domain).not.toBe('game')
    })
})
