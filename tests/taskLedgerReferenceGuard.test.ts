/**
 * P7.4 - Referencias al ledger: ningun id `P#.#` citado apunta al vacio.
 *
 * POR QUE EXISTE: el ledger (plans/ledger.json) es la fuente UNICA de pendientes y de
 * cierres, pero solo sabe lo que alguien anoto. Un id que no existe deja trabajo
 * invisible. MEDIDO: el comentario de eslint.config.mjs nombraba la deuda de
 * exhaustive-deps como "P7.4" y P7.4 no existia en items[] ni en done[], asi que el
 * ledger podia decir "0 pendientes" mientras el codigo reconocia 63 violaciones de esa
 * regla. P7.1, P7.2 y P7.3 si existian: P7.4 era el hermano que nunca se creo.
 *
 * REGLA VIGILADA: todo `P#.#` en src/, tests/, scripts/ y config de raiz debe existir
 * en el ledger. El formato P#.# no tiene usos ajenos al ledger: 0 falsos positivos
 * medidos en los 766 ficheros de texto del repositorio. Es la misma exigencia que I1b
 * ya hace con los codigos declarados en git.
 *
 * ALCANCE DELIBERADO - POR QUE NO VIGILA LA FAMILIA C/T (medido, no supuesto):
 *   Con esta regla sola no se habrian visto C51 y C52, dos guards ENTEROS cuyo id nunca
 *   entro en done[] (su hermano C53 si). Se intento cubrirlos y el detector sobreconto:
 *     1) un RANGO real del repositorio ("se habilita con C1-C8") produce dos ids falsos;
 *     2) `C1` NO es identidad fiable: dos guards distintos lo reclaman
 *        (voiceDisplaySingleSource.test.ts y vozInstanciaUnicaGuard.test.ts) y ademas es
 *        fixture sintetico de guardMutationGuard.test.ts;
 *     3) `T1`/`T2` son datos de un test (`content: 'C1'`, `title: 'T2'`).
 *   Este repositorio ya pago ese error en P6.9 (los "91 TODO" eran la palabra espanola
 *   TODO) y su regla es explicita: un detector de higiene que sobrecuenta hay que medir
 *   el falso positivo antes de "arreglarlo". Asi que C51 (-> a6011aa) y C52 (-> 38a097e)
 *   se registraron a mano en vez de dejar un guard ruidoso.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT_DIR = resolve(__dirname, '..')
const LEDGER = 'plans/ledger.json'

/** ids registrados: un pendiente vive en items[], un cierre en done[]. */
export function idsDelLedger(ledger: {
  items?: Array<{ id: string }>
  done?: Array<{ id: string }>
}): Set<string> {
  const ids = new Set<string>()
  for (const x of ledger.items ?? []) ids.add(String(x.id))
  for (const x of ledger.done ?? []) ids.add(String(x.id))
  return ids
}

/** Ids `P#.#` de un texto, sin duplicados. */
export function idsPunto(texto: string): string[] {
  return [...new Set(texto.match(/\bP\d+\.\d+\b/g) ?? [])]
}

const EXTENSIONES = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.md'])
const DIRS = ['src', 'tests', 'scripts']
const RAIZ = ['AGENTS.md', 'eslint.config.mjs', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'package.json']
const IGNORAR = new Set(['node_modules', 'dist', '.git', 'coverage', 'plans', '.task'])

function recorrer(dir: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(entrada.name)) continue
    const p = join(dir, entrada.name)
    if (entrada.isDirectory()) recorrer(p, salida)
    else if (EXTENSIONES.has(p.slice(p.lastIndexOf('.')))) salida.push(p)
  }
  return salida
}

/** Ficheros vigilados, con su ruta relativa a la raiz (para mensajes legibles). */
export function ficherosVigilados(root = ROOT_DIR): string[] {
  const out: string[] = []
  for (const d of DIRS) {
    try {
      if (statSync(join(root, d)).isDirectory()) out.push(...recorrer(join(root, d)))
    } catch {
      // directorio ausente: no es un fallo del guard
    }
  }
  for (const f of RAIZ) {
    try {
      if (statSync(join(root, f)).isFile()) out.push(join(root, f))
    } catch {
      // fichero ausente: no es un fallo del guard
    }
  }
  return out
}

/** Referencias rotas: id -> ficheros que lo citan sin estar en el ledger. */
export function referenciasRotas(root = ROOT_DIR): Map<string, string[]> {
  const registrados = idsDelLedger(JSON.parse(readFileSync(join(root, LEDGER), 'utf-8')))
  const rotas = new Map<string, string[]>()
  for (const f of ficherosVigilados(root)) {
    const rel = f.slice(root.length + 1).split(sep).join('/')
    for (const id of idsPunto(readFileSync(f, 'utf-8'))) {
      if (registrados.has(id)) continue
      rotas.set(id, [...(rotas.get(id) ?? []), rel])
    }
  }
  return rotas
}

describe('Referencias al ledger', () => {
  it('todo id P#.# citado en el codigo existe en el ledger', () => {
    const rotas = referenciasRotas()
    const informe = [...rotas.entries()].map(([id, fs]) => `${id} <- ${fs.join(', ')}`)
    expect(informe, 'ids P#.# citados sin entrada en el ledger:\n  ' + informe.join('\n  ')).toEqual([])
  })

  it('el detector no es decorativo: ve un id inexistente y respeta los registrados', () => {
    expect(idsDelLedger({ items: [{ id: 'P7.1' }], done: [{ id: 'C53' }] })).toEqual(new Set(['P7.1', 'C53']))
    expect(idsPunto('ver P7.4 y tambien P3.1')).toEqual(['P7.4', 'P3.1'])
    // El formato sin digitos no es un id; una etiqueta C/T tampoco; un rango mucho menos.
    expect(idsPunto('formato P#.# sin digitos')).toEqual([])
    expect(idsPunto('title: T1, content: C1')).toEqual([])
    expect(idsPunto('se habilita con C1-C8')).toEqual([])
  })
})
