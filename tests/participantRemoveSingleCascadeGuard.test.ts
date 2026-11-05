/**
 * participantRemoveSingleCascadeGuard — una sola cascada de borrado.
 *
 * El dueño es `useParticipants.remove`: borra el registro, el onboarding
 * per-user, ACTIVE_USER y decide `wasActive`. App solo puede limpiar su estado
 * React a partir de ese resultado; no repite la cascada ni usa
 * `onboarding.reset()` (que volvería a borrar el per-user).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const HOOKS = join(ROOT, 'src', 'hooks')
const OWNER = 'src/hooks/useParticipants.ts'
const BASELINE = join(ROOT, 'scripts', 'participant-remove-baseline.json')

type Fuente = { rel: string; text: string }

function readFile(rel: string): Fuente {
  return { rel, text: readFileSync(join(ROOT, rel), 'utf8') }
}

function walkHooks(): Fuente[] {
  const out: Fuente[] = []
  for (const entry of readdirSync(HOOKS, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue
    const full = join(HOOKS, entry.name)
    out.push({ rel: relative(ROOT, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') })
  }
  return out
}

/**
 * Cuerpos de los handlers de borrado de App (`handleRemove*`).
 * @param app Fuente de App.tsx.
 * @returns Cuerpos de los handlers.
 */
export function removeHandlerBodies(app: string): string[] {
  const out: string[] = []
  const re = /const handleRemove\w*\s*=\s*useCallback\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(app))) {
    const arrow = app.indexOf('=>', m.index)
    const start = app.indexOf('{', arrow)
    if (start < 0) continue
    let depth = 0
    let j = start
    for (; j < app.length; j += 1) {
      if (app[j] === '{') depth += 1
      else if (app[j] === '}') {
        depth -= 1
        if (depth === 0) {
          j += 1
          break
        }
      }
    }
    out.push(app.slice(start, j))
  }
  return out
}

/**
 * Cascadas duplicadas de borrado.
 * @param files App + hooks.
 * @returns Ficheros infractores.
 */
export function findCleanupOffenders(files: Fuente[]): string[] {
  const out: string[] = []
  for (const f of files) {
    if (f.rel === OWNER) continue
    const bodies = f.rel.endsWith('src/App.tsx') ? removeHandlerBodies(f.text) : [f.text]
    for (const body of bodies) {
      if (body.includes('onboardingGateway.reset(')) {
        out.push(`${f.rel}: onboardingGateway.reset fuera del dueno`)
      }
      if (body.includes('localRemove(STORAGE_KEYS.ACTIVE_USER)')) {
        out.push(`${f.rel}: ACTIVE_USER fuera del dueno`)
      }
      if (body.includes('onboarding.reset()')) {
        out.push(`${f.rel}: onboarding.reset() en la cascada (usa resetSession)`)
      }
    }
  }
  return out
}

describe('participantRemoveSingleCascadeGuard — una sola cascada', () => {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
    cleanupSites: number
    minSources: number
  }

  it('ANTI-VACUIDAD: lee App y el directorio de hooks', () => {
    expect(1 + walkHooks().length).toBeGreaterThanOrEqual(baseline.minSources)
  })

  it('no hay cascadas duplicadas fuera del dueno', () => {
    const files = [readFile('src/App.tsx'), ...walkHooks()]
    const offenders = findCleanupOffenders(files)
    expect(offenders, offenders.join('\n')).toEqual([])
    expect(offenders.length).toBe(baseline.cleanupSites)
  })

  it('el dueno existe y conserva la cascada', () => {
    const owner = readFile(OWNER).text
    expect(owner).toContain('onboardingGateway.reset(id)')
    expect(owner).toContain('localRemove(STORAGE_KEYS.ACTIVE_USER)')
    expect(owner).toContain('wasActive')
  })

  it('el detector no es decorativo: marca la cascada en App', () => {
    const malo = [
      {
        rel: 'src/App.tsx',
        text: 'const handleRemoveX = useCallback(async (id) => { if (x) { localRemove(onboarding.config.nameKey); onboarding.reset(); } }, []);',
      },
    ]
    expect(findCleanupOffenders(malo)).toContain(
      'src/App.tsx: onboarding.reset() en la cascada (usa resetSession)',
    )
    const bueno = [
      {
        rel: 'src/App.tsx',
        text: 'const handleRemoveX = useCallback(async (id) => { onboarding.resetSession(); setActiveUser(undefined); }, []);',
      },
    ]
    expect(findCleanupOffenders(bueno)).toEqual([])
  })
})
