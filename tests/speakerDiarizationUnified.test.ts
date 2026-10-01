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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()

function grepExportFn(names: string[], root: string = join(ROOT, 'src')): string[] {
  const re = new RegExp(`export\\s+function\\s+(${names.join('|')})\\b`)
  const out: string[] = []
  for (const f of walkFiles(root, /\.(ts|tsx|js|jsx|mjs)$/)) {
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (re.test(line)) out.push(`${relative(root, f).replace(/\\/g, '/')}:${i + 1}`)
      })
  }
  return out
}

function grepLiteral(lit: string, exclude: RegExp, root: string = join(ROOT, 'src')): string[] {
  const out: string[] = []
  for (const f of walkFiles(root, /\.(ts|tsx|js|jsx|mjs)$/)) {
    const rf = relative(root, f).replace(/\\/g, '/')
    if (exclude.test(rf)) continue
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
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

/** P2.4 - prueba de DETECTOR: escribe entradas sinteticas en un directorio temporal
 *  y comprueba que el detector MARCA la infractora y PERDONA la limpia. */
function dirSintetico(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'p24-'))
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c)
  return dir
}

describe('P2.4 speakerDiarizationUnified - el detector no es decorativo', () => {
  it('marca un export duplicado sintetico y el literal quemado', () => {
    const dir = dirSintetico({
      'a.ts': 'export function compareAudioSignatures(a, b) {}',
      'b.ts': "const etiqueta = 'Hablante 1'",
    })
    try {
      expect(grepExportFn(['compareAudioSignatures', 'compareCosineSignatures'], dir)).toHaveLength(1)
      expect(grepLiteral('Hablante 1', /nada-que-excluya/, dir)).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
