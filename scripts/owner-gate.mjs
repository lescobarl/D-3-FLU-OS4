#!/usr/bin/env node
/**
 * Gate de DUEÑO para archivos nuevos.
 *
 * Un archivo nuevo bajo `src/` es una parada obligatoria (AGENTS.md, regla 10).
 * Este script se usa en tres puertas:
 *   - hook `PreToolUse` de `Write` (stdin): bloquea antes de crear el archivo.
 *   - `--staged`: bloquea el commit si el índice trae un archivo nuevo sin fila.
 *   - `--diff <base>`: bloquea el CI/PR si el rango trae un archivo nuevo sin fila.
 *
 * Uso:
 *   node scripts/owner-gate.mjs --path src/voice/conversation/nuevo.ts
 *   node scripts/owner-gate.mjs --staged
 *   node scripts/owner-gate.mjs --diff origin/main
 *   echo '{"tool_name":"Write","tool_input":{"file_path":"..."}}' \
 *     | node scripts/owner-gate.mjs
 *
 * Salida: 0 permite, 2 bloquea (stderr explica), 1 error de uso o de entrada.
 * El hook usa `onFailure: block`: un fallo del gate no deja pasar la escritura.
 *
 * Alcance: archivos de código (.ts/.tsx/.js/.jsx/.mjs/.cjs) bajo `src/`.
 * Los tests van en `tests/` y no pasan por este gate. Los modos `--staged` y
 * `--diff` cubren los archivos creados por `Bash`; el hook de `Write` no los ve.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT =
  process.env.CLAUDE_PROJECT_DIR ||
  resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = 'src/'
// `:(icase)` cierra el bypass de mayúsculas en sistemas insensibles a caso.
const SRC_PATHSPEC = ':(icase)src/'
const CONVERSATION_DIR = 'src/voice/conversation/'
const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i

/** Lee `--clave valor` o `--clave=valor`; null si no está. */
function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index !== -1) return process.argv[index + 1] ?? null
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return prefixed ? prefixed.slice(name.length + 1) : null
}

function usage() {
  return [
    'Uso: node scripts/owner-gate.mjs --path <archivo> [--map <mapa>]',
    '  o: node scripts/owner-gate.mjs --staged [--map <mapa>]',
    '  o: node scripts/owner-gate.mjs --diff <base> [--map <mapa>]',
    "  o: echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"...\"}}' | node scripts/owner-gate.mjs",
  ].join('\n')
}

/** Convierte la ruta del Write en una ruta relativa al repo, con `/`. */
function relativeToRoot(filePath) {
  const absolute = isAbsolute(filePath) ? filePath : resolve(ROOT, filePath)
  return relative(ROOT, absolute).split(sep).join('/')
}

/**
 * ¿La ruta aparece en una fila de tabla del mapa?
 * Dentro del módulo basta el nombre (`sesion.ts:90`); fuera, la ruta completa.
 */
function declaredInMap(mapText, rel) {
  const base = rel.split('/').pop()
  const wanted = rel.toLowerCase().startsWith(CONVERSATION_DIR)
    ? new Set([rel, base])
    : new Set([rel])
  for (const line of mapText.split(/\r?\n/)) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('|')) continue
    // Solo la columna Dueño declara; una mención en la nota no abre el gate.
    const ownerCell = trimmed.split('|')[2] ?? ''
    for (const match of ownerCell.matchAll(/`([^`]+)`/g)) {
      const token = match[1]
        .replace(/:\d+(?:-\d+)?$/, '')
        .replace(/^\.\//, '')
      if (wanted.has(token)) return true
    }
  }
  return false
}

function block(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

/** El hook entrega el evento por stdin; `--path` lo sustituye en pruebas. */
function readHookInput() {
  if (process.stdin.isTTY) return null
  try {
    const raw = readFileSync(0, 'utf8').trim()
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Cómo debe quedar la fila según la convención del mapa. */
function declarationHint(rel) {
  return rel.toLowerCase().startsWith(CONVERSATION_DIR)
    ? `\`${rel.split('/').pop()}:1\` \`simbolo\``
    : `\`${rel}:1\` \`simbolo\``
}

/** Lee el mapa una vez; si falta o no se puede leer, bloquea. */
function loadMap(mapPath, label) {
  const mapRel = relative(ROOT, mapPath).split(sep).join('/')
  if (!existsSync(mapPath)) {
    block(
      [
        `[owner-gate] BLOQUEADO (${label}): no existe ${mapRel}.`,
        'Sin mapa de dueños no puedo verificar si el archivo duplica una ruta.',
        `Crea ${mapRel} antes de añadir archivos a ${SRC_DIR}.`,
      ].join('\n'),
    )
  }
  try {
    return { mapText: readFileSync(mapPath, 'utf8'), mapRel }
  } catch (error) {
    block(
      `[owner-gate] BLOQUEADO (${label}): no pude leer ${mapRel}: ${error.message}`,
    )
  }
}

