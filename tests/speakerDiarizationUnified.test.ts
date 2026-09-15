// ============================================================
// Guard de unificación de la diarización (nace ROJO)
// ------------------------------------------------------------
// Invariantes:
//   G1a — UNA sola función de coseno (hoy: compareAudioSignatures + compareCosineSignatures).
//   G1b — UNA sola normalización L2 (hoy: normalizeEmbeddingVector + normalizeSignatureVector
//         + normalizeSignatureForCosine).
//   G2  — UN solo resolver de hablante (hoy: resolveConversationSpeaker ×2 + assignSpeakerStrictCosine).
//   G3  — sin "Hablante 1" hardcodeado fuera de config (debe venir de FLU_CONFIG).
// ============================================================
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

function grepExportFn(names: string[]): string[] {
  const re = new RegExp(`export\\s+function\\s+(${names.join('|')})\\b`)
  const out: string[] = []
  for (const f of walk(join(ROOT, 'src'))) {
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (re.test(line)) out.push(`${relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}`)
      })
  }
  return out
}

function grepLiteral(lit: string, exclude: RegExp): string[] {
  const out: string[] = []
  for (const f of walk(join(ROOT, 'src', 'voice'))) {
    const rf = relative(ROOT, f).replace(/\\/g, '/')
    if (exclude.test(rf)) continue
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (line.includes(lit)) out.push(`${rf}:${i + 1}`)
      })
  }
  return out
}

describe('diarización — un solo motor, sin duplicados ni hardcode', () => {
  it('G1a: UNA sola función de coseno', () => {
    const defs = grepExportFn(['compareAudioSignatures', 'compareCosineSignatures'])
    expect(defs, `coseno duplicado (N=${defs.length}); debe quedar 1:\n  ${defs.join('\n  ')}`).toHaveLength(1)
  })

  it('G1b: UNA sola normalización L2', () => {
    const defs = grepExportFn(['normalizeEmbeddingVector', 'normalizeSignatureVector', 'normalizeSignatureForCosine'])
    expect(defs, `normalizadores duplicados (N=${defs.length}); debe quedar 1:\n  ${defs.join('\n  ')}`).toHaveLength(1)
  })

  it('G2: UN solo resolver de hablante', () => {
    const defs = grepExportFn(['resolveConversationSpeaker', 'assignSpeakerStrictCosine'])
    expect(defs, `motores duplicados (N=${defs.length}); debe quedar 1:\n  ${defs.join('\n  ')}`).toHaveLength(1)
  })

  it('G3: sin "Hablante 1" hardcodeado fuera de config', () => {
    const hits = grepLiteral('Hablante 1', /fluConfig\.js$/)
    expect(hits, `"Hablante 1" quemado (N=${hits.length}); debe vivir en FLU_CONFIG:\n  ${hits.join('\n  ')}`).toHaveLength(0)
  })
})
