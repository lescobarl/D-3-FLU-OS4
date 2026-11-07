/**
 * FLU Playback - CLI de soporte.
 *
 * Uso:
 *   npm run playback -- --session <carpeta> [--tail ms] [--lead-in ms] [--headed]
 *
 * SOLO reproduce el audio de la sesión como micrófono virtual. No sustituye
 * el ASR, no inyecta transcripciones y no escribe filas: la app escucha el
 * audio con su motor normal.
 */
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import {
  DEFAULT_URL,
  loadSession,
  parseArgs,
  usage,
} from './playback/session.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SPEC = 'tests/e2e/playback.spec.ts'
const PLAYWRIGHT_CLI = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js')

function fail(message, code = 2) {
  console.error(`[playback] ${message}`)
  process.exit(code)
}

function run(command, args, env, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: false,
    })
    let finished = false
    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      child.kill()
      resolvePromise({ code: 2, timedOut: true })
    }, timeoutMs)
    child.on('error', (error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      console.error(`[playback] no se pudo lanzar Playwright: ${error.message}`)
      resolvePromise({ code: 2, timedOut: false })
    })
    child.on('close', (code) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolvePromise({ code: code ?? 2, timedOut: false })
    })
  })
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    fail(error.message)
  }
  if (options.help) {
    console.log(usage())
    return
  }

  let session
  try {
    session = loadSession(options.session)
  } catch (error) {
    fail(error.message)
  }

  const url = options.url || DEFAULT_URL
  let port = 5173
  try {
    const parsed = new URL(url)
    if (parsed.port) port = Number(parsed.port)
    else if (parsed.protocol === 'https:') port = 443
    else port = 80
  } catch {
    fail(`--url invalida: ${url}`)
  }

  const env = {
    PORT: String(port),
    FLU_PLAYBACK_SESSION: session.dir,
    FLU_PLAYBACK_LEAD_IN_MS: String(options.leadIn),
    FLU_PLAYBACK_TAIL_MS: String(options.tail),
    FLU_PLAYBACK_TIMEOUT_MS: String(options.timeout),
    FLU_PLAYBACK_HEADED: options.headed ? '1' : '0',
  }
  const runResult = await run(
    process.execPath,
    [PLAYWRIGHT_CLI, 'test', SPEC, '--workers=1', '--reporter=line'],
    env,
    options.timeout + 60000,
  )
  if (runResult.timedOut) fail('timeout global: Playwright no terminó', 2)

  process.exitCode = runResult.code ?? 2
}

main().catch((error) => {
  console.error(`[playback] ${error?.stack || error}`)
  process.exitCode = 2
})
