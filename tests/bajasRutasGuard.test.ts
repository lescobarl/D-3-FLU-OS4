/**
 * bajasRutasGuard — barrera de las rutas BAJA (código muerto y dueños).
 *
 * 4. `clearHistory` del store: muerta; el dueño es `resetConversationHistory`.
 * 5. `flu-participant-enabled`: el JSON es canónico; la heredada solo rellena.
 * 6. `flu-user-name`: sin escrituras ni borrados (el nombre vive en onboardingStates).
 * 7. `AI_PROVIDER`: solo lo lee `getPreferredAIProvider`.
 * 8. Clientes/rutas muertas: requestParticipantEvaluation, requestConversationSummary,
 *    putConversationRecord y /api/gemini/summary.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BASELINE = join(ROOT, 'scripts', 'baja-rutas-baseline.json')

type Fuente = { rel: string; text: string }

function walk(dir: string): Fuente[] {
  const out: Fuente[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      out.push({
        rel: relative(ROOT, full).replace(/\\/g, '/'),
        text: readFileSync(full, 'utf8'),
      })
    }
  }
  return out
}

/**
 * Rutas BAJA que deben seguir cerradas.
 * @param files Fuentes de src.
 * @returns Ficheros infractores.
 */
export function findBajaOffenders(files: Fuente[]): string[] {
  const out: string[] = []
  for (const f of files) {
    if (f.rel.endsWith('store/integrationStore.ts') && f.text.includes('clearHistory')) {
      out.push(`${f.rel}: clearHistory muerta`)
    }
    if (/localSet\(\s*LEGACY_ENABLED_KEY/.test(f.text)) {
      out.push(`${f.rel}: escribe la clave enabled heredada`)
    }
    if (f.rel.endsWith('fluParticipantConfig.js')) {
      const readAt = f.text.indexOf('localGet(LEGACY_ENABLED_KEY)')
      if (readAt >= 0) {
        const before = f.text.slice(Math.max(0, readAt - 500), readAt)
        if (!before.includes("!('enabled' in overrides)")) {
          out.push(`${f.rel}: la clave heredada puede pisar el JSON`)
        }
      }
    }
    if (/local(Set|Remove)\(config\.nameKey/.test(f.text)) {
      out.push(`${f.rel}: escribe/borra flu-user-name`)
    }
    if (
      f.rel.endsWith('core/autonomy/decisionEngine.ts') &&
      /localGet\([^)]*AI_PROVIDER/.test(f.text)
    ) {
      out.push(`${f.rel}: lee AI_PROVIDER sin getPreferredAIProvider`)
    }
    for (const dead of [
      'requestParticipantEvaluation(',
      'requestConversationSummary(',
      'putConversationRecord(',
      '/api/gemini/summary',
    ]) {
      if (f.text.includes(dead)) out.push(`${f.rel}: ruta muerta ${dead}`)
    }
  }
  return out
}

describe('bajasRutasGuard — rutas BAJA cerradas', () => {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
    deadRoutes: number
    minSources: number
  }

  it('ANTI-VACUIDAD: lee la fuente real', () => {
    expect(walk(SRC).length).toBeGreaterThanOrEqual(baseline.minSources)
  })

  it('no reaparecen rutas BAJA', () => {
    const offenders = findBajaOffenders(walk(SRC))
    expect(offenders, offenders.join('\n')).toEqual([])
    expect(offenders.length).toBe(baseline.deadRoutes)
  })

  it('el detector no es decorativo', () => {
    const malo = [
      { rel: 'src/x.ts', text: 'putConversationRecord(row); localSet(config.nameKey, name);' },
    ]
    const offenders = findBajaOffenders(malo)
    expect(offenders.length).toBeGreaterThanOrEqual(2)
    expect(findBajaOffenders([{ rel: 'src/x.ts', text: 'resetConversationHistory()' }])).toEqual([])
  })
})
