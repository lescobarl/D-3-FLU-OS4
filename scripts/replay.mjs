#!/usr/bin/env node
/**
 * `npm run replay -- --session <carpeta> --mode vectors [--report <archivo>]`
 *
 * Replay de HABLANTES: re-ejecuta el resolutor REAL sobre el estado previo
 * reconstruido. Los modos `events` y `playback` (filas y caja por el ingress)
 * se retiraron con la tuberia vieja de conversacion (corte 2026-10-25): el
 * producto mide ahora con `npm run playback` y los tests del modulo.
 *
 * Piezas (una de cada, sin rutas dobles):
 *   loader     -> scripts/replay/loadSession.mjs      (manifiesto + NDJSON, sesion completa)
 *   runner     -> scripts/replay/vectorsRunner.mjs    (hablantes: resolutor real + estado previo)
 *   comparador -> scripts/replay/compareExpected.mjs  (hablantes)
 *   reporte    -> scripts/replay/report.mjs           (report.json + tabla)
 *
 * Exit codes: 0 = coincide · 1 = hay diferencias · 2 = sesion invalida, cobertura
 * parcial o TIMEOUT.
 *
 * Flags manuales (nunca automaticos):
 *   --stamp-manifest            marca un manifiesto antiguo con schemaVersion/fidelidad
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadSession, manifestFidelity, SessionError, SUPPORTED_MANIFEST_VERSIONS } from './replay/loadSession.mjs'
import { compararSpeakers, locucionesConEtiquetasDistintas } from './replay/compareExpected.mjs'
import { buildReport, printReport, writeReport } from './replay/report.mjs'

const MODES = ['vectors']
/** Tope de pared por defecto del replay (ms). Se cambia con `--timeout`. */
const DEFAULT_TIMEOUT_MS = 120000

function parseArgs(argv = []) {
  const args = { mode: 'vectors', timeoutMs: DEFAULT_TIMEOUT_MS }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const next = () => argv[++i]
    if (key === '--session') args.session = next()
    else if (key === '--mode') args.mode = next()
    else if (key === '--expected') args.expected = next()
    else if (key === '--report') args.report = next()
    else if (key === '--draft-expected') args.draftExpected = next()
    else if (key === '--stamp-manifest') args.stampManifest = true
    else if (key === '--timeout') args.timeoutMs = Number(next())
    else if (key === '--help' || key === '-h') args.help = true
  }
  return args
}

function usage() {
  return [
    'uso: npm run replay -- --session <carpeta> --mode vectors [--report <archivo>]',
    '',
    '  --session <carpeta>        carpeta de la grabacion (manifest.json + turns.ndjson)',
    '  --mode vectors             hablantes: reconstruye el estado previo y llama al resolutor real',
    '  --report <archivo>         escribe el reporte JSON',
    '  --stamp-manifest           marca un manifiesto antiguo con schemaVersion y fidelidad',
    '  --timeout <ms>             tope de pared del replay (por defecto 120000)',
  ].join('\n')
}

/** Marca (una vez, manual) un manifiesto antiguo con version y fidelidad. */
function stampManifest(dir) {
  const file = resolve(dir, 'manifest.json')
  if (!existsSync(file)) throw new SessionError('missing-manifest', `no hay manifest.json en ${dir}`)
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  const meta = existsSync(resolve(dir, 'meta.json')) ? JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8')) : {}
  const turnsFile = resolve(dir, 'turns.ndjson')
  const modelIds = new Set()
  if (existsSync(turnsFile)) {
    for (const line of readFileSync(turnsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line)
        if (typeof row?.model === 'string' && row.model.trim()) modelIds.add(row.model.trim())
      } catch (error) {
        void error
      }
    }
  }
  const version = Number(manifest.schemaVersion)
  const stamped = {
    ...manifest,
    schemaVersion: SUPPORTED_MANIFEST_VERSIONS.includes(version) ? version : 1,
    appCommit: manifest.appCommit || 'unknown',
    configHash: manifest.configHash || 'unknown',
    modelIds: Array.isArray(manifest.modelIds) && manifest.modelIds.length ? manifest.modelIds : [...modelIds].sort(),
    language: manifest.language || String(meta.language || ''),
    sampleRate: Number(manifest.sampleRate) || Number(meta.sampleRate) || 0,
    stampedAt: new Date().toISOString(),
  }
  writeFileSync(file, JSON.stringify(stamped, null, 2), 'utf8')
  return { file, schemaVersion: stamped.schemaVersion }
}

/**
 * Tope de PARED del replay: usa el `setTimeout` REAL (el virtual no avanza solo).
 * @param {Promise<unknown>} promise
 * @param {number} ms
 * @param {Function} setTimeoutReal
 * @param {Function} clearTimeoutReal
 */
