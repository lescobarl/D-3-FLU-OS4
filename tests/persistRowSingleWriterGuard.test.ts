/**
 * persistRowSingleWriterGuard — barrera del write-path de la fila de usuario.
 *
 * El modulo de conversacion (`conversationRowWriter`) escribe la fila canonica.
 * El hook de persistencia solo puede reescribirla si `debePersistirEntrada`
 * autoriza, y el store debe transportar `persistSpeakerName` desde el
 * reetiquetado tardio (`persist:false`). Sin eso, la vista parcial pisa meta,
 * evidencia, timestamp y hablante de la fila ya commiteada.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { debePersistirEntrada } from '../src/hooks/useConversationPersistence'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BASELINE = join(ROOT, 'scripts', 'persist-row-baseline.json')

type Fuente = { rel: string; text: string }

function walk(dir: string): Fuente[] {
  const out: Fuente[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      out.push({
        rel: relative(ROOT, full).replace(/\\/g, '/'),
        text: readFileSync(full, 'utf8'),
      })
    }
  }
  return out
}

/**
 * Escrituras de fila de usuario sin su compuerta.
 * - Cualquier modulo que llame a `entryToRow` debe tener `debePersistirEntrada`.
 * - El store debe aceptar y guardar `persist` en `setEntrySpeakerName`.
 * @param files Fuentes del repo.
 * @returns Lista de ficheros infractores.
 */
export function findUnsafeWriterOffenders(files: Fuente[]): string[] {
  const out: string[] = []
  for (const f of files) {
    if (f.text.includes('entryToRow(') && !f.text.includes('debePersistirEntrada(')) {
      out.push(`${f.rel}: entryToRow sin compuerta`)
    }
    if (
      f.rel.endsWith('store/integrationStore.ts') &&
      f.text.includes('setEntrySpeakerName') &&
      (!f.text.includes('persist?: boolean') || !f.text.includes('persistSpeakerName: false'))
    ) {
      out.push(`${f.rel}: setEntrySpeakerName no transporta persist`)
    }
  }
  return out
}

describe('persistRowSingleWriterGuard — un solo escritor efectivo', () => {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
    unsafeWrites: number
    minSources: number
  }

  it('ANTI-VACUIDAD: lee la fuente real', () => {
    expect(walk(SRC).length).toBeGreaterThanOrEqual(baseline.minSources)
  })

  it('no hay escrituras de fila de usuario sin compuerta', () => {
    const offenders = findUnsafeWriterOffenders(walk(SRC))
    expect(offenders, offenders.join('\n')).toEqual([])
    expect(offenders.length).toBe(baseline.unsafeWrites)
  })

  it('el detector no es decorativo: marca el hook sin compuerta', () => {
    const malo = [
      { rel: 'src/hooks/fake.ts', text: 'const fila = entryToRow(entry, scope, previa, existente)' },
    ]
    expect(findUnsafeWriterOffenders(malo)).toHaveLength(1)
    const bueno = [
      {
        rel: 'src/hooks/fake.ts',
        text: 'if (debePersistirEntrada(entry, existente)) { const fila = entryToRow(entry, scope, previa, existente) }',
      },
    ]
    expect(findUnsafeWriterOffenders(bueno)).toHaveLength(0)
  })

  it('la compuerta respeta persist:false solo en filas del modulo', () => {
    const moduleRow = { meta: { origin: 'conversation-module' } }
    expect(debePersistirEntrada({ role: 'user', persistSpeakerName: false }, moduleRow)).toBe(false)
    expect(debePersistirEntrada({ role: 'user', persistSpeakerName: true }, moduleRow)).toBe(true)
    expect(debePersistirEntrada({ role: 'user' }, moduleRow)).toBe(true)
    expect(debePersistirEntrada({ role: 'user', persistSpeakerName: false }, { meta: { origin: 'import' } })).toBe(true)
    expect(debePersistirEntrada({ role: 'user', persistSpeakerName: false }, null)).toBe(true)
  })
})
