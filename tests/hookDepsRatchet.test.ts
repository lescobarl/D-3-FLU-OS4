/**
 * P7.4 - react-hooks/exhaustive-deps esta en 'off', asi que la deuda de deps de hooks
 * NO se ve: `lint` puede estar en verde con 63 violaciones dentro.
 *
 * Este guard NO paga la deuda. El ledger (P7.4) razona por que no se paga de golpe:
 * anadir o quitar deps en los efectos del flujo de voz cambia re-render y
 * suscripciones, y se paga POR ZONAS y con test de comportamiento, no a ciegas.
 * Lo que hace aqui es CONGELARLA: mide con la regla forzada a 'warn' y exige que el
 * recuento no suba, ni en total ni en los ficheros que la concentran. El trinquete
 * solo puede bajar.
 *
 * Ademas ata el numero a la fuente unica de verdad: si el ledger dice "63 violaciones
 * medidas" y la realidad dice otra cosa, este guard lo canta. Antes el numero vivia
 * en un comentario sin nada que lo comprobara.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/** Techo global. Solo puede BAJAR: si pagas una zona, bajalo en el mismo commit. */
export const TECHO_TOTAL = 59

/** Techos de los ficheros que concentran la deuda (medidos con `porFichero`). */
export const TECHO_POR_FICHERO: Record<string, number> = {
  'src/voice/hooks/useFluVoiceAssistant.js': 26,
  'src/App.tsx': 7,
  'src/hooks/useOnboarding.ts': 7,
  'src/hooks/useAvatarVoiceSync.ts': 2,
  'src/hooks/useMinuteKnowledge.ts': 2,
  'src/hooks/useWorkspaceImage.ts': 2,
}

export type Mensaje = { ruleId: string | null; message: string }
export type Resultado = { filePath: string; messages: Mensaje[] }

/** Clasifica por tipo. Ojo con el plural: "unnecessary dependenc(ies)". */
export function tipoDe(message: string): 'missing' | 'unnecessary' | 'complex' {
  if (/missing dependenc/.test(message)) return 'missing'
  if (/unnecessary dependenc/.test(message)) return 'unnecessary'
  return 'complex'
}

/** Cuenta las violaciones de exhaustive-deps por fichero y por tipo. */
export function porFichero(
  resultados: Resultado[],
  cwd = process.cwd(),
): { total: number; por: Record<string, number>; tipos: Record<string, number> } {
  const por: Record<string, number> = {}
  const tipos: Record<string, number> = { missing: 0, unnecessary: 0, complex: 0 }
  let total = 0
  for (const r of resultados) {
    const rel = relative(cwd, r.filePath).replace(/\\/g, '/')
    for (const m of r.messages) {
      if (m.ruleId !== 'react-hooks/exhaustive-deps') continue
      total += 1
      por[rel] = (por[rel] || 0) + 1
      tipos[tipoDe(m.message)] += 1
    }
  }
  return { total, por, tipos }
}

/** Ficheros por encima de su techo (o del global, si el techo es 0). */
export function excedidos(
  techos: Record<string, number>,
  medidos: Record<string, number>,
): string[] {
  return Object.keys(techos)
    .filter((f) => (medidos[f] || 0) > techos[f])
    .map((f) => `${f}: ${medidos[f] || 0} > techo ${techos[f]}`)
}

/** Numero que el ledger declara para P7.4 ("N violaciones"). */
export function totalDelLedger(ledger: string): number | null {
  const ev = JSON.parse(ledger).items.find((i: { id: string }) => i.id === 'P7.4')?.evidencia ?? ''
  const m = /(\d+)\s+violaciones/.exec(ev)
  return m ? Number(m[1]) : null
}

const ROOT = process.cwd()

/**
 * Ficheros de `src` VERSIONADOS. La medicion tiene que ser determinista: en la suite
 * completa se corren cientos de pruebas en paralelo y alguna deja ficheros
 * transitorios en `src`, que eslint contaria como deuda ajena. `git ls-files` los deja
 * fuera y ademas ata el trinquete a lo que de verdad se mantiene.
 */
