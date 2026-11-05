/**
 * revisorFuncionesGuard — el revisor que corre ANTES de crear una función.
 *
 * No demuestra equivalencia semántica (no es decidible). Comprueba lo que sí se
 * puede medir: que los candidatos existentes se presenten antes de escribir, por
 * pregunta, nombre, firma y clon normalizado, y que el veredicto sea obligatorio.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buscarCandidatos,
  indexarFunciones,
  indexarRepo,
  loadCasosRuta,
  normalizarTokens,
} from '../scripts/revisor-funciones.mjs'

type Funcion = {
  archivo: string
  linea: number
  nombre: string
  nombreCompleto: string
  exportada: boolean
  params: number
  tipos: string[]
  retorno: string
  jsdoc: string
  tokens: string[]
}

type Candidato = {
  origen: 'funcion' | 'caso'
  archivo?: string
  linea?: number
  nombre?: string
  owner?: string
  id?: string
  descripcion?: string
  puntaje: number
  motivos: string[]
}

type Caso = {
  id: string
  owner: string
  description: string
}

type Propuesta = {
  pregunta: string
  nombre: string
  firma?: { parametros?: number; tipos?: string[] }
  borrador?: string
}

const ROOT = process.cwd()

/** Fixture mínimo con la forma real de la dueña de «la última fila». */
function fuenteFila(): string {
  return `
/** Última fila commiteada según el fin de su audio. */
export function ultimaFilaPorFin(filas: Iterable<Fila>): Fila | null {
  let ultima: Fila | null = null
  for (const fila of filas) {
    if (!ultima || fila.tramo.fin > ultima.tramo.fin) ultima = fila
  }
  return ultima
}
`
}

describe('revisorFunciones — índice', () => {
  it('indexa funciones anidadas y propiedades que contienen una función', () => {
    const fuente = `
/** Crea el flujo de texto. */
export function crearFlujo(filas: Fila[]) {
  /**
   * Última fila commiteada según el fin de su audio.
   */
  function ultimaFilaPorFin(filas: Iterable<Fila>): Fila | null {
    let ultima = null
    for (const fila of filas) {
      if (!ultima || fila.tramo.fin > ultima.tramo.fin) ultima = fila
    }
    return ultima
  }
  return ultimaFilaPorFin(filas)
}

const adaptadores = {
  esComandoDeControl: (texto: string): boolean => texto.includes('cerrar'),
}
`
    const funciones = indexarFunciones(fuente, 'demo.ts') as Funcion[]
    const nombres = funciones.map((f) => f.nombreCompleto)
    expect(nombres).toEqual(
      expect.arrayContaining([
        'crearFlujo',
        'crearFlujo.ultimaFilaPorFin',
        'adaptadores.esComandoDeControl',
      ]),
    )
    const ultima = funciones.find((f) => f.nombre === 'ultimaFilaPorFin')
    expect(ultima).toMatchObject({ params: 1, exportada: false })
    expect(ultima?.jsdoc).toContain('Última fila')
  })
})

describe('revisorFunciones — clones normalizados', () => {
  it('dos copias renombradas producen la misma secuencia', () => {
    const a = `function a(xs) {
      let u = null
      for (const x of xs) {
        if (!u || x.fin > u.fin) u = x
      }
      return u
    }`
    const b = `function b(items) {
      let pick = null
      for (const item of items) {
        if (!pick || item.fin > pick.fin) pick = item
      }
      return pick
    }`
    expect(normalizarTokens(a)).toEqual(normalizarTokens(b))
  })

  it('una lógica distinta no produce la misma secuencia', () => {
    const a = `function a(xs) { return xs.length }`
    const b = `function b(xs) { for (const x of xs) { if (x) return x } return null }`
    expect(normalizarTokens(a)).not.toEqual(normalizarTokens(b))
  })
})

describe('revisorFunciones — candidatos', () => {
  it('encuentra por pregunta y sinónimos aunque el nombre sea distinto', () => {
    const funciones = indexarFunciones(fuenteFila(), 'src/voice/conversation/fila.ts') as Funcion[]
    const propuesta: Propuesta = {
      pregunta: '¿Cuál es la fila más reciente según el final del audio?',
      nombre: 'filaMasRecientePorFin',
      firma: { parametros: 1 },
    }
    const candidatos = buscarCandidatos(propuesta, funciones) as Candidato[]
    expect(candidatos[0]).toMatchObject({
      nombre: 'ultimaFilaPorFin',
      archivo: 'src/voice/conversation/fila.ts',
    })
    expect(candidatos[0].motivos.join(' ')).toMatch(/pregunta/i)
  })

  it('el borrador idéntico renombrado se marca como clon', () => {
    const funciones = indexarFunciones(fuenteFila(), 'src/voice/conversation/fila.ts') as Funcion[]
    const borrador = `function filaMasReciente(items: Iterable<Fila>): Fila | null {
      let elegida: Fila | null = null
      for (const item of items) {
        if (!elegida || item.tramo.fin > elegida.tramo.fin) elegida = item
      }
      return elegida
    }`
    const propuesta: Propuesta = {
      pregunta: '¿Cuál es la última fila?',
      nombre: 'filaMasReciente',
      borrador,
    }
    const candidatos = buscarCandidatos(propuesta, funciones) as Candidato[]
    const hit = candidatos.find((c) => c.nombre === 'ultimaFilaPorFin')
    expect(hit?.motivos.join(' ')).toMatch(/clon/i)
  })

  it('no inventa candidato para una pregunta ajena en un fixture', () => {
    const funciones = indexarFunciones(fuenteFila(), 'src/voice/conversation/fila.ts') as Funcion[]
    const propuesta: Propuesta = {
      pregunta: '¿Cómo se genera un UUID v4?',
      nombre: 'nuevoUuid',
    }
    const candidatos = buscarCandidatos(propuesta, funciones) as Candidato[]
    expect(candidatos).toEqual([])
  })

  it('usa los casos declarados de ruta doble como preguntas con dueño', () => {
    const casos = loadCasosRuta() as Caso[]
    const propuesta: Propuesta = {
      pregunta: 'La última fila por fin de audio se calcula una sola vez',
      nombre: 'filaUnicaPorFin',
    }
    const candidatos = buscarCandidatos(propuesta, [], { casos }) as Candidato[]
    const hit = candidatos.find((c) => c.origen === 'caso' && c.id === 'ultima-fila-audio')
    expect(hit?.owner).toBe('src/voice/conversation/fila.ts')
  })
})

describe('revisorFunciones — caso real del repo', () => {
  it('un nombre nuevo para la última fila encuentra a ultimaFilaPorFin', () => {
    const funciones = indexarRepo(join(ROOT, 'src')) as Funcion[]
    const propuesta: Propuesta = {
      pregunta: '¿Cuál es la última fila commiteada según el fin de su audio?',
      nombre: 'filaMasRecientePorFin',
      firma: { parametros: 1 },
    }
    const candidatos = buscarCandidatos(propuesta, funciones) as Candidato[]
    const hit = candidatos.find(
      (c) => c.nombre === 'ultimaFilaPorFin' && c.archivo === 'src/voice/conversation/fila.ts',
    )
    expect(hit, `candidatos: ${JSON.stringify(candidatos.slice(0, 5))}`).toBeDefined()
    expect(hit!.puntaje).toBeGreaterThan(0.5)
  })
})
