/**
 * runCmd ? dueno UNICO del disparo de comandos de shell del instrumental
 * (A7: `sh` estaba copiado identico en hito.mjs y task-gate.mjs; `shRaw` solo en
 * hito.mjs). Devuelve { code, out, err } sin lanzar: el consumidor decide.
 *
 * Congelado por hash en .task/frozen.json (el gate lo usa para sus pasos).
 */
import { spawnSync } from 'node:child_process'

/** Comando de shell con los bordes de la salida RECORTADOS. */
export function sh(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' })
  return { code: r.status === null ? 1 : r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

/** Igual que `sh` pero SIN recortar (volcados que conservan formato). */
export function shRaw(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' })
  return { code: r.status === null ? 1 : r.status, out: r.stdout || '', err: r.stderr || '' }
}
