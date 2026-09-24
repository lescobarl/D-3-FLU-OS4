/**
 * Procedencia de los 16 hallazgos de la auditoria externa.
 *
 * Cada item del ledger que viene de la auditoria externa registra SU numero. Esa
 * procedencia no esta en git ni en ningun otro sitio: el documento original de la
 * auditoria no vive en el repo, y el ledger declara expresamente que "el chat y su
 * resumen NO son fuente". O sea: si se pierde el numero, no hay de donde recuperarlo.
 *
 * MEDIDO (por eso existe este guard): al reescribir la evidencia de P7.5 y P7.9 para
 * cerrarlas se perdieron sus numeros (#3 y #14) y NADIE se entero, porque nada los
 * comprobaba. Reescribir una evidencia es rutina; perder su procedencia, silencioso.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LEDGER = 'plans/ledger.json'

/**
 * Hallazgo externo -> item del ledger. Congelado: si un item cambia de numero, la
 * procedencia se esta reescribiendo y hay que justificarlo aqui, no en silencio.
 */
export const MAPA: Record<number, string> = {
  1: 'P7.11',
  2: 'P7.14',
  3: 'P7.5',
  4: 'P7.6',
  7: 'P7.12',
  8: 'P7.13',
  9: 'P7.15',
  10: 'P7.16',
  11: 'P7.19',
  12: 'P7.8',
  13: 'P7.17',
  14: 'P7.9',
  16: 'P7.18',
}

/**
 * Hallazgos del 1 al 16 cuyo numero NO consta en el ledger. No es un olvido de este
 * guard: medido contra el commit que registro las 16 conclusiones (f9ab7ac), estos tres
 * nunca se numeraron, y sin el documento original no se pueden asignar sin inventar.
 * Declararlos aqui los hace VISIBLES: si alguien los mapea, este guard le pide
 * actualizar la lista en vez de dejar el numero en el aire.
 */
export const SIN_NUMERO = [5, 6, 15]

const RE = /auditor[ií]a\s+(?:externa\s+)?#(\d+)/gi

/** Numeros de hallazgo externo citados por un item (titulo + evidencia). */
export function numerosDe(item: { titulo?: string; evidencia?: string }): number[] {
  const texto = `${item.titulo || ''} ${item.evidencia || ''}`
  return [...new Set([...texto.matchAll(RE)].map((m) => Number(m[1])))]
}

interface Item {
  id: string
  titulo: string
  evidencia: string
}

function items(): Item[] {
  return JSON.parse(readFileSync(LEDGER, 'utf8')).items as Item[]
}

describe('Auditoria externa - la procedencia de los 16 hallazgos no se pierde en silencio', () => {
  it('cada hallazgo del mapa sigue citado por su item (P7.5=#3 y P7.9=#14 incluidos)', () => {
    const porId = new Map(items().map((i) => [i.id, i]))
    const perdidos: string[] = []
    for (const [n, id] of Object.entries(MAPA)) {
      const it = porId.get(id)
      if (!it || !numerosDe(it).includes(Number(n))) perdidos.push(`#${n} -> ${id}`)
    }
    expect(perdidos, 'procedencia perdida (N=' + perdidos.length + '): ' + perdidos.join(', ')).toEqual([])
  })

  it('ningun numero lo reclaman dos items distintos', () => {
    const dueños: Record<number, string[]> = {}
    for (const it of items()) {
      for (const n of numerosDe(it)) (dueños[n] ||= []).push(it.id)
    }
    const choques = Object.entries(dueños)
      .filter(([, ids]) => new Set(ids).size > 1)
      .map(([n, ids]) => `#${n}: ${[...new Set(ids)].join(', ')}`)
    expect(choques, 'hallazgo reclamado por varios items: ' + choques.join(' | ')).toEqual([])
  })

  it('el ledger no cita numeros fuera del mapa (ni fuera de los declarados sin numero)', () => {
    const conocidos = new Set([...Object.keys(MAPA).map(Number), ...SIN_NUMERO])
    const fuera: string[] = []
    for (const it of items()) {
      for (const n of numerosDe(it)) if (!conocidos.has(n)) fuera.push(`#${n} (${it.id})`)
    }
    expect(
      fuera,
      'numero de auditoria nuevo o inventado; actualiza MAPA o SIN_NUMERO: ' + fuera.join(', '),
    ).toEqual([])
  })

  it('el detector no es decorativo (mutation: caza el numero borrado)', () => {
    expect(numerosDe({ titulo: 'x', evidencia: 'Auditoria externa #14. algo' })).toEqual([14])
    expect(numerosDe({ titulo: 'auditoria #1', evidencia: '' })).toEqual([1])
    expect(numerosDe({ titulo: 'regla #1: sin hardcode', evidencia: 'auditoria #2' })).toEqual([2])
    expect(numerosDe({ titulo: 'x', evidencia: 'sin numero' })).toEqual([])
  })
})
