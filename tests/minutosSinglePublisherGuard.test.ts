// @vitest-environment jsdom
/**
 * P1.2 - Minutas: un solo publicador hacia integrationStore.
 *
 * CONTEXTO: el guard congelado C10 (tests/minutosDobleEscrituraGuard.test.ts) solo
 * miraba UN archivo hardcodeado (src/hooks/useMinuteHandlers.ts) y UNA forma
 * (integrationStore.addMinute). Por eso era ciego a los otros dos escritores reales:
 * useMinuteKnowledge.ts:265 (useIntegrationStore.getState().addMinute) y
 * App.tsx:4278 (integrationStore.addMinute). El propio titulo del hito lo dice:
 * 'T2a - Guard de minutas ciego (no cubre useMinuteKnowledge.ts)'.
 *
 * El codigo ya declaraba la doctrina (useMinuteKnowledge.ts:262-264): 'el dueno de la
 * minuta (persistencia) es quien publica en integrationStore; los consumidores NO
 * espejan por su cuenta'.
 *
 * Ahora hay UN solo publicador: la puerta publishMinuteToStore() del dueno. App hidrata
 * pidiendo publishAllToStore() en vez de espejar. Ademas el store dedupea por id, porque
 * su prepend ciego convertia a cualquier segundo escritor en duplicador de filas.
 * El guard congelado no se toca (criterio inmutable).
 *
 * AMBITO: todo src/, sin exclusiones (AGENTS.md 7.7.d).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import type { MinuteUIEntry } from '../src/hooks/useMinuteKnowledge'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
/** Dueno unico autorizado a publicar. */
export const MINUTE_PUBLISHER = 'src/hooks/useMinuteKnowledge.ts'
const NL = String.fromCharCode(10)

/** Formas reales de publicar en integrationStore. */
export const STORE_ADD_MINUTE =
  /(?:useIntegrationStore\s*[.]\s*getState\s*[(]\s*[)]|integrationStore)\s*[.]\s*addMinute\s*[(]/

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p)
  }
  return acc
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/')

/** Lineas de CODIGO (no comentario) que publican en integrationStore. */
export function publisherSites(src: string, fileName: string): string[] {
  const out: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
    if (STORE_ADD_MINUTE.test(line)) out.push(fileName + ':' + (i + 1))
  })
  return out
}

function makeMinute(id: string, titulo: string): MinuteUIEntry {
  return {
    id,
    profileId: 'p1',
    userId: 'u1',
    minuteKey: 'k-' + id,
    historyCode: '250922-01',
    description: titulo,
    summarySnapshot: {
      titulo,
      participantes: [],
      resumen: 'r',
      acuerdos: [],
      pendientes: [],
      siguientes_pasos: [],
      tema_sesion: 't',
    },
    sequence: 1,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  }
}

describe('P1.2 minutosSinglePublisher - un solo publicador', () => {
  it('solo el dueno de la minuta publica en integrationStore', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      offenders.push(...publisherSites(readFileSync(f, 'utf8'), rel(f)))
    }
    expect(
      offenders,
      'publicadores hacia integrationStore (debe quedar 1: ' + MINUTE_PUBLISHER + '):' + NL + '  ' + offenders.join(NL + '  '),
    ).toHaveLength(1)
    expect(offenders[0].startsWith(MINUTE_PUBLISHER + ':')).toBe(true)
  })

  it('App delega la hidratacion en el dueno (no espeja)', () => {
    const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8')
    expect(publisherSites(app, 'src/App.tsx')).toEqual([])
    expect(app).toContain('publishAllToStore')
  })

  it('republicar la misma minuta no la duplica (dedup por id)', () => {
    useIntegrationStore.setState({ minuteHistory: [] })
    const m = makeMinute('m-1', 'Unica')
    useIntegrationStore.getState().addMinute(m)
    useIntegrationStore.getState().addMinute(m)
    expect(useIntegrationStore.getState().minuteHistory).toHaveLength(1)
  })
})

describe('P1.2 - el detector no es decorativo (7.7.d)', () => {
  it('marca las dos formas reales de publicar', () => {
    expect(publisherSites('useIntegrationStore.getState().addMinute(x);', 'a.ts')).toEqual(['a.ts:1'])
    expect(publisherSites('integrationStore.addMinute(m);', 'a.ts')).toEqual(['a.ts:1'])
  })
  it('no confunde comentarios ni el addMinute del propio hook', () => {
    expect(publisherSites('// integrationStore.addMinute(m);', 'a.ts')).toEqual([])
    expect(publisherSites(' * useIntegrationStore.getState().addMinute(x);', 'a.ts')).toEqual([])
    expect(publisherSites('minuteKnowledge.addMinute(snapshot);', 'a.ts')).toEqual([])
  })
})
