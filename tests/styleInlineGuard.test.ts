/**
 * P6.12 - styleInlineGuard: los estilos inline EXTENDIDOS no vuelven.
 *
 * CRITERIO (el que cierra el item): "extendido" = bloque `style={{ ... }}` con
 * MAS de 3 declaraciones. Se eligio por medicion, no por gusto: de los 104
 * `style={{` de src/, 96 son de UNA declaracion y en su mayoria DINAMICOS
 * (colors[kind], sig.color, isActive, displayText): moverlos a CSS no es posible
 * sin cambiar el diseno, asi que "quitar estilos inline" sin umbral es una meta
 * infinita. Con el umbral en 3, los dos sitios legitimamente dinamicos que el
 * repo ya tenia quedan fuera: SignalPanel (variable CSS `--signal-color`) y
 * FluAvatarVoiceBridge (alterna dos estados) tienen 2.
 *
 * MEDIDO en base 1949f0c: 10 bloques por encima del umbral -> BunnyViewer 5 y 11,
 * FluSettingsPanel 6/6/4, ThinkingIndicator 22/7, AsrLab 5/4/4. No eran 8: la
 * lista descriptiva del item solo miraba "objeto a varias lineas", y asi se le
 * escapaban 3 de UNA linea (FluSettingsPanel:1130 y dos de AsrLab) y colaba 2
 * que el criterio deja pasar. El criterio manda, no la lista.
 *
 * Los 10 salieron a clase CSS (src/styles/unified.css y src/avatar/App.css). Los
 * valores que vienen de bunnySceneConfig.ts entran como variables CSS, para que
 * la config siga siendo la unica fuente. Hoy: 0.
 *
 * El detector se prueba aqui con entradas sinteticas (prueba de mutacion): sin
 * eso, un guard puede estar en verde midiendo otra cosa. Los dos casos que se
 * prueban a proposito son los dos puntos ciegos que tuvo la primera version del
 * detector, y que el propio medidor documenta.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MAX_DECL,
  declaraciones,
  extendidos,
  ficherosFuente,
  rangosEstilo,
} from '../scripts/style-inline-metric.mjs'

/** Declaraciones del primer `style={{ ... }}` de un texto sintetico. */
const decls = (texto: string): number => declaraciones(rangosEstilo(texto)[0].contenido)

describe('P6.12 styleInlineGuard - el criterio de estilo inline extendido', () => {
  it('el detector distingue infractor de limpio (prueba de mutacion)', () => {
    expect(decls('<div style={{ a: 1, b: 2, c: 3, d: 4 }} />')).toBe(4)
    expect(decls('<div style={{ a: 1, b: 2, c: 3 }} />')).toBe(MAX_DECL)
    expect(decls('<div style={{ a: 1 }} />')).toBe(1)
    expect(decls('<div style={{}} />')).toBe(0)
  })

  it('la coma FINAL no inventa una declaracion', () => {
    expect(decls("<div style={{ a: 1, b: 2, c: 3, }} />")).toBe(3)
  })

  it('las comas DENTRO de un valor no cuentan (rgba, arrays, objetos anidados)', () => {
    expect(decls("<div style={{ border: '1px solid rgba(1, 2, 3, 0.4)', grid: [1, 2] }} />")).toBe(2)
    expect(decls('<div style={{ a: { x: 1, y: 2 }, b: 3 }} />')).toBe(2)
  })

  it('un bloque con cast (`} as React.CSSProperties}`) SI se ve', () => {
    // Punto ciego real: ese bloque no contiene `}}`, asi que un regex de `}}` no
    // lo encuentra. Debe medirse igual que su equivalente sin cast.
    expect(decls('<div style={{ a: 1, b: 2, c: 3, d: 4 } as React.CSSProperties} />')).toBe(4)
    expect(decls('<div style={{ a: 1, b: 2, c: 3 } as React.CSSProperties} />')).toBe(MAX_DECL)
  })

  it('ningun estilo inline de src/ pasa de 3 declaraciones', () => {
    const fuera = extendidos('src')
    const informe = fuera.map(([f, l, d]) => `  ${f}:${l}  ${d} declaraciones`).join('\n')
    expect(
      fuera,
      'estilos inline extendidos. Saca la parte ESTATICA a una clase CSS (los valores que\n' +
        'vengan de config entren como variables CSS) y deja inline solo lo dinamico:\n' +
        informe,
    ).toEqual([])
  })

  it('el escaneo SI recorre los estilos inline del arbol (no es un no-op)', () => {
    // Si el detector dejara de encontrar bloques, el caso anterior pasaria por
    // vacio. Se exige que vea los ~100 `style={{` reales de src/.
    const bloques = ficherosFuente('src').reduce(
      (n, f) => n + rangosEstilo(readFileSync(f, 'utf8')).length,
      0,
    )
    expect(bloques).toBeGreaterThan(50)
    expect(rangosEstilo('const x = 1').length).toBe(0)
  })
})
