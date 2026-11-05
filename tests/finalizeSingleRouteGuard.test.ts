/**
 * C37 — finalizeSingleRoute: UNA sola ruta de escritura de fila (§9.3).
 *
 * RETARGET 2026-10-25: `finalizeTurnCommit` se retiró con la tubería vieja de
 * conversación. El dueño único de cerrar una locución —y por tanto de escribir
 * su fila— es la sesión del módulo CONVERSACIÓN: todas las causas de cierre
 * (stop, frontera, silencio, final del mismo tramo) pasan por
 * `sesion.cerrarLocucion`, que es el ÚNICO sitio que llama a `almacen.guardar`.
 *
 * Nace ROJO: dos llamadas a `almacen.guardar(` en la sesión.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const MODULE_DIR = join(ROOT, 'src', 'voice', 'conversation')
const ROW_WRITE = /almacen\.guardar\(/

/** Llamadas a la escritura de fila, alimentable (mismo criterio del guard). */
export function rowWriteCalls(src: string, file: string): string[] {
  const calls: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (ROW_WRITE.test(line)) calls.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`)
  })
  return calls
}

/** Ficheros `.ts` del módulo (sin subdirectorios: el módulo es plano). */
function moduleSources(): string[] {
  return readdirSync(MODULE_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(MODULE_DIR, name))
}

describe('C37 finalizeSingleRoute — una sola ruta de escritura de fila', () => {
  it('un único punto de llamada a almacen.guardar (y vive en cierre.ts)', () => {
    const calls = moduleSources().flatMap((file) =>
      rowWriteCalls(readFileSync(file, 'utf8'), file.replace(/\\/g, '/')),
    )
    expect(
      calls,
      `Escrituras de fila (N=${calls.length}); debe quedar 1:\n  ${calls.join('\n  ')}`,
    ).toHaveLength(1)
    expect(calls[0]).toContain('src/voice/conversation/cierre.ts:')
  })
})

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('C37 finalizeSingleRoute - el detector no es decorativo', () => {
  it('cuenta las llamadas sinteticas y ninguna en el sano', () => {
    expect(rowWriteCalls('almacen.guardar(fila)\nalmacen.guardar(fila)', 'f')).toHaveLength(2)
    expect(rowWriteCalls('const x = almacen.guardar(fila)', 'f')).toHaveLength(1)
    expect(rowWriteCalls('const a = 1', 'f')).toEqual([])
  })
})
