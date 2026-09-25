/**
 * P7.19 - eslint-disable: una supresion de barrera exige motivo.
 *
 * POR QUE EXISTE: `// eslint-disable-next-line X` es LA forma de silenciar una barrera.
 * Una supresion sin motivo convierte un hallazgo en invisible, que es el defecto de
 * fondo que se esta corrigiendo (el ledger decia "0 pendientes" mientras el codigo
 * reconocia deuda). MEDIDO: la auditoria externa encontro una en AsrLab.tsx:278
 * (no-await-in-loop sin justificar). Al verificarla resulto INERTE por dos motivos
 * independientes: src/dev/** esta en los ignores de eslint.config.mjs, y la regla
 * no-await-in-loop ni siquiera esta activada. Se retiro la directiva y se dejo el
 * porque en PROSA, que es lo que aporta al lector.
 *
 * REGLA: toda directiva eslint-disable* en src/ lleva descripcion `-- motivo`, el
 * mecanismo nativo de eslint para justificar una supresion.
 *
 * ALCANCE: solo directivas de COMENTARIO. appAnalyzer.ts contiene el literal
 * `/eslint-disable/` como patron al analizar proyectos importados: no es una directiva
 * y no debe marcarse. El detector lo distingue y hay prueba de ello.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

/** Directivas eslint-disable de COMENTARIO sin descripcion `-- motivo`. */
export function supresionesSinMotivo(src: string): number {
  return (src.match(/^[ \t]*(?:\/\/|\/\*)[ \t]*eslint-disable[^\n]*$/gm) ?? []).filter(
    (l) => !/--/.test(l),
  ).length
}

describe('eslint-disable', () => {
  it('toda supresion de barrera lleva motivo', () => {
    const offenders = walk(SRC)
      .filter((f) => supresionesSinMotivo(readFileSync(f, 'utf8')) > 0)
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
    expect(
      offenders,
      'directivas eslint-disable sin motivo (usa `-- motivo`):\n  ' + offenders.join('\n  '),
    ).toEqual([])
  })

  it('el detector no es decorativo: marca la supresion y no el literal del analizador', () => {
    expect(supresionesSinMotivo('      // eslint-disable-next-line no-await-in-loop\n')).toBe(1)
    expect(
      supresionesSinMotivo('      // eslint-disable-next-line no-await-in-loop -- secuencial a proposito\n'),
    ).toBe(0)
    // appAnalyzer.ts: patron de analisis de proyectos importados, no una directiva.
    expect(supresionesSinMotivo('    /eslint-disable/,\n')).toBe(0)
  })
})
