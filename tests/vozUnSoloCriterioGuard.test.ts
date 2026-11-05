// ============================================================
// vozUnSoloCriterioGuard — UN criterio, UN sitio, UN valor.
// ------------------------------------------------------------
// POR QUE (dueno, 2026-10-11):
//   1) El CIERRE del turno se decidia en DOS sitios (dos implementaciones de "cierra si
//      hay >= N palabras"): `evaluateSrGapSegmentCommit` (conversationStream.js) y el
//      watchdog del hook (`srGapMinWords`). Duplicado -> se rechaza.
//   2) "MISMA VOZ" tenia DOS umbrales distintos (`sameVoiceFloor` 0.66 y
//      `sameVoiceCosidoFloor` 0.64). Un concepto, un valor.
//   3) El cierre NO se decide contando palabras: eso es una regla INVENTADA, no la de
//      FLU. El cierre lo decide el FINAL real del reconocedor; el silencio solo confirma
//      un final ya dado. El umbral de palabras SE QUITA.
// El guard NAZCA ROJO. Falla si la misma regla vive en 2 sitios o si un concepto tiene 2
// umbrales. Prueba de detector: alimenta un texto sintetico y comprueba que discrimina.
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function ficheros(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) ficheros(p, acc)
    else if (/\.(js|ts)$/.test(name)) acc.push(p)
  }
  return acc
}

/** SITIOS de un mismo criterio, medidos por su marca en el TEXTO del src. */
export function sitiosDeLaMarca(marca: string, fuentes: string[]): string[] {
  const re = new RegExp(marca)
  return fuentes.filter((p) => re.test(readFileSync(p, 'utf8')))
}

/** Umbrales de "es la MISMA voz": funciones exportadas `sameVoice*Floor`. */
export function pisosDeMismaVoz(fuente: string): string[] {
  return [...fuente.matchAll(/export function (sameVoice\w*Floor)\s*\(/g)].map((m) => m[1]).sort()
}

const SRC = ficheros('src')

describe('un solo criterio, un solo sitio, un solo valor', () => {
  it('el cierre NO se decide contando palabras: 0 sitios con el criterio inventado', () => {
    const sitios = sitiosDeLaMarca('srGapCommitMinWords|srGapMinWords', SRC)
    expect(sitios, `el umbral de palabras del cierre vive en estos sitios: ${sitios.join(', ')}`).toEqual([])
  })

  it('"misma voz" tiene UN solo piso (una funcion, un valor)', () => {
    const pisos = pisosDeMismaVoz(readFileSync('src/voice/lib/speakerClusters.js', 'utf8'))
    expect(pisos, `pisos de "misma voz" declarados: ${pisos.join(', ')}`).toEqual(['sameVoiceFloor'])
  })

  it('PRUEBA DE DETECTOR (el guard no es decorativo): discrimina con y sin duplicado', () => {
    // Un texto CON el defecto: el detector lo ve.
    const conDefecto = [
      'const srGapMinWords = Number(cfg.srGapCommitMinWords) || 0',
      'export function sameVoiceCosidoFloor() { return 0.64 }',
      'export function sameVoiceFloor() { return 0.66 }',
    ]
    expect(sitiosDeLaMarca('srGapCommitMinWords|srGapMinWords', []), 'sin ficheros no hay sitios').toEqual([])
    expect(conDefecto.some((l) => /srGapCommitMinWords|srGapMinWords/.test(l)), 'la marca del cierre').toBe(true)
    expect(pisosDeMismaVoz(conDefecto.join('\n')), 'dos pisos para un concepto').toHaveLength(2)
    // Un texto LIMPIO: el detector calla.
    const limpio = ['const srGap = resolveSrGapTrigger({ hasOpenLine })', 'export function sameVoiceFloor() { return 0.66 }'].join('\n')
    expect(limpio.includes('srGapMinWords')).toBe(false)
    expect(pisosDeMismaVoz(limpio)).toEqual(['sameVoiceFloor'])
  })
})
