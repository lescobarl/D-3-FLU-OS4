// @vitest-environment node
// BARRERA: tramo-unico
/**
 * TRAMO ÚNICO — el tramo sintético y el `id.uuid()` como `tramoId` tienen UN
 * solo dueño. Cline creó una ruta duplicada inline en `texto.ts` (un tramo
 * acuñado con `id.uuid()` fuera de `ingesta.ts`) y el guard de nombres no lo
 * vio: medía funciones (`tramoSinteticoParaTexto`), no el sitio de la llamada.
 *
 * Este guard mide SITIOS en todo `src`:
 *  - `tramos.sintetico(`;
 *  - `tramoSinteticoParaTexto`;
 *  - `tramoId` asignado/declarado con `id.uuid()`.
 *
 * Dueños declarados:
 *  - `src/voice/conversation/ingesta.ts`: acuña el tramo sintético de texto y
 *    el tramo de la partición de voz.
 *  - `src/voice/conversation/tramos.ts`: la fábrica `sintetico` (su `sintetico:`
 *    no es una llamada `tramos.sintetico(`).
 *
 * FALSIFICACIÓN: el parche inline de cline en `texto.ts` debe marcar rojo.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()

const PATRONES = [
  { id: 'sintetico', re: /tramos\.sintetico\s*\(/g },
  { id: 'tramoSinteticoParaTexto', re: /tramoSinteticoParaTexto\b/g },
  { id: 'tramoIdUuid', re: /tramoId\s*[:=][^\n;]*\bid\.uuid\s*\(/g },
] as const

/** Dueños declarados: archivo → patrones permitidos. */
const DUEÑOS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'src/voice/conversation/ingesta.ts': ['sintetico', 'tramoSinteticoParaTexto', 'tramoIdUuid'],
  // `texto.ts` puede pedir la fábrica para su texto tardío, pero NO acuñar un
  // tramoId con uuid (el parche inline de cline).
  'src/voice/conversation/texto.ts': ['sintetico'],
  'src/voice/conversation/tramos.ts': [],
})

type Infraccion = { archivo: string; patron: string }

/** Detecta los sitios de un texto; fuera de los dueños, todos son infracción. */
export function detectar(archivo: string, src: string): Infraccion[] {
  const permitidos = DUEÑOS[archivo] ?? []
  const infracciones: Infraccion[] = []
  for (const patron of PATRONES) {
    const coincidencias = src.match(patron.re) ?? []
    if (coincidencias.length > 0 && !permitidos.includes(patron.id)) {
      infracciones.push({ archivo, patron: patron.id })
    }
  }
  return infracciones
}

function archivos(dir: string): string[] {
  const salida: string[] = []
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    const info = statSync(ruta)
    if (info.isDirectory()) {
      salida.push(...archivos(ruta))
    } else if (/\.(ts|tsx|js|jsx)$/.test(entrada)) {
      salida.push(relative(RAIZ, ruta).replaceAll('\\', '/'))
    }
  }
  return salida
}

function escanearSrc(): Infraccion[] {
  return archivos(join(RAIZ, 'src')).flatMap((archivo) =>
    detectar(archivo, readFileSync(join(RAIZ, archivo), 'utf8')),
  )
}

describe('tramo único — el tramo sintético y el uuid como tramoId solo nacen en sus dueños', () => {
  it('ningún archivo fuera de los dueños acuña un tramo sintético o un tramoId con uuid', () => {
    expect(escanearSrc()).toEqual([])
  })

  it('el parche inline de cline en texto.ts se detecta (falsificación)', () => {
    const parcheCline = [
      'function fromText(texto) {',
      '  const tramoId = id.uuid()',
      '  return { tramoId, texto }',
      '}',
    ].join('\n')
    expect(detectar('src/voice/conversation/texto.ts', parcheCline)).toContainEqual({
      archivo: 'src/voice/conversation/texto.ts',
      patron: 'tramoIdUuid',
    })
  })

  it('el uso legítimo de ingesta.ts no se marca', () => {
    const legitimo = [
      'const tramoId = dependencias.id.uuid()',
      'const tramoId = tramoSinteticoParaTexto()',
      'tramos.sintetico({ inicio, fin, sampleRate })',
    ].join('\n')
    expect(detectar('src/voice/conversation/ingesta.ts', legitimo)).toEqual([])
  })

  it('la fuente real de texto.ts no tiene el inline', () => {
    const src = readFileSync(join(RAIZ, 'src/voice/conversation/texto.ts'), 'utf8')
    expect(detectar('src/voice/conversation/texto.ts', src)).toEqual([])
  })
})
