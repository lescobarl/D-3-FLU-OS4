/**
 * voiceProfileSingleOwnerGuard — una sola búsqueda y un solo borrado de perfiles.
 *
 * Dueño: `useVoiceProfiles` (lectura por etiqueta con trim + el más antiguo, y
 * borrado lógico). `fluStorage` solo proyecta la forma rica; App no consulta ni
 * borra la tabla por su cuenta.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const OWNER = 'src/hooks/useVoiceProfiles.ts'
const TABLE_OWNER = 'src/core/db/fluDatabase.ts'
const BASELINE = join(ROOT, 'scripts', 'voice-profile-owner-baseline.json')

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
 * Rutas de lectura/borrado fuera del dueño.
 * @param files Fuentes de src.
 * @returns Ficheros infractores.
 */
export function findVoiceProfileOffenders(files: Fuente[]): string[] {
  const out: string[] = []
  for (const f of files) {
    if (f.rel === OWNER || f.rel === TABLE_OWNER) continue
    if (
      f.text.includes("voiceProfiles.where('label')") ||
      f.text.includes('voiceProfiles.toArray()') ||
      f.text.includes('voiceProfiles.get(')
    ) {
      out.push(`${f.rel}: acceso a voiceProfiles fuera del dueno`)
    }
    if (f.rel.endsWith('src/App.tsx') && /findVoiceProfileByLabel|deleteVoiceProfile/.test(f.text)) {
      out.push(`${f.rel}: App usa la ruta legacy de perfiles de voz`)
    }
  }
  return out
}

describe('voiceProfileSingleOwnerGuard — un solo dueño', () => {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
    duplicateRoutes: number
    minSources: number
  }

  it('ANTI-VACUIDAD: lee la fuente real', () => {
    expect(walk(SRC).length).toBeGreaterThanOrEqual(baseline.minSources)
  })

  it('no hay rutas de perfiles fuera del dueño', () => {
    const offenders = findVoiceProfileOffenders(walk(SRC))
    expect(offenders, offenders.join('\n')).toEqual([])
    expect(offenders.length).toBe(baseline.duplicateRoutes)
  })

  it('el dueño conserva búsqueda normalizada y borrado', () => {
    const owner = readFileSync(join(ROOT, OWNER), 'utf8')
    expect(owner).toContain('findVoiceProfileRecordByLabel')
    expect(owner).toContain('deleteVoiceProfile')
    expect(owner).toContain(".trim() === normalized")
  })

  it('el detector no es decorativo: marca el acceso directo', () => {
    const malo = [
      { rel: 'src/hooks/fake.ts', text: "fluDb.voiceProfiles.where('label').equals(x)" },
    ]
    expect(findVoiceProfileOffenders(malo)).toHaveLength(1)
    expect(findVoiceProfileOffenders([{ rel: OWNER, text: 'x' }])).toHaveLength(0)
  })
})
