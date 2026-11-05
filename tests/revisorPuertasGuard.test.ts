/**
 * revisorPuertasGuard — contrato de las puertas que bloquean la creación.
 *
 * La puerta no decide por ti: si la función nueva se parece a una existente,
 * exige una declaración visible (`@revisor CREAR NUEVO — ...` o los trailers
 * del commit). Estas pruebas fijan ese contrato, no la semántica del revisor.
 */
import { describe, expect, it } from 'vitest'
import { indexarFunciones } from '../scripts/revisor-funciones.mjs'
import {
  evaluarFuncion,
  funcionesAgregadas,
  propuestaDeFuncion,
  veredictoDeclarado,
} from '../scripts/revisor-puertas.mjs'

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
  cuerpo: string
  tokens: string[]
}

type Evaluacion = {
  bloquea: boolean
  declarada: boolean
  topFuncion?: { nombre?: string; puntaje: number; clon?: number } | null
  topCaso?: { id?: string; puntaje: number } | null
  candidatos: Array<{ origen: string; nombre?: string; id?: string; puntaje: number }>
}

const FILA = `
/** Última fila commiteada según el fin de su audio. */
export function ultimaFilaPorFin(filas: Iterable<Fila>): Fila | null {
  let ultima: Fila | null = null
  for (const fila of filas) {
    if (!ultima || fila.tramo.fin > ultima.tramo.fin) ultima = fila
  }
  return ultima
}
`

const CLON = `
export function filaMasRecientePorFin(items: Iterable<Fila>): Fila | null {
  let elegida: Fila | null = null
  for (const item of items) {
    if (!elegida || item.tramo.fin > elegida.tramo.fin) elegida = item
  }
  return elegida
}
`

const CLON_DECLARADO = `
/**
 * ¿Cuál es la fila más reciente según el fin del audio?
 * @revisor CREAR NUEVO — copia deliberada para probar la puerta.
 */
export function filaMasRecientePorFin(items: Iterable<Fila>): Fila | null {
  let elegida: Fila | null = null
  for (const item of items) {
    if (!elegida || item.tramo.fin > elegida.tramo.fin) elegida = item
  }
  return elegida
}
`

const CLON_SIN_PALABRAS = `
export function obtenerRegistroMasTardio(items: Iterable<Fila>): Fila | null {
  let elegida: Fila | null = null
  for (const item of items) {
    if (!elegida || item.tramo.fin > elegida.tramo.fin) elegida = item
  }
  return elegida
}
`

const NUEVA = `
/** Genera un identificador UUID v4 aleatorio. */
export function generarUuidV4(): string {
  return crypto.randomUUID()
}
`

describe('revisorPuertas — qué función es nueva', () => {
  it('solo devuelve los nombres completos que no existían', () => {
    const viejas = indexarFunciones(FILA, 'src/voice/conversation/fila.ts') as Funcion[]
    const nuevas = indexarFunciones(`${FILA}\n${CLON}`, 'src/voice/conversation/fila.ts') as Funcion[]
    const agregadas = funcionesAgregadas(viejas, nuevas) as Funcion[]
    expect(agregadas.map((funcion) => funcion.nombre)).toEqual(['filaMasRecientePorFin'])
  })

  it('la propuesta usa el JSDoc como pregunta y quita la etiqueta del revisor', () => {
    const [funcion] = indexarFunciones(CLON_DECLARADO, 'src/voice/conversation/otra.ts') as Funcion[]
    const propuesta = propuestaDeFuncion(funcion) as {
      pregunta: string
      nombre: string
      borrador: string
    }
    expect(propuesta.nombre).toBe('filaMasRecientePorFin')
    expect(propuesta.pregunta).not.toMatch(/@revisor/i)
    expect(propuesta.pregunta).toMatch(/fila/i)
    expect(propuesta.borrador).toMatch(/for \(const item/)
    expect(funcion.cuerpo).toMatch(/return elegida/)
  })
})

describe('revisorPuertas — declaración', () => {
  it('acepta CREAR NUEVO y EXTENDER con motivo', () => {
    expect(veredictoDeclarado('/** @revisor CREAR NUEVO — dueña única de la última fila. */')).toBe(true)
    expect(veredictoDeclarado('/** @revisor EXTENDER src/a.ts:1 — reutiliza la existente. */')).toBe(true)
  })

  it('rechaza la etiqueta sin motivo y el veredicto REUSAR en una función nueva', () => {
    expect(veredictoDeclarado('/** @revisor CREAR NUEVO */')).toBe(false)
    expect(veredictoDeclarado('/** @revisor REUSAR src/a.ts:1 — no crees otra. */')).toBe(false)
  })

  it('acepta los trailers del commit solo con motivo suficiente', () => {
    expect(
      veredictoDeclarado(
        '',
        'Revisor-Funciones: CREAR NUEVO\nRevisor-Motivo: copia deliberada para la prueba.',
      ),
    ).toBe(true)
    expect(veredictoDeclarado('', 'Revisor-Funciones: CREAR NUEVO\nRevisor-Motivo: corto')).toBe(false)
  })
})

describe('revisorPuertas — bloqueo', () => {
  const existentes = indexarFunciones(FILA, 'src/voice/conversation/fila.ts') as Funcion[]

  it('bloquea un clon renombrado y muestra la dueña', () => {
    const [clon] = indexarFunciones(CLON, 'src/voice/conversation/otra.ts') as Funcion[]
    const evaluacion = evaluarFuncion(clon, existentes, []) as Evaluacion
    expect(evaluacion.bloquea).toBe(true)
    expect(evaluacion.topFuncion?.nombre).toBe('ultimaFilaPorFin')
    expect(evaluacion.topFuncion?.puntaje).toBeGreaterThanOrEqual(0.7)
  })

  it('bloquea un clon exacto aunque el nombre no comparta palabras con la dueña', () => {
    const [clon] = indexarFunciones(CLON_SIN_PALABRAS, 'src/voice/conversation/otra.ts') as Funcion[]
    const evaluacion = evaluarFuncion(clon, existentes, []) as Evaluacion
    expect(evaluacion.bloquea).toBe(true)
    expect(evaluacion.topFuncion?.nombre).toBe('ultimaFilaPorFin')
    expect(evaluacion.topFuncion?.clon).toBe(1)
  })

  it('deja pasar el clon si declara CREAR NUEVO', () => {
    const [clon] = indexarFunciones(CLON_DECLARADO, 'src/voice/conversation/otra.ts') as Funcion[]
    const evaluacion = evaluarFuncion(clon, existentes, []) as Evaluacion
    expect(evaluacion.bloquea).toBe(false)
    expect(evaluacion.declarada).toBe(true)
  })

  it('bloquea por el caso declarado aunque no haya funciones en el índice', () => {
    const [clon] = indexarFunciones(CLON, 'src/voice/conversation/otra.ts') as Funcion[]
    const casos = [
      {
        id: 'ultima-fila-audio',
        owner: 'src/voice/conversation/fila.ts',
        description:
          'La ultima fila por fin de audio se calcula una sola vez, en ultimaFilaPorFin.',
      },
    ]
    const evaluacion = evaluarFuncion(clon, [], casos) as Evaluacion
    expect(evaluacion.bloquea).toBe(true)
    expect(evaluacion.topCaso?.id).toBe('ultima-fila-audio')
  })

  it('no bloquea una función de otra pregunta', () => {
    const [nueva] = indexarFunciones(NUEVA, 'src/lib/uuid.ts') as Funcion[]
    const evaluacion = evaluarFuncion(nueva, existentes, []) as Evaluacion
    expect(evaluacion.bloquea).toBe(false)
  })
})
