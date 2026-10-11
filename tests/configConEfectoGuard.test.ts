// ============================================================
// configConEfectoGuard - C) NINGUNA CONFIGURACION PROMETE UN COMPORTAMIENTO SIN EFECTO.
// ------------------------------------------------------------
// REGLA DEL DUENO (2026-10-11): "ninguna configuracion que prometa un comportamiento sin
// efecto: consumir o borrar". Una clave de configuracion que se declara y NO se lee en ningun
// sitio promete un comportamiento que no existe (miente). Hoy no queda ninguna: 48 claves
// muertas se BORRARON en esta pasada (`deferNewSpeakerUntilCommit`, `registeredMatchRelax`,
// `preserveAllPreview`, `soundEnabled`, `conversationSettleStableMs`, `logRelateWindowMs`,
// las `roomRematch*` que nadie leia, ...).
//
// EL DETECTOR mide claves TECNICAS (valor numerico o booleano; las etiquetas son strings) que
// aparecen SOLO en su linea de declaracion.
// PRUEBA DE DETECTOR (mutacion): con una config sintetica que declare una clave tecnica sin
// lector, el detector DEBE listarla. Si deja de verla, el guard es decorativo.
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = 'src'
const CFG = join(ROOT, 'voice/lib/fluConfig.js')

/** Claves tecnicas (num/bool) declaradas y SIN ninguna lectura. Dueno unico del criterio.
 * `cfgTexto` es fluConfig.js; `textosFuera` son los ficheros de src EXCLUYENDO fluConfig.js. */
export function clavesTecnicasSinLector(cfgTexto: string, textosFuera: string[]): string[] {
  const decl = new Set<string>()
  for (const m of cfgTexto.matchAll(/^(\s{2,8})([A-Za-z_][A-Za-z0-9_]*):\s*(?:-?\d+(?:\.\d+)?|true|false)\s*,/gm)) {
    decl.add(m[2])
  }
  const muertas: string[] = []
  for (const clave of decl) {
    // Las claves con '_' son DATOS (mapas de acciones/etiquetas), no perillas de config.
    if (clave.includes('_')) continue
    const re = new RegExp('\\b' + clave + '\\b', 'g')
    let fuera = 0
    for (const t of textosFuera) fuera += (t.match(re) || []).length
    const enConfig = (cfgTexto.match(re) || []).length
    // Sin lector fuera y sin un getter que la lea dentro (>1 aparicion en el propio fluConfig).
    if (fuera === 0 && enConfig <= 1) muertas.push(clave)
  }
  return muertas.sort()
}

function leerSrc(): { cfg: string; textos: string[]; ficheros: string[] } {
  const ficheros: string[] = []
  ;(function walk(dir: string) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (/\.(js|ts|tsx)$/.test(e)) ficheros.push(p)
    }
  })(ROOT)
  const cfg = readFileSync(CFG, 'utf8')
  const esCfg = (f: string) => f.split(/[\\/]/).join('/').endsWith('src/voice/lib/fluConfig.js')
  const textos = ficheros.filter((f) => !esCfg(f)).map((f) => readFileSync(f, 'utf8'))
  return { cfg, textos, ficheros }
}

describe('C - ninguna config promete un comportamiento sin efecto', () => {
  it('el detector VE la fuente (anti-vaciedad: declara una cantidad realista de claves)', () => {
    const { cfg } = leerSrc()
    const declaradas = new Set<string>()
    for (const m of cfg.matchAll(/^(\s{2,8})([A-Za-z_][A-Za-z0-9_]*):\s*(?:-?\d+(?:\.\d+)?|true|false)\s*,/gm)) declaradas.add(m[2])
    expect(declaradas.size, 'la fuente de config tiene que tener claves tecnicas').toBeGreaterThan(200)
  })

  it('PRUEBA DE DETECTOR (mutacion): una clave tecnica sin lector se lista', () => {
    const cfg = `const FLU_CONFIG = {\n  a: {\n    viva: 1,\n    muertaSinLector: 7,\n  },\n}`
    const muertas = clavesTecnicasSinLector(cfg, ['FLU_CONFIG.a.viva'])
    expect(muertas).toEqual(['muertaSinLector'])
  })

  it('ninguna clave tecnica de fluConfig queda sin lector', () => {
    const { cfg, textos, ficheros } = leerSrc()
    const muertas = clavesTecnicasSinLector(cfg, textos)
    const detalle = muertas.map((k) => {
      const i = ficheros.findIndex((f) => readFileSync(f, 'utf8').includes(k + ':'))
      const linea = i >= 0 ? readFileSync(ficheros[i], 'utf8').split(/\r?\n/).findIndex((l) => new RegExp('^\\s{2,8}' + k + ':').test(l)) + 1 : 0
      return `${i >= 0 ? ficheros[i] : 'src'}:${linea}:${k}`
    })
    expect(muertas, 'config sin efecto: consumir o borrar\n' + detalle.join('\n')).toEqual([])
  })
})
