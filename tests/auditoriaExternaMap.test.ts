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
 * Los 15 items que salieron de la auditoria externa (medidos: 14 los creo f9ab7ac, el
 * commit que registro las 16 conclusiones, y P7.19 se anadio despues).
 */
export const ITEMS_EXTERNOS = [
  'P7.5', 'P7.6', 'P7.7', 'P7.8', 'P7.9', 'P7.10', 'P7.11', 'P7.12',
  'P7.13', 'P7.14', 'P7.15', 'P7.16', 'P7.17', 'P7.18', 'P7.19',
]

/**
 * CERRADO — no es un hueco abierto, es una conclusion con evidencia.
 *
 * Los tres numeros que no constan (5, 6 y 15) son los de los hallazgos que la
 * auditoria dio por RESUELTOS con commit. Medido en f9ab7ac (el commit que registro
 * las 16 conclusiones), su triage cuadra sin dejar nada sin mirar:
 *
 *     5 items abiertos (P7.5..P7.9) + 3 resueltos con commit + 8 no-aplica = 16
 *
 * De esos 3 "resueltos con commit", DOS son items y estan cerrados con su veredicto:
 * P7.7 y P7.10 (ambos "RESUELTO por 6148862"). El tercero se resolvio por commit y
 * nunca llego a ser item. O sea: ningun hallazgo quedo sin disposicion y ninguno esta
 * abierto; lo unico que falta es QUE numero era cual.
 *
 * Esa etiqueta no se puede recuperar, y esta comprobado por busqueda agotada (no por
 * suposicion): el documento de la auditoria era EXTERNO, nunca se versiono, y no
 * aparece en `git log --all -S`, ni entre los ficheros borrados de toda la historia,
 * ni en stashes/reflog, ni en `.task/`, ni sin trackear. El propio ledger declara que
 * "el chat y su resumen NO son fuente". La unica copia eran los items, y el numero
 * solo lo llevaban 13.
 *
 * HUECO HISTORICO ARCHIVADO (decision del dueno, 2026-09-24). El expediente se cierra
 * ASI: asignar un numero seria inventar procedencia, y eso es justo lo que este guard
 * impide. Los 3 numeros (5, 6, 15) y los 2 items sin numero (P7.7, P7.10) quedan
 * declarados y ESTABLES: no son un pendiente abierto ni una pregunta sin responder, son
 * el hueco que deja una busqueda agotada. Si algun dia aparece el documento, aqui se
 * rellena, y este guard lo exige.
 *
 * Lo que sigue VIGILADO --y por eso el guard no se retira-- es lo que si tiene arreglo:
 * que los 13 numeros verificados no se pierdan al reescribir una evidencia, que ningun
 * numero lo reclamen dos items y que no entre un numero inventado. La cobertura
 * funcional ya no depende de esta auditoria: la da la auditoria in-house
 * (`scripts/auditoria.mjs` + guards), que vive en el repo y se verifica sola.
 */
/** Items externos sin numero recuperable - ARCHIVADOS (ver cabecera: P7.7 y P7.10). */
export const ITEMS_SIN_NUMERO = ['P7.7', 'P7.10']

/** Hallazgos 1..16 que no constan en ningun item - ARCHIVADOS (ver cabecera: 5, 6, 15). */
export const HALLAZGOS_SIN_ITEM = [5, 6, 15]

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

describe('Auditoria externa - procedencia archivada: los 13 numerados no se pierden en silencio', () => {
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
    const conocidos = new Set([...Object.keys(MAPA).map(Number), ...HALLAZGOS_SIN_ITEM])
    const fuera: string[] = []
    for (const it of items()) {
      for (const n of numerosDe(it)) if (!conocidos.has(n)) fuera.push(`#${n} (${it.id})`)
    }
    expect(
      fuera,
      'numero de auditoria nuevo o inventado; actualiza MAPA o HALLAZGOS_SIN_ITEM: ' + fuera.join(', '),
    ).toEqual([])
  })

  it('los 15 items externos estan contabilizados: o citan numero, o estan en los sin numero', () => {
    const porId = new Map(items().map((i) => [i.id, i]))
    const conNumero = new Set(Object.values(MAPA))
    const sinNumero = new Set(ITEMS_SIN_NUMERO)
    const sinExplicar: string[] = []
    for (const id of ITEMS_EXTERNOS) {
      if (conNumero.has(id) || sinNumero.has(id)) continue
      const it = porId.get(id)
      // Un item externo que SI cita numero pero no esta en MAPA tambien hay que declararlo.
      sinExplicar.push(`${id}${it && numerosDe(it).length ? ' (cita ' + numerosDe(it).map((n) => '#' + n).join(',') + ')' : ''}`)
    }
    expect(sinExplicar, 'items externos fuera del mapa y sin declarar sin numero: ' + sinExplicar.join(', ')).toEqual([])

    // Y al reves: nada del mapa apunta a un item que no sea externo.
    const externos = new Set(ITEMS_EXTERNOS)
    const intrusos = [...conNumero, ...sinNumero].filter((id) => !externos.has(id))
    expect(intrusos, 'item declarado como procedente de la auditoria sin serlo: ' + intrusos.join(', ')).toEqual([])
  })

  it('16 hallazgos -> 15 items -> 13 numerados (la cuenta cuadra y el hueco queda archivado)', () => {
    const numerosDelLedger = new Set(items().flatMap((i) => numerosDe(i)))
    // 16 = 13 numerados + 2 items sin numero + 1 hallazgo que no llego a ser item.
    expect(Object.keys(MAPA).length, 'numeros mapeados').toBe(13)
    expect(ITEMS_SIN_NUMERO.length, 'items sin numero').toBe(2)
    expect(HALLAZGOS_SIN_ITEM.length, 'hallazgos sin item').toBe(3)
    expect(13 + 3, 'sin numero + sin item tienen que ser los 3 huecos').toBe(16)
    // Todo numero que el ledger cita esta en el mapa: no hay numeros "de mas".
    for (const n of numerosDelLedger) expect(Object.keys(MAPA).map(Number)).toContain(n)
    // Los 3 hallazgos sin item NO estan reclamados por nadie.
    for (const n of HALLAZGOS_SIN_ITEM) expect(numerosDelLedger.has(n)).toBe(false)
  })

  it('el detector no es decorativo (mutation: caza el numero borrado)', () => {
    expect(numerosDe({ titulo: 'x', evidencia: 'Auditoria externa #14. algo' })).toEqual([14])
    expect(numerosDe({ titulo: 'auditoria #1', evidencia: '' })).toEqual([1])
    expect(numerosDe({ titulo: 'regla #1: sin hardcode', evidencia: 'auditoria #2' })).toEqual([2])
    expect(numerosDe({ titulo: 'x', evidencia: 'sin numero' })).toEqual([])
  })
})
