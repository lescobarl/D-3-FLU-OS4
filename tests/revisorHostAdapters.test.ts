/**
 * Guard de comportamiento — hosts de las puertas del revisor.
 *
 * Ejecuta el flujo REAL: el adaptador compartido corre `owner-gate` y
 * `revisor-prehook` por subproceso, igual que lo harán los plugins de Kilo y de
 * opencode. Falsifica el defecto que motivó el cambio: un archivo nuevo bajo
 * `src/` sin fila en `docs/OWNERS.md` debe bloquear la escritura, y un clon
 * exacto debe bloquear aunque el nombre no comparta palabras.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aplicarPuertasRevisor } from '../scripts/revisor-plugin-adapter.mjs'

/**
 * Devuelve el mensaje del bloqueo, o cadena vacía si la puerta permitió.
 * @param {() => void} accion Aplicación de las puertas.
 * @returns {string} Mensaje de error o ''.
 */
function mensajeDeBloqueo(accion: () => void): string {
    try {
        accion()
        return ''
    } catch (error) {
        return error instanceof Error ? error.message : String(error)
    }
}

describe('adaptador compartido de las puertas', () => {
    it('bloquea un archivo NUEVO bajo src/ sin dueño declarado', () => {
        const mensaje = mensajeDeBloqueo(() =>
            aplicarPuertasRevisor('write', {
                filePath: 'src/__adaptador_probe__.ts',
                content: 'export const adaptadorProbe = 1;\n',
            }),
        )
        expect(mensaje).toContain('owner-gate')
        expect(mensaje).toContain('BLOQUEADO')
    })

    it('bloquea un clon exacto aunque el nombre no comparta palabras', () => {
        const clon = [
            'export function obtenerRegistroMasTardio(items: Iterable<Fila>): Fila | null {',
            '  let elegida: Fila | null = null',
            '  for (const item of items) {',
            '    if (!elegida || item.tramo.fin > elegida.tramo.fin) elegida = item',
            '  }',
            '  return elegida',
            '}',
        ].join('\n')
        const mensaje = mensajeDeBloqueo(() =>
            aplicarPuertasRevisor('write', {
                filePath: 'src/voice/conversation/fila.ts',
                content: clon,
            }),
        )
        expect(mensaje).toContain('revisor-funciones')
        expect(mensaje).toContain('clon')
    })

    it('no intercepta herramientas que no escriben', () => {
        expect(() => aplicarPuertasRevisor('read', { filePath: 'src/cualquiera.ts' })).not.toThrow()
    })

    it('los dos hosts delegan en el mismo adaptador y no reimplementan las puertas', () => {
        for (const rel of ['.kilo/plugin/revisor.js', '.opencode/plugins/revisor.js']) {
            const fuente = readFileSync(join(process.cwd(), rel), 'utf8')
            expect(fuente).toContain('revisor-plugin-adapter.mjs')
            expect(fuente).toContain('aplicarPuertasRevisor')
            expect(fuente).toContain('tool.execute.before')
            expect(fuente).not.toContain("from 'node:child_process'")
        }
    })

    it('lanza Node del PATH, no process.execPath (los hosts corren sobre Bun)', () => {
        const fuente = readFileSync(join(process.cwd(), 'scripts/revisor-plugin-adapter.mjs'), 'utf8')
        expect(fuente).toContain('process.env.FLU_NODE')
        expect(fuente).not.toContain('spawnSync(process.execPath')
    })
})