/** Archivos NUEVOS (A/C) del índice o del rango, con rutas relativas al repo. */
function addedPaths(args, label) {
  let out
  try {
    out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim()
    block(
      [
        `[owner-gate] BLOQUEADO (${label}): no pude leer los archivos nuevos.`,
        detail,
        'El gate falla cerrado: no dejo pasar sin verificar.',
      ].join('\n'),
    )
  }
  return out.split('\0').filter(Boolean)
}

/** Verifica una lista de rutas; bloquea si alguna no está declarada. */
function checkAddedPaths(paths, mapPath, label) {
  const codePaths = paths.filter(
    (rel) => rel.toLowerCase().startsWith(SRC_DIR) && CODE_EXT.test(rel),
  )
  if (codePaths.length === 0) {
    process.stdout.write(
      `[owner-gate] OK (${label}): 0 archivo(s) de código nuevo(s) bajo ${SRC_DIR}.\n`,
    )
    return 0
  }
  const { mapText, mapRel } = loadMap(mapPath, label)
  const offenders = codePaths.filter((rel) => !declaredInMap(mapText, rel))
  if (offenders.length === 0) {
    process.stdout.write(
      `[owner-gate] OK (${label}): ${codePaths.length} archivo(s) de código nuevo(s) bajo ${SRC_DIR}; todos declarados.\n`,
    )
    return 0
  }
  block(
    [
      `[owner-gate] BLOQUEADO (${label}): ${offenders.length} archivo(s) NUEVO(s) bajo ${SRC_DIR} sin dueño declarado en ${mapRel}:`,
      ...offenders.map((rel) => `  - ${rel}`),
      '',
      'Antes de commitear:',
      '1. Busca en el mapa la pregunta que responde cada archivo.',
      '2. Si ya hay un dueño, edítalo; no crees otro archivo.',
      '3. Si es un dueño nuevo, añade una fila a la tabla con: pregunta, dueño, consumidor único y kill list.',
      '4. Vuelve a intentar el commit.',
      '',
      'Alcance: archivos de código (.ts/.tsx/.js/.jsx/.mjs/.cjs) bajo src/.',
      'Los tests van en tests/ y no pasan por este gate.',
    ].join('\n'),
  )
}

function main() {
  const pathArg = argValue('--path')
  const mapArg = argValue('--map')
  const staged = process.argv.includes('--staged')
  const diffArg = argValue('--diff')
  const mapPath = resolve(
    ROOT,
    mapArg || process.env.OWNER_MAP || 'docs/OWNERS.md',
  )

  if (staged && diffArg) {
    process.stderr.write(`${usage()}\n`)
    return 1
  }
  if (process.argv.includes('--diff') && !diffArg) {
    process.stderr.write(`${usage()}\n`)
    return 1
  }

  if (staged || diffArg) {
    if (staged) {
      const paths = addedPaths(
        [
          'diff',
          '--cached',
          '--name-only',
          '--diff-filter=AC',
          '-z',
          '--',
          SRC_PATHSPEC,
        ],
        '--staged',
      )
      return checkAddedPaths(paths, mapPath, '--staged')
    }

    try {
      execFileSync(
        'git',
        ['rev-parse', '--verify', '--end-of-options', `${diffArg}^{commit}`],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch {
      block(
        [
          `[owner-gate] BLOQUEADO (--diff): la base "${diffArg}" no es un commit válido.`,
          'El gate falla cerrado: no puedo comparar el rango.',
        ].join('\n'),
      )
    }

    const paths = addedPaths(
      [
        'diff',
        '--name-only',
        '--diff-filter=AC',
        '-z',
        diffArg,
        '--',
        SRC_PATHSPEC,
      ],
      '--diff',
    )
    return checkAddedPaths(paths, mapPath, '--diff')
  }

  let target = pathArg
  if (!target) {
    const input = readHookInput()
    if (!input) {
      process.stderr.write(`${usage()}\n`)
      return 1
    }
    if (input.tool_name !== 'Write') return 0
    target = input.tool_input?.file_path
    if (!target) return 0
  }

  const rel = relativeToRoot(target)
  if (rel.startsWith('..')) return 0
  if (!rel.toLowerCase().startsWith(SRC_DIR)) return 0
  if (!CODE_EXT.test(rel)) return 0
  if (existsSync(resolve(ROOT, rel))) return 0

  const { mapText, mapRel } = loadMap(mapPath, 'Write')

  if (declaredInMap(mapText, rel)) return 0

  block(
    [
      `[owner-gate] Write BLOQUEADO: ${rel} es un archivo NUEVO y no está declarado en ${mapRel}.`,
      '',
      'Antes de crearlo:',
      '1. Busca en el mapa la pregunta que responde este archivo.',
      '2. Si ya hay un dueño, edítalo; no crees otro archivo.',
      `3. Si es un dueño nuevo, añade una fila a la tabla con: pregunta, ${declarationHint(rel)}, consumidor único y kill list.`,
      '4. Vuelve a intentar el Write.',
      '',
      'Alcance: archivos de código (.ts/.tsx/.js/.jsx/.mjs/.cjs) bajo src/.',
      'Los tests van en tests/ y no pasan por este gate.',
    ].join('\n'),
  )
}

process.exit(main())
