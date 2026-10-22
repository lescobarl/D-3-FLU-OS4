/**
 * FLU Playback - CLI de soporte.
 *
 * Uso:
 *   npm run playback -- --session <carpeta> [--mode clean-room|restore-start]
 *                      [--sr real|mute] [--headed] [--out <carpeta>]
 *                      [--lead-in ms] [--tail ms] [--dry-run]
 *
 * No toca producto. Valida la sesión, prepara artefactos y lanza el spec de
 * Playwright que reproduce el WAV como micrófono virtual.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import {
  DEFAULT_URL,
  defaultOutDir,
  loadSession,
  parseArgs,
  usage,
  writePaddedWav,
} from './playback/session.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SPEC = 'tests/e2e/playback.spec.ts'
const PLAYWRIGHT_CLI = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js')

function fail(message, code = 2) {
  console.error(`[playback] ${message}`)
  process.exit(code)
}

function copySource(session, out) {
  const sourceDir = join(out, 'source')
  mkdirSync(sourceDir, { recursive: true })
  for (const name of ['manifest.json', 'meta.json', 'turns.ndjson', 'events.ndjson']) {
    const file = join(session.dir, name)
    if (existsSync(file)) copyFileSync(file, join(sourceDir, name))
  }
  if (session.audioPath.toLowerCase().endsWith('.wav')) {
    copyFileSync(session.audioPath, join(sourceDir, 'audio.wav'))
  } else {
    copyFileSync(session.audioPath, join(sourceDir, 'audio.pcm'))
  }
}

function summary(session, options, out) {
  return {
    sessionId: session.sessionId,
    source: session.dir,
    out,
    schemaVersion: session.schemaVersion,
    mode: options.mode,
    sr: options.sr,
    audio: session.audio,
    sourceRows: session.sourceRows.length,
    hasBaseStart: session.hasBaseStart,
    fidelity: session.fidelity,
  }
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
  if (options.sr === 'local') {
    fail('--sr local no está implementado en Fase 1; usa real o mute.')
  }
  if (options.sr === 'real' && !options.headed) {
    console.warn('[playback] --sr real sin --headed: Chrome SR puede no estar disponible en headless.')
  }

  let session
  try {
    session = loadSession(options.session)
  } catch (error) {
    fail(error.message)
  }
  if (options.mode === 'restore-start' && !session.hasBaseStart) {
    fail('restore-start exige un snapshot base-start; esta sesión no lo tiene. Usa clean-room.')
  }

  const out = defaultOutDir(options.out, session)
  mkdirSync(out, { recursive: true })
  copySource(session, out)

  let realWav = null
  if (options.sr === 'real') {
    const leadIn = options.leadIn > 0 ? options.leadIn : 10000
    realWav = writePaddedWav(session.audioPath, join(out, 'padded.wav'), leadIn, 2000)
    options.leadIn = leadIn
  }

  const info = summary(session, options, out)
  info.realWav = realWav
  writeFileSync(join(out, 'source.json'), JSON.stringify(info, null, 2))
  if (options.dryRun) {
    console.log(JSON.stringify(info, null, 2))
    return
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

  console.log(`[playback] sesión ${session.sessionId} (${session.audio.seconds.toFixed(2)} s) -> ${out}`)
  console.log(`[playback] modo=${options.mode} sr=${options.sr} url=${url}`)
  if (!session.fidelity.complete) {
    console.warn('[playback] AVISO: sesión sin fidelidad completa (appCommit/configHash desconocidos).')
  }

  const env = {
    PORT: String(port),
    FLU_PLAYBACK_SESSION: session.dir,
    FLU_PLAYBACK_OUT: out,
    FLU_PLAYBACK_MODE: options.mode,
    FLU_PLAYBACK_SR: options.sr,
    FLU_PLAYBACK_LEAD_IN_MS: String(options.leadIn),
    FLU_PLAYBACK_TAIL_MS: String(options.tail),
    FLU_PLAYBACK_TIMEOUT_MS: String(options.timeout),
    FLU_PLAYBACK_HEADED: options.headed ? '1' : '0',
    FLU_PLAYBACK_NO_CAPTURE: options.noCapture ? '1' : '0',
    FLU_PLAYBACK_REAL_WAV: realWav?.path || '',
    FLU_PLAYBACK_REAL_LEAD_IN_MS: realWav ? String(options.leadIn) : '0',
  }
  const runResult = await run(
    process.execPath,
    [PLAYWRIGHT_CLI, 'test', SPEC, '--workers=1', '--reporter=line'],
    env,
    options.timeout + 60000,
  )
  if (runResult.timedOut) fail('timeout global: Playwright no terminó', 2)

  const resultPath = join(out, 'result.json')
  if (!existsSync(resultPath)) {
    fail(`Playwright terminó (${runResult.code}) sin result.json; revisa la salida.`, 2)
  }
  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        mode: result.mode,
        sr: result.sr,
        rows: result.rows?.length || 0,
        ui: result.ui?.length || 0,
        events: result.artifacts?.events ? 'events.ndjson' : null,
        out,
        errors: result.errors,
      },
      null,
      2,
    ),
  )
  process.exitCode = result.ok ? 0 : 1
}

main().catch((error) => {
  console.error(`[playback] ${error?.stack || error}`)
  process.exitCode = 2
})
