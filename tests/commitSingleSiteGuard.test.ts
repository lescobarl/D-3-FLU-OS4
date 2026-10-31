/**
 * C26 — commitSingleSite: UN SOLO escritor de la fila del usuario (mandato
 * 2026-10-30, problema 6). Nace tras el corte que retiró la ruta doble
 * (escritor pasivo de App + dedupe simétrico del módulo).
 *
 * Invariante vigilado en TRES capas:
 *  A) el escritor pasivo retirado no deja rastro: `commitUserTurnRow`,
 *     `escribeFilaDeUsuario` y `crearEscritorFilaUsuario` son símbolos MUERTOS
 *     en todo `src` (si alguien los re-crea, vuelve la ruta doble);
 *  B) dentro de `src/voice/`, el ÚNICO `addConversationEntry` con `role:
 *     'user'` es el del módulo (`row.committed`, puerta de abajo) en
 *     `conversationMotorProducto.js` — exactamente UN sitio;
 *  C) fuera de `src/voice/`, NINGÚN consumidor commitea una fila de usuario
 *     por la puerta del store (las filas de sistema/FLU sí son legítimas).
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const RE_ADD = /addConversationEntry\s*\(/
const RE_RETIRADOS = /commitUserTurnRow\s*\(|escribeFilaDeUsuario|crearEscritorFilaUsuario/
const RE_ROL_USER = /role:\s*['"]user['"]/
const strip = (line: string) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

const FUENTES = /\.(ts|tsx|js|jsx|mjs)$/
const MODULO_ESCRITOR = 'src/voice/compose/conversationMotorProducto.js'
const dentroDeVoice = (r: string) => r.startsWith('src/voice/')

/**
 * ¿La llamada commitea una fila de usuario? Ventana simétrica de 8 líneas
 * alrededor del sitio: cubre el literal en línea (`addConversationEntry({...
 * role: 'user' })`) y la forma con variable construida junto a la llamada.
 */
const commiteaFilaDeUsuario = (lineas: string[], desde: number): boolean => {
  const inicio = Math.max(0, desde - 8)
  const bloque = lineas.slice(inicio, desde + 8).map(strip).join('\n')
  return RE_ROL_USER.test(bloque)
}

/** Sitios `addConversationEntry(` de un archivo: línea, texto y si commitean usuario. */
function sitios(f: string): Array<{ linea: number; texto: string; usuario: boolean }> {
  const lineas = readFileSync(f, 'utf8').split(/\r?\n/)
  const encontrados: Array<{ linea: number; texto: string; usuario: boolean }> = []
  lineas.forEach((linea, i) => {
    if (RE_ADD.test(strip(linea))) {
      encontrados.push({
        linea: i + 1,
        texto: linea.trim().slice(0, 110),
        usuario: commiteaFilaDeUsuario(lineas, i),
      })
    }
  })
  return encontrados
}

describe('C26 commitSingleSite — un solo escritor de la fila del usuario', () => {
  it('A) el escritor pasivo retirado no deja rastro en src', () => {
    const restos: string[] = []
    for (const f of walkFiles(SRC, FUENTES)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((linea, i) => {
          if (RE_RETIRADOS.test(strip(linea))) restos.push(`${r}:${i + 1}:${linea.trim()}`)
        })
    }
    expect(
      restos,
      `Símbolos del escritor retirado (N=${restos.length}); deben ser 0:\n  ${restos.join('\n  ')}`,
    ).toHaveLength(0)
  })

  it('B) dentro de src/voice/ el único commit de fila de usuario es el módulo (un sitio)', () => {
    const sitiosDeUsuario: string[] = []
    for (const f of walkFiles(join(ROOT, 'src/voice'), FUENTES)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      for (const s of sitios(f).filter((x) => x.usuario)) sitiosDeUsuario.push(`${r}:${s.linea}:${s.texto}`)
    }
    expect(
      sitiosDeUsuario,
      `Commits de fila de usuario en src/voice (N=${sitiosDeUsuario.length}); debe quedar SOLO el del módulo:\n  ${sitiosDeUsuario.join('\n  ')}`,
    ).toEqual([expect.stringMatching(new RegExp(`^${MODULO_ESCRITOR.replace(/\//g, '\\/')}:\\d+`))])
    expect(sitiosDeUsuario).toHaveLength(1)
  })

  it('C) ningún consumidor fuera de src/voice/ commitea la fila del usuario', () => {
    const infractores: string[] = []
    for (const f of walkFiles(SRC, FUENTES)) {
      const r = relative(ROOT, f).replace(/\\/g, '/')
      if (dentroDeVoice(r)) continue
      for (const s of sitios(f).filter((x) => x.usuario)) infractores.push(`${r}:${s.linea}:${s.texto}`)
    }
    expect(
      infractores,
      `Commits de fila de usuario FUERA de src/voice (N=${infractores.length}); deben ser 0 (sistema/FLU sí son legítimos):\n  ${infractores.join('\n  ')}`,
    ).toHaveLength(0)
  })
})

/** P2.4 - prueba de DETECTOR: el predicado del guard marca una entrada infractora
 *  sintética y PERDONA una limpia. Si alguien lo neutra (regex vacío, `true`...),
 *  este caso cae; el bucle sobre src que lo aplica lo cubren las aserciones de arriba. */
describe('P2.4 commitSingleSiteGuard - el detector no es decorativo', () => {
  it('marca un commit de fila de usuario y no marca uno de sistema', () => {
    // Forma con variable: el `role` se construye ANTES de la llamada.
    const deUsuario = ["  role: 'user',", 'useStore().addConversationEntry(entry);', '})']
    const deSistema = ["  role: 'system',", 'useStore().addConversationEntry(entry);', '})']
    expect(commiteaFilaDeUsuario(deUsuario, 1)).toBe(true)
    expect(commiteaFilaDeUsuario(deSistema, 1)).toBe(false)
  })

  it('marca los símbolos retirados y perdona una línea limpia', () => {
    const pred = (texto: string) => RE_RETIRADOS.test(strip(texto))
    expect(pred('await commitUserTurnRow(row)')).toBe(true)
    expect(pred('const n = escribeFilaDeUsuario.length')).toBe(true)
    expect(pred('renombrarFilaDeUsuario(r, n, deps)')).toBe(false)
  })
})