async function conTimeout(promise, ms, setTimeoutReal, clearTimeoutReal) {
  if (!(Number(ms) > 0)) return promise
  let id
  const tope = new Promise((_, reject) => {
    id = setTimeoutReal(() => reject(new SessionError('timeout', `el replay supero el tope de ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([promise, tope])
  } finally {
    clearTimeoutReal(id)
  }
}

async function main() {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return 0
  }
  if (!args.session) {
    console.error('replay: falta --session (no se adivina la sesion)\n')
    console.error(usage())
    return 2
  }
  if (args.stampManifest) {
    const stamped = stampManifest(args.session)
    console.log(`replay: manifiesto marcado (${stamped.schemaVersion}) -> ${stamped.file}`)
    return 0
  }
  if (!MODES.includes(args.mode)) {
    console.error(`replay: modo no soportado "${args.mode}" (soportados: ${MODES.join(', ')})`)
    return 2
  }
  // `--expected`/`--draft-expected` eran del modo `events` (filas/caja), retirado con la
  // tuberia vieja. Se rechazan en vez de ignorarlos: el producto mide con `npm run playback`.
  if (args.expected || args.draftExpected) {
    console.error('replay: --expected/--draft-expected pertenecen al modo retirado `events`; el producto mide con `npm run playback`')
    return 2
  }

  let session
  try {
    session = loadSession({ dir: args.session, mode: args.mode })
  } catch (error) {
    if (error instanceof SessionError) {
      console.error(`replay: sesion invalida [${error.code}] ${error.message}`)
      return 2
    }
    throw error
  }
  const fidelity = manifestFidelity(session.manifest)
  const fidelityWarnings = []
  if (fidelity.appCommit === 'unknown') fidelityWarnings.push('appCommit desconocido (manifiesto sin fidelidad)')
  if (fidelity.configHash === 'unknown') fidelityWarnings.push('configHash desconocido (manifiesto sin fidelidad)')
  if (!fidelity.modelIds.length) fidelityWarnings.push('sin modelIds en la grabacion')
  if (fidelityWarnings.length) {
    console.error(`replay: AVISO — sesion SIN fidelidad completa: ${fidelityWarnings.join('; ')}`)
  }
  const scenario = String(
    session.manifest?.meta?.scenario ||
      session.meta?.scenario ||
      session.manifest?.meta?.sessionId ||
      session.meta?.sessionId ||
      args.session,
  )

  // MODO `vectors`: hablantes. Se reinyectan los VECTORES grabados por el resolutor REAL
  // con el estado previo reconstruido; el `speaker` de la fuente es el esperado, nunca un
  // input. Sin vector/duracion -> `not-conclusive` (exit 2), jamas un OK falso.
  if (args.mode === 'vectors') {
    const setTimeoutRealVectors = globalThis.setTimeout.bind(globalThis)
    const clearTimeoutRealVectors = globalThis.clearTimeout.bind(globalThis)
    const { runVectorsSession } = await import('./replay/vectorsRunner.mjs')
    let vectors
    try {
      vectors = await conTimeout(
        runVectorsSession({ session }),
        args.timeoutMs,
        setTimeoutRealVectors,
        clearTimeoutRealVectors,
      )
    } catch (error) {
      if (error instanceof SessionError) {
        console.error(`replay: ${error.message}`)
        return 2
      }
      throw error
    }
    const checkSpeakers = compararSpeakers(vectors)
    const comparison = {
      // El modo NUNCA es una validacion completa si faltan turnos sin evidencia: `partial`.
      status: checkSpeakers.ok ? 'ok' : checkSpeakers.partial ? 'partial' : 'mismatch',
      checks: [checkSpeakers],
      notCovered: checkSpeakers.partial ? ['hablantes-cobertura-parcial'] : [],
      source: null,
      // Una locucion es UNA voz: la fuente de esta grabacion puede traer la misma frase con
      // dos etiquetas. Se mide aqui tambien (modo de hablantes), con el mismo dueno.
      speakerFlips: locucionesConEtiquetasDistintas(
        (session.turns || []).filter((row) => String(row?.kind || '') === 'commit'),
      ),
      classification: { perdidas: [], duplicadas: [], ventanas: 0 },
    }
    const status = vectors.conclusive ? comparison.status : 'not-conclusive'
    // exit 2 = no valida (ni OK parcial ni mismatch de una cobertura incompleta).
    const exitCode = vectors.conclusive ? (checkSpeakers.ok ? 0 : checkSpeakers.partial ? 2 : 1) : 2
    const report = buildReport({
      scenario,
      mode: args.mode,
      session,
      expectedPath: '(fuente: turns.ndjson)',
      expected: { approved: false, mode: args.mode, expect: {} },
      observed: { rows: [], boxTrace: [], commits: [], boxAtCommit: [], box: [] },
      comparison,
      status,
      exitCode,
      fidelity,
      fidelityWarnings,
      notCovered: comparison.notCovered,
      vectors,
      boxStallMs: 0,
      dupBlockWords: 0,
      timeoutMs: args.timeoutMs,
      startedAt,
      durationMs: Date.now() - t0,
    })
    if (args.report) writeReport(resolve(args.report), report)
    printReport(report)
    return exitCode
  }

}

// TOP-LEVEL AWAIT (obligatorio con `vite-node`): el runner espera a que `main` termine
// ANTES de cerrar el servidor del runner. Con una promesa flotante, `server.close()` se
// ejecutaba con el reloj virtual instalado, sus timers no avanzaban y el proceso se
// quedaba colgado sin reporte.
let exitCode = 2
try {
  exitCode = await main()
} catch (error) {
  console.error(`replay: error inesperado: ${error?.message || error}`)
}
process.exitCode = exitCode
