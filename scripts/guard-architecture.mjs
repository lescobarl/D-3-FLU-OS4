#!/usr/bin/env node
/**
 * Guard de arquitectura del repo.
 *
 * Objetivo único: impedir que vuelvan las rutas dobles y los imports a la
 * tubería vieja de conversación. No es un linter de estilo.
 *
 * Uso:
 *   node scripts/guard-architecture.mjs            # scan completo (CI)
 *   node scripts/guard-architecture.mjs --staged   # solo líneas añadidas (pre-commit)
 *
 * Sin dependencias: usa git + node.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const STAGED = process.argv.includes('--staged')
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx'])

/** Tubería vieja retirada: ningún archivo vivo puede importarla. */
const OLD_MODULES = [
  'conversationStream',
  'conversationStreamCommit',
  'conversationTurnRow',
  'conversationSession',
  'conversationIngressBridge',
  'activeListen',
  'turnTranscript',
  'transcriptIngress',
  'turnCommitPhrase',
  'turnStream',
  'turnSpeakerPreflight',
  'turnSpeakerCommit',
  'speakerDiarization',
  'preLaunchDelay',
  'recognitionBufferFlush',
  'turnIdentityPipeline',
  'micEventProducer',
  'captureDedup',
  'garbageTranscript',
  'ingressGuards',
  'eventQueue',
  'asrTurnSegmentation',
  'audioBufferFlush',
  'transcriptEventConsumer',
  'micIngressLog',
  'fluDevConsole',
  'fluTrace',
]

/**
 * Símbolos que deben tener UNA sola definición en src.
 * No se prohíbe que se importen/re-exporten; se prohíbe que se reimplementen.
 */
const OWNER_SYMBOLS = [
  'commitUserTurnRow',
  'renameVoiceRowsByKey',
  'commitVisibleTranscript',
  'normalizeMicText',
  'normalizeTranscriptText',
  'normalizeForMatch',
  'resolveConversationSpeaker',
  'resolveVoiceIdentity',
  'crearCajaDeLaFrase',
  'resolverEmisionDeLaCaja',
  'fraseDeCierreDeLocucion',
]

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', 'backups', 'test-results', '.git'])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (EXT.has(entry.slice(entry.lastIndexOf('.')))) out.push(full)
  }
  return out
}

function rel(file) {
  return relative(ROOT, file).replaceAll('\\', '/')
}

function countDefinitions(text, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\b`, 'g'),
    new RegExp(`\\b(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=`, 'g'),
    new RegExp(`\\b(?:export\\s+)?class\\s+${escaped}\\b`, 'g'),
    new RegExp(`\\b${escaped}\\s*:\\s*(?:async\\s*)?\\(`, 'g'),
  ]
  let count = 0
  for (const pattern of patterns) count += (text.match(pattern) || []).length
  return count
}

function oldImportNames(text) {
  const found = new Set()
  for (const name of OLD_MODULES) {
    const bare = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?:from\\s*['"][^'"]*|require\\(\\s*['"][^'"]*)${bare}(?:\\.(?:js|ts))?['"]`, 'g')
    if (re.test(text)) found.add(name)
  }
  return [...found]
}

function checkStaged() {
  const errors = []
  const diff = execFileSync('git', ['diff', '--cached', '--unified=0', '--no-color', '--', 'src'], { encoding: 'utf8' })
  const added = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  for (const line of added) {
    const imports = oldImportNames(line)
    if (imports.length) errors.push(`import viejo en línea añadida: ${line.trim()}`)
    if (/\bas any\b|@ts-ignore|@ts-expect-error/.test(line)) errors.push(`escape de tipos: ${line.trim()}`)
    if (/\b(?:localStorage|sessionStorage)\b/.test(line)) errors.push(`almacén directo: ${line.trim()}`)
  }
  const names = execFileSync('git', ['diff', '--cached', '--name-status', '--', 'src'], { encoding: 'utf8' })
  for (const row of names.split('\n').filter(Boolean)) {
    const [status, file] = row.split('\t')
    if (status === 'A' && /^src\/voice\/lib\//.test(file)) {
      errors.push(`archivo nuevo en la tubería vieja: ${file}`)
    }
  }
  return errors
}

function checkFull() {
  const errors = []
  const files = walk(SRC)
  const definitions = new Map(OWNER_SYMBOLS.map((symbol) => [symbol, []]))
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const imports = oldImportNames(text)
    for (const name of imports) errors.push(`${rel(file)} importa tubería vieja: ${name}`)
    for (const symbol of OWNER_SYMBOLS) {
      const count = countDefinitions(text, symbol)
      if (count > 0) definitions.get(symbol).push({ file: rel(file), count })
    }
  }
  for (const [symbol, defs] of definitions) {
    if (defs.length > 1) {
      errors.push(`dueño duplicado "${symbol}": ${defs.map((d) => `${d.file}(${d.count})`).join(', ')}`)
    }
  }
  return errors
}

const errors = STAGED ? checkStaged() : checkFull()
if (errors.length) {
  console.error(`[guard-architecture] ${errors.length} violación(es):`)
  for (const error of errors) console.error(` - ${error}`)
  process.exit(1)
}
console.log(`[guard-architecture] OK (${STAGED ? 'staged' : 'full'})`)
