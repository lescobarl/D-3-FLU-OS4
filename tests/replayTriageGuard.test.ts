// @vitest-environment node
/**
 * GUARD del TRIAGE del replay: ninguna fila puede quedar sin categoría y ninguna clase "bug"
 * puede sobrevivir sin corregirse. Falsificación en los dos sentidos:
 *  - un missing cuyo final SÍ existe y ninguna fila del replay lo lleva -> `bug-perdida`
 *  - un extra con palabras que el ASR nunca dijo -> `bug-invencion`
 *  - el caso legítimo (cola sin final / habla del ASR / mixtura / partición) NO se marca como bug.
 */
import { describe, expect, it } from 'vitest'
import { clasificarFuente } from '../scripts/replay/compareExpected.mjs'

type Fila = { text: string; clase: string }

const digest = {
  finales: ['hola a todos', 'el juez me sacó', 'dios te bendiga mi amor estoy muy orgullosa de ti'],
  todos: [
    'hola a todos',
    'el juez me sacó',
    'dios te bendiga mi amor estoy muy orgullosa de ti',
    'no vayas a hacer una tontería',
    'lo va a salir bien',
    'unico que estuvo ahi',
  ],
}

describe('triage del replay: cada fila con su clase', () => {
  it('missing con FINAL en el ASR y sin fila equivalente en el replay -> bug-perdida', () => {
    const { missing, bugsMissing } = clasificarFuente(
      [{ text: 'dios te bendiga mi amor estoy muy orgullosa de ti' }],
      [],
      digest,
      [{ text: 'otra locucion distinta por completo' }],
    ) as { missing: Fila[]; bugsMissing: number }

    expect(missing[0].clase).toBe('bug-perdida')
    expect(bugsMissing).toBe(1)
  })

  it('missing cuya cola SOLO existe como interino -> cola-sin-final (no es bug)', () => {
    const { missing, bugsMissing } = clasificarFuente(
      [{ text: 'el juez me sacó no vayas a hacer una tontería' }],
      [],
      { finales: ['el juez me sacó'], todos: ['el juez me sacó', 'no vayas a hacer una tontería'] },
      [{ text: 'el juez sacó' }],
    ) as { missing: Fila[]; bugsMissing: number }

    expect(missing[0].clase).toBe('cola-sin-final')
    expect(bugsMissing).toBe(0)
  })

  it('missing que el replay SÍ escribió con otra partición -> particion-hipotesis', () => {
    const { missing, bugsMissing } = clasificarFuente(
      [{ text: 'hola a todos los presentes del juicio' }],
      [],
      digest,
      [{ text: 'hola a todos los presentes del juicio' }],
    ) as { missing: Fila[]; bugsMissing: number }

    expect(missing[0].clase).toBe('particion-hipotesis')
    expect(bugsMissing).toBe(0)
  })

  it('extra con palabras que el ASR dijo -> habla-del-asr (no es bug)', () => {
    const { extra, bugsExtra } = clasificarFuente([], [{ text: 'hola a todos' }], digest, []) as {
      extra: Fila[]
      bugsExtra: number
    }

    expect(extra[0].clase).toBe('habla-del-asr')
    expect(bugsExtra).toBe(0)
  })

  it('extra = dos tramos REALES unidos -> mixtura-del-asr (no es invención)', () => {
    const { extra, bugsExtra } = clasificarFuente(
      [],
      [{ text: 'lo va a salir bien dios te bendiga mi amor estoy muy orgullosa de ti' }],
      digest,
      [],
    ) as { extra: Fila[]; bugsExtra: number }

    expect(extra[0].clase).toBe('mixtura-del-asr')
    expect(bugsExtra).toBe(0)
  })

  it('MUTACION: un extra con palabras que nadie dijo -> bug-invencion', () => {
    const { extra, bugsExtra } = clasificarFuente(
      [],
      [{ text: 'mañana lloverá en la costa del pacifico' }],
      digest,
      [],
    ) as { extra: Fila[]; bugsExtra: number }

    expect(extra[0].clase).toBe('bug-invencion')
    expect(bugsExtra).toBe(1)
  })

  it('G U A R D: ninguna fila queda sin clase', () => {
    const r = clasificarFuente(
      [{ text: 'hola a todos' }, { text: '  ' }],
      [{ text: 'hola a todos' }, { text: '' }],
      digest,
      [{ text: 'hola a todos' }],
    ) as { missing: Fila[]; extra: Fila[]; unclassifiedMissing: number; unclassifiedExtra: number }

    expect(r.unclassifiedMissing).toBe(0)
    expect(r.unclassifiedExtra).toBe(0)
    expect(r.missing.every((f) => Boolean(f.clase))).toBe(true)
    expect(r.extra.every((f) => Boolean(f.clase))).toBe(true)
  })
})
