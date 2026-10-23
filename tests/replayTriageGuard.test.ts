// @vitest-environment node
/**
 * GUARD del TRIAGE del replay (mandato del dueno 2026-10-23, SIN reclassificaciones):
 * el UNICO artefacto admitido es el DUPLICADO EXACTO de la fuente, con sus ids.
 *  - un missing cuya frase la fuente escribio DOS veces -> copia, no perdida;
 *  - un missing cuya frase la fuente escribio UNA vez -> `bug-perdida` (aunque el ASR la
 *    haya dicho: decirlo no es escribir la fila);
 *  - un extra con el MISMO texto en la fuente -> repetida, con su id;
 *  - un extra sin esa fila -> `bug-invencion` (aunque el ASR lo dijera).
 * Se retiraron las clases que absolvian por definicion (cola-sin-final, habla-del-asr,
 * mixtura-del-asr, particion-hipotesis, mezcla-de-hipotesis).
 */
import { describe, expect, it } from 'vitest'
import { clasificarFuente } from '../scripts/replay/compareExpected.mjs'

type Fila = { text: string; clase: string; ids?: Array<number | string | null> }

const fuente = [
  { id: 101, text: 'Dios te bendiga mi amor estoy muy orgullosa de ti' },
  { id: 102, text: 'Dios te bendiga mi amor estoy muy orgullosa de ti' },
  { id: 103, text: 'Qué pasó el juez me sacó no vayas a hacer una tontería' },
  { id: 104, text: 'estás ahí' },
  { id: 105, text: 'estás ahí' },
]

describe('triage del replay: solo el duplicado EXACTO de la fuente absuelve', () => {
  it('missing cuya frase la fuente escribio DOS veces -> copia, con los ids de la fuente', () => {
    const { missing, bugsMissing } = clasificarFuente(
      [{ text: 'Dios te bendiga mi amor estoy muy orgullosa de ti' }],
      [],
      { sourceRows: fuente },
      [],
    ) as { missing: Fila[]; bugsMissing: number }

    expect(missing[0].clase).toBe('duplicado-exacto-de-fuente')
    expect(missing[0].ids).toEqual([101, 102])
    expect(bugsMissing).toBe(0)
  })

  it('missing que la fuente escribio UNA vez -> bug-perdida (el ASR decirlo NO absuelve)', () => {
    const { missing, bugsMissing } = clasificarFuente(
      [{ text: 'Qué pasó el juez me sacó no vayas a hacer una tontería' }],
      [],
      { sourceRows: fuente },
      [{ text: 'Qué pasó el juez me sacó' }, { text: 'no vayas a hacer una tontería' }],
    ) as { missing: Fila[]; bugsMissing: number }

    expect(missing[0].clase).toBe('bug-perdida')
    expect(missing[0].ids).toEqual([103])
    expect(bugsMissing).toBe(1)
  })

  it('extra con el MISMO texto en la fuente -> repetida, con su id', () => {
    const { extra, bugsExtra } = clasificarFuente([], [{ text: 'estás ahí' }], { sourceRows: fuente }, []) as {
      extra: Fila[]
      bugsExtra: number
    }

    expect(extra[0].clase).toBe('duplicado-exacto-de-fuente')
    expect(extra[0].ids).toEqual([104, 105])
    expect(bugsExtra).toBe(0)
  })

  it('MUTACION: un extra que la fuente NO tiene -> bug-invencion (aunque el ASR lo dijera)', () => {
    const { extra, bugsExtra } = clasificarFuente([], [{ text: 'tenía razón' }], { sourceRows: fuente }, []) as {
      extra: Fila[]
      bugsExtra: number
    }

    expect(extra[0].clase).toBe('bug-invencion')
    expect(bugsExtra).toBe(1)
  })

  it('MUTACION: un missing sin ninguna fila de la fuente que lo respalde -> bug-perdida', () => {
    const { missing, bugsMissing } = clasificarFuente(
      [{ text: 'Okay flow soy Luis' }],
      [],
      { sourceRows: fuente },
      [],
    ) as { missing: Fila[]; bugsMissing: number }

    expect(missing[0].clase).toBe('bug-perdida')
    expect(bugsMissing).toBe(1)
  })

  it('G U A R D: ninguna fila queda sin clase y ninguna clase absolvia sin prueba', () => {
    const r = clasificarFuente(
      [{ text: 'estás ahí' }, { text: 'texto que la fuente no tiene' }],
      [{ text: 'estás ahí' }, { text: 'otro texto inventado' }],
      { sourceRows: fuente },
      [],
    ) as { missing: Fila[]; extra: Fila[]; unclassifiedMissing: number; unclassifiedExtra: number }

    expect(r.unclassifiedMissing).toBe(0)
    expect(r.unclassifiedExtra).toBe(0)
    const CLASES = new Set(['duplicado-exacto-de-fuente', 'bug-perdida', 'bug-invencion'])
    expect(r.missing.every((f) => CLASES.has(f.clase))).toBe(true)
    expect(r.extra.every((f) => CLASES.has(f.clase))).toBe(true)
    // El duplicado de la fuente NO puede ser bug y lo que no esta en la fuente NO puede absolverse.
    expect(r.missing.find((f) => f.text === 'estás ahí')?.clase).toBe('duplicado-exacto-de-fuente')
    expect(r.missing.find((f) => f.text === 'texto que la fuente no tiene')?.clase).toBe('bug-perdida')
    expect(r.extra.find((f) => f.text === 'estás ahí')?.clase).toBe('duplicado-exacto-de-fuente')
    expect(r.extra.find((f) => f.text === 'otro texto inventado')?.clase).toBe('bug-invencion')
  })
})
