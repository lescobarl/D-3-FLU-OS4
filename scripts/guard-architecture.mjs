#!/usr/bin/env node
/**
 * Guard de arquitectura del repo.
 *
 * Objetivo único: impedir que vuelvan las rutas dobles y los imports a la
 * tubería vieja de conversación. No es un linter de estilo.
 *
 * Uso:
 *   node scripts/guard-architecture.mjs            # scan completo del árbol (CI)
 *   node scripts/guard-architecture.mjs --staged   # diff + scan completo del índice (pre-commit)
 *
 * La lista de dueños sale de docs/OWNERS.md; no se hardcodea. En --staged, el
 * mapa y los archivos se leen del índice: el gate valida lo que se va a
 * commitear, no lo que hay en el árbol de trabajo.
 * Sin dependencias: usa git + node.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const STAGED = process.argv.includes('--staged')
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

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

const MAP_PATH = 'docs/OWNERS.md'

/** En --staged cuenta el mapa del índice, no el del árbol de trabajo. */
function mapText() {
  if (STAGED) {
    try {
      return execFileSync('git', ['show', `:${MAP_PATH}`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      const detail = String(error.stderr || error.message || '').trim()
      throw new Error(`no puedo leer ${MAP_PATH} del índice: ${detail}`)
    }
  }
  const mapPath = join(ROOT, MAP_PATH)
  try {
    return readFileSync(mapPath, 'utf8')
  } catch (error) {
    throw new Error(`no puedo leer ${rel(mapPath)}: ${error.message}`)
  }
}

/**
 * Símbolos que deben tener UNA sola definición en src, derivados del mapa de
 * dueños. No se prohíbe que se importen/re-exporten; se prohíbe que se
 * reimplementen. El mapa es la fuente: una lista hardcodeada se desincroniza.
 */
export function mapOwnerSymbols(text = mapText()) {
  const symbols = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    const parts = line.split('|')
    if (parts.length < 4) continue
    const owner = parts[2]
    for (const match of owner.matchAll(/`([^`]+)`/g)) {
      const token = match[1].trim()
      if (!/^[A-Za-z_$][\w$]*$/.test(token)) continue
      symbols.add(token)
    }
  }
  if (symbols.size === 0) {
    throw new Error('el mapa no declara símbolos dueños')
  }
  return [...symbols].sort()
}

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', 'backups', 'test-results', '.git'])

/**
 * Unico fichero que puede nombrar el almacenamiento del navegador: es la
 * puerta que el resto importa. `localStorageGatewayGuard` ya impone ese
 * contrato; el chequeo staged no debe marcar a la propia puerta.
 */
const STORAGE_GATEWAY = 'src/core/storage/localStore.ts'

/**
 * La única puerta de entrada al módulo CONVERSACIÓN desde fuera. Un archivo
 * externo que importe `conversation/<interno>` está creando una segunda ruta;
 * solo puede importar la fachada (`conversation/index`).
 */
const CONVERSATION_DIR = 'src/voice/conversation/'
const CONVERSATION_FACADE = 'src/voice/conversation/index.ts'

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

export function countDefinitions(text, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`\\b(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s*\\*?\\s+${escaped}\\b`, 'g'),
    new RegExp(`\\b(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\b`, 'g'),
    new RegExp(`\\b(?:export\\s+(?:default\\s+)?)?class\\s+${escaped}\\b`, 'g'),
    new RegExp(`\\b${escaped}\\s*:\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::\\s*[^={]+)?=>\\s*\\{`, 'g'),
    new RegExp(`\\b${escaped}\\s*:\\s*(?:async\\s*)?function\\s*\\([^)]*\\)\\s*\\{`, 'g'),
    // Método de clase u objeto: `metodo(args) {`, `async metodo(args): T {`,
    // `private metodo(...) {`. Anclado a inicio de línea y con el `{` en la
    // misma línea o la siguiente: una firma de interfaz no cuenta, y el tipo de
    // retorno no puede "saltar" hasta el cuerpo de otra función.
    new RegExp(`^[ \\t]*(?:(?:public|private|protected|static|async|get|set|readonly|override)[ \\t]+)*#?${escaped}[ \\t]*\\([^)]*\\)[ \\t]*(?::[^{\\n]+)?(?:\\r?\\n[ \\t]*)?\\{`, 'gm'),
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

/**
 * Specifiers que importan un archivo interno del módulo CONVERSACIÓN desde
 * fuera. Permitido: `.../conversation` (directorio) y `.../conversation/index`.
 */
export function conversationInternalImports(text) {
  const found = new Set()
  const re = /(?:from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g
  let match
  while ((match = re.exec(text))) {
    const spec = match[1].split(/[?#]/)[0]
    const idx = spec.lastIndexOf('conversation/')
    if (idx === -1) continue
    const rest = spec.slice(idx + 'conversation/'.length)
    if (!rest) continue
    const first = rest.split('/')[0]
    if (first === 'index' || first === 'index.ts' || first === 'index.js') continue
    found.add(match[1])
  }
  return [...found]
}

function checkStaged() {
  const errors = []
  const diff = execFileSync('git', ['diff', '--cached', '--unified=0', '--no-color', '--', 'src'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  let currentFile = ''
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      currentFile = raw.slice(6).trim()
      continue
    }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue
    const line = raw
    const imports = oldImportNames(line)
    if (imports.length) errors.push(`import viejo en lÃ­nea aÃ±adida: ${line.trim()}`)
    if (/\bas any\b|@ts-ignore|@ts-expect-error/.test(line)) errors.push(`escape de tipos: ${line.trim()}`)
    if (currentFile !== STORAGE_GATEWAY && /\b(?:localStorage|sessionStorage)\b/.test(line)) {
      errors.push(`almacÃ©n directo: ${line.trim()}`)
    }
    if (!currentFile.startsWith(CONVERSATION_DIR)) {
      for (const spec of conversationInternalImports(line)) {
        errors.push(`import interno del módulo: ${spec} (usa ${CONVERSATION_FACADE})`)
      }
    }
  }
  const names = execFileSync('git', ['diff', '--cached', '--name-status', '--', 'src'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  for (const row of names.split('\n').filter(Boolean)) {
    const [status, file] = row.split('\t')
    if (status === 'A' && /^src\/voice\/lib\//.test(file)) {
      errors.push(`archivo nuevo en la tubería vieja: ${file}`)
    }
  }
  return errors
}

/** Archivos del árbol de trabajo, con la forma que consume checkFull. */
function treeSources() {
  return walk(SRC).map((file) => ({
    path: rel(file),
    text: readFileSync(file, 'utf8'),
  }))
}

/**
 * Archivos del índice, con la forma que consume checkFull. En un commit
 * parcial el índice ES el commit: el árbol de trabajo puede tener cambios que
 * no se van a commitear y no deben tapar una violación.
 */
function indexSources() {
  const listing = execFileSync('git', ['ls-files', '-s', '-z', '--', 'src'], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  })
  const entries = []
  for (const record of listing.toString('utf8').split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const [mode, sha, stage] = record.slice(0, tab).split(' ')
    const path = record.slice(tab + 1)
    if (stage !== '0') continue
    if (mode !== '100644' && mode !== '100755') continue
    if (/^0+$/.test(sha)) continue
    if (!EXT.has(path.slice(path.lastIndexOf('.')))) continue
    entries.push({ path, sha })
  }
  if (entries.length === 0) return []

  const input = `${entries.map((entry) => entry.sha).join('\n')}\n`
  const batch = execFileSync('git', ['cat-file', '--batch'], {
    cwd: ROOT,
    input,
    maxBuffer: 256 * 1024 * 1024,
  })
  const sources = []
  let offset = 0
  for (const entry of entries) {
    const headerEnd = batch.indexOf(0x0a, offset)
    if (headerEnd === -1) {
      throw new Error(`respuesta truncada de git cat-file para ${entry.path}`)
    }
    const header = batch.subarray(offset, headerEnd).toString('utf8')
    const [sha, type, sizeText] = header.split(' ')
    const size = Number(sizeText)
    if (sha !== entry.sha || type !== 'blob' || !Number.isInteger(size) || size < 0) {
      throw new Error(`no puedo leer ${entry.path} del índice: ${header}`)
    }
    const start = headerEnd + 1
    const end = start + size
    if (end > batch.length || batch[end] !== 0x0a) {
      throw new Error(`respuesta truncada de git cat-file para ${entry.path}`)
    }
    sources.push({ path: entry.path, text: batch.subarray(start, end).toString('utf8') })
    offset = end + 1
  }
  return sources
}

export function checkFull(ownerSymbols, sources) {
  const errors = []
  const definitions = new Map(ownerSymbols.map((symbol) => [symbol, []]))
  for (const { path, text } of sources) {
    const imports = oldImportNames(text)
    for (const name of imports) errors.push(`${path} importa tubería vieja: ${name}`)
    if (!path.startsWith(CONVERSATION_DIR)) {
      for (const spec of conversationInternalImports(text)) {
        errors.push(`${path} importa interno del módulo: ${spec} (usa ${CONVERSATION_FACADE})`)
      }
    }
    for (const symbol of ownerSymbols) {
      const count = countDefinitions(text, symbol)
      if (count > 0) definitions.get(symbol).push({ file: path, count })
    }
  }
  for (const [symbol, defs] of definitions) {
    const total = defs.reduce((sum, def) => sum + def.count, 0)
    if (total === 0) {
      errors.push(`dueño declarado sin definición "${symbol}"`)
    } else if (defs.length > 1) {
      errors.push(`dueño duplicado "${symbol}": ${defs.map((d) => `${d.file}(${d.count})`).join(', ')}`)
    } else if (total > 1) {
      errors.push(`dueño definido ${total} veces en ${defs[0].file}: "${symbol}"`)
    }
  }
  return errors
}

/** Ejecuta el gate con el modo pedido. Devuelve el código de salida. */
function main() {
  let ownerSymbols
  let sources
  let errors
  try {
    ownerSymbols = mapOwnerSymbols()
    sources = STAGED ? indexSources() : treeSources()
    errors = STAGED
      ? [...checkStaged(), ...checkFull(ownerSymbols, sources)]
      : checkFull(ownerSymbols, sources)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[guard-architecture] BLOQUEADO: ${detail}`)
    return 1
  }
  if (errors.length) {
    console.error(`[guard-architecture] ${errors.length} violación(es):`)
    for (const error of errors) console.error(` - ${error}`)
    return 1
  }
  console.log(
    `[guard-architecture] OK (${STAGED ? 'staged + full' : 'full'}): ${ownerSymbols.length} dueño(s) del mapa.`,
  )
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) process.exit(main())
