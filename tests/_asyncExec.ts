/**
 * UN DUENO de "medir lanzando un SUBPROCESO sin bloquear el event loop".
 *
 * POR QUE EXISTE (defecto medido DOS veces: P7.68 en jsReferenceGuard y P9.21 en la
 * barrera entera): `spawnSync`/`execFileSync`/`execSync` BLOQUEAN el event loop del
 * worker de vitest durante TODA la medicion. Bajo contencion (10 workers en 12 CPUs)
 * la suma de esos bloqueos cruza el timeout de 60 s del RPC y la corrida sale ROJA
 * por 'Unhandled Error: [vitest-worker]: Timeout calling onTaskUpdate' AUNQUE todos
 * los tests pasen. MEDIDO con sonda: spawnSync 9445ms/ticks=0 vs execFile
 * 8913ms/ticks=281 (la misma medicion de tsc).
 *
 * Todo guard que lance `git`, `node scripts/...` o vitest lo hace por AQUI: UNA sola
 * implementacion. Antes cada guard tenia su copia sincrona (y hubo una copia async
 * local en auditLedgerSync): eso es la ruta doble que este modulo cierra.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024

export interface ExecResult {
  stdout: string
  stderr: string
  status: number
}

/**
 * Lanza un subproceso y ESPERA sin bloquear el event loop.
 * No lanza por codigo de salida distinto de 0: lo devuelve en `status`.
 * @param command ejecutable ('node', 'git', process.execPath...)
 * @param args argumentos del hijo
 * @param options `cwd`, `env`, `timeout` del hijo; `maxBuffer` por defecto 64 MB
 * @returns `{ stdout, stderr, status }` (status 0 si termino bien)
 */
export async function runAsync(
  command: string,
  args: string[],
  {
    cwd,
    env,
    timeout,
    maxBuffer = DEFAULT_MAX_BUFFER,
  }: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number } = {},
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await runFile(command, args, { cwd, env, timeout, maxBuffer, encoding: 'utf8' })
    return { stdout: String(stdout), stderr: String(stderr), status: 0 }
  } catch (error) {
    const e = error as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number | string }
    return {
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
      status: typeof e.code === 'number' ? e.code : 1,
    }
  }
}

/** Igual que `runAsync` pero exige codigo 0 (para los guards que asertan exito). */
export async function runOk(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number },
): Promise<string> {
  const r = await runAsync(command, args, options)
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} fallo (${r.status}): ${(r.stderr || r.stdout).slice(0, 400)}`)
  return r.stdout
}

/**
 * PRUEBA DE DETECTOR reutilizable: cuantos latidos del event loop (ticks de 20 ms)
 * ocurren mientras corre `medir()`. Con una medicion SINCRONA es 0 (el loop queda
 * bloqueado); asincrona da > 0. Un unico criterio para todos los guards: si alguien
 * vuelve a una version sincrona, el caso cae.
 * @param medir funcion async que se mide
 * @returns el numero de ticks observados
 */
export async function ticksWhile(medir: () => Promise<unknown>): Promise<number> {
  let ticks = 0
  const id = setInterval(() => {
    ticks += 1
  }, 20)
  try {
    await medir()
  } finally {
    clearInterval(id)
  }
  return ticks
}
