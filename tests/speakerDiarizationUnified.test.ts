// ============================================================
// Guard de unificación de la diarización (nace ROJO)
// ------------------------------------------------------------
// Invariantes:
//   G1a — UNA sola función de coseno (hoy: compareAudioSignatures + compareCosineSignatures).
//   G1b — UNA sola normalización L2 (hoy: normalizeEmbeddingVector + normalizeSignatureVector
//         + normalizeSignatureForCosine).
//   G2  — UN solo resolver de hablante (hoy: resolveConversationSpeaker ×2 + assignSpeakerStrictCosine).
//   G3  — sin "Hablante 1" hardcodeado fuera de config (debe venir de FLU_CONFIG).
//   G4  — el motor de voz NO define un segundo resolver de hablante (2026-10-20: se
//         midió la ruta doble del modo pasivo, matchSegmentNames, que decidía con sus
//         PROPIOS umbrales y su propia base de perfiles).
//   G5  — el motor de voz NO decide por coseno ni escribe clusters a mano: delega en
//         resolveSpeakerIdentityFromVector (que opera sobre copias).
//   G6  — voiceProfiles NO participa en el matching de diarización (quedó en el dueño
//         de perfiles del panel, fuera del motor).
// ============================================================
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
/** Archivo que concentra el motor de voz (el segundo resolver histórico vivía aqui). */
const HOOK_REL = 'src/voice/hooks/useFluVoiceAssistant.js'

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

/** Nombres reales de una SEGUNDA implementación de matching de hablante. */
const NOMBRES_DECIDORA = 'matchSegmentNames|assignSpeaker\\w*|matchSpeaker\\w*|resolveSpeakerByVoice|resolveSpeakerFromAudio|decideSpeaker\\w*|resolveVoiceIdentity\\w*'
const RE_FN_DECIDORA = new RegExp(`(async\\s+)?function\\s+(${NOMBRES_DECIDORA})\\s*\\(`)
const RE_CONST_DECIDORA = new RegExp(`(const|let|var)\\s+(${NOMBRES_DECIDORA})\\s*=`)

/** Lineas que DEFINEN una decisora (no las que la consumen). Fuente: texto del hook. */
export function lineasDefinicionDecidora(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((linea, i) => ({ linea, i }))
    .filter(({ linea }) => {
      const t = String(linea || '').trim()
      if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false
      return RE_FN_DECIDORA.test(t) || RE_CONST_DECIDORA.test(t)
    })
    .map(({ linea, i }) => `${i + 1}: ${linea.trim()}`)
}

/** Lineas que miden coseno o escriben clusters/firmas a mano (decisión EN el hook). */
export function lineasDecisionDirecta(texto: string): string[] {
  const patrones = [
    /compareCosineSignatures\s*\(/,
    /\bspeakerClusters(Ref\.current)?\.push\s*\(/,
    /\.signature\s*=/,
  ]
  return texto
    .split(/\r?\n/)
    .map((linea, i) => ({ linea, i }))
    .filter(({ linea }) => {
      const t = String(linea || '').trim()
      if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false
      return patrones.some((re) => re.test(t))
    })
    .map(({ linea, i }) => `${i + 1}: ${linea.trim()}`)
}

/** Lineas que amarran voiceProfiles al motor (prohibido: dueño aparte). */
export function lineasVoiceProfilesEnHook(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((linea, i) => ({ linea, i }))
    .filter(({ linea }) => {
      const t = String(linea || '').trim()
      if (!t || t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false
      return /\b(voiceProfilesRef|listVoiceProfiles|saveVoiceProfile|getProfileMatchCfg)\b/.test(t)
    })
    .map(({ linea, i }) => `${i + 1}: ${linea.trim()}`)
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

  it('G4: el motor de voz NO define un segundo resolver de hablante', () => {
    const texto = readFileSync(join(ROOT, HOOK_REL), 'utf8')
    const defs = lineasDefinicionDecidora(texto)
    expect(defs, `segundo resolver en ${HOOK_REL} (debe delegar en resolveSpeakerIdentityFromVector):\n  ${defs.join('\n  ')}`).toHaveLength(0)
  })

  it('G5: el motor de voz NO decide por coseno ni escribe clusters/firmas a mano', () => {
    const texto = readFileSync(join(ROOT, HOOK_REL), 'utf8')
    const directas = lineasDecisionDirecta(texto)
    expect(directas, `decisión directa en ${HOOK_REL} (debe ir por el dueño canónico):\n  ${directas.join('\n  ')}`).toHaveLength(0)
  })

  it('G6: voiceProfiles no participa en el matching de diarización del motor', () => {
    const texto = readFileSync(join(ROOT, HOOK_REL), 'utf8')
    const hits = lineasVoiceProfilesEnHook(texto)
    expect(hits, `voiceProfiles en el motor (N=${hits.length}); dueño aparte, fuera del matching:\n  ${hits.join('\n  ')}`).toHaveLength(0)
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

  it('G4/G5/G6: marcan una segunda ruta y perdonan el hook delegado (prueba de mutación)', () => {
    const infractor = [
      'async function matchSegmentNames(segments, sampleRate, speakerClusters = []) {',
      '  const sim = compareCosineSignatures(a, b)',
      '  cluster.signature = cluster.signature.map((v) => v)',
      '  speakerClusters.push({ label, signature })',
      '  voiceProfilesRef.current = profiles',
      '  saveVoiceProfile({ label })',
      '}',
    ].join('\n')
    expect(lineasDefinicionDecidora(infractor).length, 'una segunda decisora debe marcarse').toBeGreaterThan(0)
    expect(lineasDecisionDirecta(infractor).length, 'decidir por coseno/escribir clusters debe marcarse').toBeGreaterThan(0)
    expect(lineasVoiceProfilesEnHook(infractor).length, 'voiceProfiles en el matching debe marcarse').toBeGreaterThan(0)

    const limpio = [
      "import { resolveSpeakerIdentityFromVector } from '../lib/voiceIdentityResolve.js'",
      'const identity = resolveSpeakerIdentityFromVector(signatureVector, {',
      '  speakerClusters: speakerClustersRef.current,',
      '})',
      'setSpeakerClusters(identity.workingClusters)',
      '// matchSegmentNames se borro; el dueño decide (comentario, no código)',
      'if (!hasGetUserMedia) missing.push("getUserMedia")',
    ].join('\n')
    expect(lineasDefinicionDecidora(limpio)).toHaveLength(0)
    expect(lineasDecisionDirecta(limpio)).toHaveLength(0)
    expect(lineasVoiceProfilesEnHook(limpio)).toHaveLength(0)
  })

  it('el detector perdona comentarios y detecta una decisora en arrow', () => {
    const conComentario = '// function matchSegmentNames(a) {}\n/* assignSpeaker(v) {} */\n'
    expect(lineasDefinicionDecidora(conComentario)).toHaveLength(0)

    const conArrow = 'const resolveSpeakerByVoice = (v) => v'
    expect(lineasDefinicionDecidora(conArrow)).toHaveLength(1)
  })
})
