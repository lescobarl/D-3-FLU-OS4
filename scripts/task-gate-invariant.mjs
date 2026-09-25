#!/usr/bin/env node
/**
 * task-gate-invariant — lógica PURA de la puerta de invariantes (AGENTS.md §B/§10).
 *
 * Convierte "unifiqué X" en una decisión mecánica que NO depende de la palabra
 * del agente. Recibe funciones (no git ni shell), así que se testea sin efectos:
 *
 *   1) MÉTRICA en `base`  → valor ANTES.
 *   2) MÉTRICA en el árbol actual → valor DESPUÉS. Debe `=== target`.
 *   3) Si ANTES === DESPUÉS, no hubo unificación (hito cosmético) → FALLA.
 *   4) GUARD en `base`   → DEBE FALLAR. Si pasa, no distingue el defecto: la
 *      tarea no está definida (§B11). Un guard que no nace rojo no mide nada.
 *   5) GUARD en el árbol actual → DEBE PASAR.
 *
 * Este módulo es el criterio congelado por hash: el agente no lo edita.
 */

/**
 * Extrae el primer entero de la salida de un comando de conteo.
 * @param {string} stdout
 * @returns {number|null}
 */
export function parseMetricValue(stdout) {
  const m = String(stdout).match(/-?\d+/)
  return m ? Number(m[0]) : null
}

/**
 * @typedef {{ code: number, out: string, err: string }} CommandResult
 *
 * @param {object} p
 * @param {() => number|null} p.metricBase  métrica medida en `base`
 * @param {() => number|null} p.metricNow   métrica medida en el árbol actual
 * @param {() => CommandResult} p.guardBase guard corrido sobre `base`
 * @param {() => CommandResult} p.guardNow  guard corrido sobre el árbol actual
 * @param {number} p.target                 valor esperado de la métrica tras el hito
 * @returns {{ ok: boolean, failures: string[], summary: string }}
 */
export function evaluateInvariant({ metricBase, metricNow, guardBase, guardNow, target }) {
  const failures = []
  const before = metricBase()
  const after = metricNow()

  if (before === null) failures.push('métrica en base no produjo un número (comando no medible)')
  if (after === null) failures.push('métrica actual no produjo un número (comando no medible)')
  if (after !== null && after !== target) {
    failures.push(`métrica actual = ${after}, target = ${target} (el invariante no se cumplió)`)
  }
  if (before !== null && after !== null && before === after) {
    failures.push(`la métrica no cambió (base ${before} → actual ${after}); hito cosmético, no unificó`)
  }

  const gb = guardBase()
  if (gb.code === 0) {
    failures.push('el GUARD PASA en base: no distingue el defecto → la tarea no está definida (§B11)')
  }
  const gn = guardNow()
  if (gn.code !== 0) {
    failures.push('el GUARD FALLA en el árbol actual: el invariante sigue roto')
  }

  return {
    ok: failures.length === 0,
    failures,
    summary: `métrica base=${before} actual=${after} target=${target} · guard base=${gb.code} actual=${gn.code}`,
  }
}
