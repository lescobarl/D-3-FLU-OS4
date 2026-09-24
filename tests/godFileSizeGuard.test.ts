/**
 * P6.6 - godFileSize: los god-files no vuelven a crecer.
 *
 * CONTEXTO MEDIDO: P6.6 saco de src/App.tsx cuatro bloques enteros (rutas de tab,
 * guardas de tipo, accion de configuracion y fast-path de juegos) con sus
 * pruebas: 5391 -> 4684 lineas (-13%). El trabajo de EXTRACCION de App.tsx queda
 * cerrado aqui; los otros god-files (voice/**) siguen intactos y les toca a
 * P6.7+.
 *
 * REGLA (trinquete, shrink-only): cada god-file de TECHOS tiene un techo escrito
 * que es EXACTAMENTE su tamano medido hoy. Solo puede bajar. Subir un techo es
 * una decision explicita que se ve en el diff (y se justifica en el ledger), no
 * un efecto colateral: sin este trinquete, un bloque que hoy vive extraido
 * podria volver a App.tsx sin que nadie lo note.
 *
 * El detector se prueba con una medida sintetica infractora y con una que no lo
 * es (prueba de mutacion): sin eso el guard podria estar en verde midiendo otra
 * cosa, o midiendo mal y tapando el crecimiento que dice vigilar.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Techos por fichero, medidos con `lineas()` el 2026-09-22 (sin margen: una
 * linea nueva obliga a decidir, no a pasar).
 */
export const TECHOS: Record<string, number> = {
  // +2 en P7.8: el ciclo de vida de los puentes se saco a src/app/fluBridges.ts, pero la
  // LLAMADA y su import siguen teniendo que estar en App (los manejadores se asignan ahi).
  'src/App.tsx': 4686, // 5391 antes de P6.6
  'src/voice/hooks/useFluVoiceAssistant.js': 4579,
  'src/voice/lib/fluConfig.js': 2772,
  'src/voice/lib/gemini.js': 1848,
}

/** Lineas de un texto, con el mismo criterio con que se midieron los techos. */
export function lineas(texto: string): number {
  return texto.split(/\r?\n/).length
}

/** Ficheros de `techos` que superan su techo, con la desviacion. */
export function excedidos(
  techos: Record<string, number>,
  medir: (fichero: string) => number,
): string[] {
  return Object.keys(techos)
    .filter((f) => medir(f) > techos[f])
    .map((f) => `${f}: ${medir(f)} > techo ${techos[f]}`)
}

const ROOT = process.cwd()

const medirFichero = (f: string): number => lineas(readFileSync(join(ROOT, f), 'utf8'))

describe('P6.6 godFileSize - el trinquete de tamano no se puede aflojar solo', () => {
  it('el detector marca al que pasa del techo y deja pasar al que no (prueba de mutacion)', () => {
    const techos = { 'a.ts': 100, 'b.ts': 50 }
    const medidas: Record<string, number> = { 'a.ts': 100, 'b.ts': 51 }
    expect(excedidos(techos, (f) => medidas[f])).toEqual(['b.ts: 51 > techo 50'])
    expect(excedidos(techos, () => 10)).toEqual([])
  })

  it('ningun god-file pasa de su techo', () => {
    const fuera = excedidos(TECHOS, medirFichero)
    expect(
      fuera,
      'estos god-files volvieron a crecer; saca el codigo a un modulo de src/app,\n' +
        'o sube el techo de forma deliberada (y justifica el nuevo tamano):\n  ' +
        fuera.join('\n  '),
    ).toEqual([])
  })

  it('los techos siguen siendo techos de verdad: cada uno coincide con el fichero', () => {
    const conMargen = Object.keys(TECHOS).filter((f) => medirFichero(f) < TECHOS[f] - 40)
    expect(
      conMargen,
      'un fichero BAJO de golpe y el techo no se aprieta (el trinquete solo puede bajar):\n  ' +
        conMargen.join('\n  '),
    ).toEqual([])
  })
})