export function ficherosVersionados(cwd = process.cwd()): string[] {
  return execFileSync('git', ['ls-files', 'src'], { cwd, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f))
}

let cacheo: ReturnType<typeof porFichero> | null = null

/**
 * Mide UNA vez por proceso. eslint sobre todo `src` tarda una decena de segundos, y la
 * suite completa corre cientos de ficheros en paralelo: medir tres veces por test hacia
 * saltar el timeout de vitest (que es justo lo que paso al anadir este guard).
 */
export async function medir(): Promise<ReturnType<typeof porFichero>> {
  if (cacheo) return cacheo
  const eslint = new ESLint({
    overrideConfigFile: join(ROOT, 'eslint.config.mjs'),
    overrideConfig: { rules: { 'react-hooks/exhaustive-deps': 'warn' } },
  })
  cacheo = porFichero((await eslint.lintFiles(ficherosVersionados())) as Resultado[], ROOT)
  return cacheo
}

describe('P7.4 hookDeps - la deuda de deps de hooks se congela, no se esconde', () => {
  it('el detector marca al que pasa del techo y deja pasar al que no (prueba de mutacion)', () => {
    const r: Resultado[] = [
      {
        filePath: join(ROOT, 'src/a.ts'),
        messages: [{ ruleId: 'react-hooks/exhaustive-deps', message: 'x has a missing dependency: y' }],
      },
      { filePath: join(ROOT, 'src/b.ts'), messages: [{ ruleId: 'otra-regla', message: 'da igual' }] },
    ]
    const { total, por, tipos } = porFichero(r, ROOT)
    expect(total).toBe(1)
    expect(por['src/a.ts']).toBe(1)
    expect(tipos).toEqual({ missing: 1, unnecessary: 0, complex: 0 })
    expect(excedidos({ 'src/a.ts': 0 }, por)).toEqual(['src/a.ts: 1 > techo 0'])
    expect(excedidos({ 'src/a.ts': 5 }, por)).toEqual([])
  })

  it('clasifica el plural de "unnecessary dependencies" (no lo confunde con compleja)', () => {
    expect(tipoDe('has unnecessary dependencies: "a" and "b"')).toBe('unnecessary')
    expect(tipoDe('has an unnecessary dependency: "a"')).toBe('unnecessary')
    expect(tipoDe('has a missing dependency: "a"')).toBe('missing')
    expect(tipoDe('has a complex expression in the dependency array')).toBe('complex')
  })

  it('no se pasa del techo: ni en total ni por fichero', async () => {
    const { total, por } = await medir()
    expect(total, `la deuda de deps de hooks crecio (era ${TECHO_TOTAL})`).toBeLessThanOrEqual(TECHO_TOTAL)
    expect(excedidos(TECHO_POR_FICHERO, por)).toEqual([])
  }, 120_000)

  it('los techos siguen siendo de verdad: coinciden con lo medido (sin margen)', async () => {
    const { total, por } = await medir()
    expect(
      total,
      'el total bajo: aprieta TECHO_TOTAL en el mismo commit (el trinquete solo puede bajar)',
    ).toBe(TECHO_TOTAL)
    const flojos = Object.keys(TECHO_POR_FICHERO).filter((f) => (por[f] || 0) < TECHO_POR_FICHERO[f])
    expect(flojos, 'un fichero bajo de techo: apriétalo (el trinquete solo puede bajar):\n  ' + flojos.join('\n  ')).toEqual([])
  }, 120_000)

  it('el numero del ledger es el numero real (no un comentario que envejece)', async () => {
    const { total } = await medir()
    const declarado = totalDelLedger(readFileSync(join(ROOT, 'plans/ledger.json'), 'utf8'))
    expect(declarado, 'P7.4 debe declarar "N violaciones" en su evidencia').toBe(total)
  }, 120_000)
})
