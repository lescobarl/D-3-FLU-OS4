/**
 * style-inline-metric - mide el criterio de P6.12 (SOLO LECTURA).
 *
 * Imprime UN entero en stdout: cuantos bloques `style={{ ... }}` de src/ tienen
 * MAS de 3 declaraciones. Es el mismo modulo que importa
 * tests/styleInlineGuard.test.ts, para que la metrica del contrato y el guard no
 * puedan divergir.
 *
 * CRITERIO: "extendido" = mas de 3 declaraciones. Se eligio por medicion: de los
 * 104 `style={{` de src/, 96 son de UNA declaracion y en su mayoria dinamicos
 * (colors[kind], sig.color, isActive); convertirlos a CSS no es posible sin
 * cambiar el diseno, asi que "quitar estilos inline" sin umbral es una meta
 * infinita. Con el umbral en 3, los dos sitios legitimamente dinamicos que el
 * repo ya tenia (SignalPanel con la variable CSS `--signal-color`, y
 * FluAvatarVoiceBridge alternando dos estados) quedan fuera: tienen 2.
 *
 * DOS TRAMPAS del medidor, ambas medidas (y cubiertas por el guard):
 *  1) `}}` no es un cierre fiable: con cast el bloque acaba en
 *     `} as React.CSSProperties}`, que NO contiene `}}`. Un regex de `}}` deja
 *     esos bloques invisibles (SignalPanel.tsx lo estaba).
 *  2) Contar comas infla: la coma final no separa nada. `a, b, c,` son 3.
 *     Se cuentan PARTES NO VACIAS separadas por comas de nivel 2.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Declaraciones a partir de las cuales un estilo inline se considera extendido. */
export const MAX_DECL = 3

/**
 * Contenido del objeto de cada `style={{ ... }}` del texto, con su linea.
 * Escanea llaves (respetando comillas) hasta cerrar el objeto, asi que tambien
 * ve los bloques que terminan en `} as React.CSSProperties}`.
 */
export function rangosEstilo(texto) {
  const out = []
  const re = /style=\{\{/g
  let m
  while ((m = re.exec(texto))) {
    const i0 = m.index + m[0].length
    let depth = 2
    let comilla = null
    let finObjeto = -1
    let j = i0
    for (; j < texto.length; j++) {
      const c = texto[j]
      if (comilla) {
        if (c === '\\') {
          j++
          continue
        }
        if (c === comilla) comilla = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') comilla = c
      else if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth < 2) {
          finObjeto = j
          break
        }
      }
    }
    if (finObjeto >= 0) {
      out.push({
        contenido: texto.slice(i0, finObjeto),
        linea: texto.slice(0, m.index).split('\n').length,
      })
    }
  }
  return out
}

/** Declaraciones de un bloque: partes NO VACIAS separadas por comas de nivel 2. */
export function declaraciones(contenido) {
  let depth = 2
  let comilla = null
  const partes = ['']
  const ult = () => partes.length - 1
  for (const c of contenido) {
    if (comilla) {
      if (c === comilla) comilla = null
      partes[ult()] += c
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      comilla = c
      partes[ult()] += c
    } else if (c === '{' || c === '(' || c === '[') {
      depth++
      partes[ult()] += c
    } else if (c === '}' || c === ')' || c === ']') {
      depth--
      partes[ult()] += c
    } else if (c === ',' && depth === 2) {
      partes.push('')
    } else {
      partes[ult()] += c
    }
  }
  return partes.filter((p) => p.trim()).length
}

/** Ficheros .ts/.tsx de un arbol, en orden de recorrido. */
export function ficherosFuente(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) ficherosFuente(p, acc)
    else if (/\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

/** [fichero, linea, declaraciones] de cada estilo inline extendido del arbol. */
export function extendidos(fuente, acc = []) {
  for (const f of ficherosFuente(fuente)) {
    const texto = readFileSync(f, 'utf8')
    for (const r of rangosEstilo(texto)) {
      const d = declaraciones(r.contenido)
      if (d > MAX_DECL) acc.push([f.split('\\').join('/'), r.linea, d])
    }
  }
  return acc
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raiz = process.argv[2] || 'src'
  const fuera = extendidos(raiz)
  if (process.env.STYLE_INLINE_DETAIL === '1') {
    for (const [f, l, d] of fuera) console.error(`  ${f}:${l}  ${d} declaraciones`)
  }
  console.log(fuera.length)
}
