/**
 * Guard de comportamiento — el guardian, Puerta 1 de los hosts sin hooks.
 *
 * Ejecuta el flujo REAL: `verificarArchivoNuevo` corre `owner-gate` y
 * `revisor-prehook` por subproceso sobre un archivo YA escrito y BORRA el
 * archivo si una puerta bloquea. Falsifica el defecto que motivó el cambio:
 * Cline (y todo host sin API de hooks) escribe sin puerta previa; el guardian
 * alcanza el archivo justo después y lo retira si no debió existir.
 *
 * Las pruebas corren contra un REPO TEMPORAL (`raiz` → CLAUDE_PROJECT_DIR de
 * las puertas): un probe bajo el `src/` real chocaría con los guards que
 * caminan `src/` en paralelo (ENOENT medido en lint:guards).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verificarArchivoNuevo } from '../scripts/guardian.mjs'

/** Archivo de prueba bajo src/ del repo temporal. */
const PROBE = 'src/__guardian_probe__.ts'

/** Mapa temporal de dueños. Sin la fila: bloquea; con la fila: deja pasar. */
function mapaTexto(conProbe: boolean): string {
    return [
        '| Pregunta | Dueño | Nota |',
        '| --- | --- | --- |',
        `| ¿Probe del guardian? | \`${PROBE}:1\` \`guardianProbe\` | Test |`,
        '| ¿Probe sin fila? | `src/sin_fila.ts:1` `otraCosa` | Test |',
    ]
        .filter((fila) => conProbe || !fila.includes('__guardian_probe__'))
        .join('\n')
}

/** Repo temporal con docs/OWNERS.md y (opcional) el original del clon. */
function crearRepo(conProbe: boolean, conOriginal = false): string {
    const raiz = mkdtempSync(join(tmpdir(), 'guardian-repo-'))
    mkdirSync(join(raiz, 'docs'), { recursive: true })
    mkdirSync(join(raiz, 'src'), { recursive: true })
    writeFileSync(join(raiz, 'docs', 'OWNERS.md'), mapaTexto(conProbe))
    if (conOriginal) {
        const destino = join(raiz, 'src', 'voice', 'conversation')
        mkdirSync(destino, { recursive: true })
        // El original real del clon: la puerta debe encontrarlo en el índice
        // del repo temporal igual que lo encuentra en el repo real.
        writeFileSync(
            join(destino, 'fila.ts'),
            readFileSync(join(process.cwd(), 'src', 'voice', 'conversation', 'fila.ts'), 'utf8'),
        )
    }
    return raiz
}

let raizTemporal: string | null = null

afterEach(() => {
    if (raizTemporal) {
        rmSync(raizTemporal, { recursive: true, force: true })
        raizTemporal = null
    }
})

describe('guardian (Puerta 1 de hosts sin hooks)', () => {
    it('bloquea y BORRA un archivo NUEVO bajo src/ sin dueño declarado', () => {
        raizTemporal = crearRepo(false)
        writeFileSync(join(raizTemporal, PROBE), 'export const guardianProbe = 1;\n')
        const resultado = verificarArchivoNuevo(PROBE, { raiz: raizTemporal })
        expect(resultado.permitido).toBe(false)
        expect(resultado.borrado).toBe(true)
        expect(resultado.fallo).toBe(false)
        expect(resultado.reporte).toContain('owner-gate')
        expect(resultado.reporte).toContain('BLOQUEADO')
        expect(existsSync(join(raizTemporal, PROBE))).toBe(false)
    })

    it('bloquea y BORRA un clon exacto aunque el dueño ya esté declarado', () => {
        const clon = [
            'export function obtenerRegistroMasTardio(items: Iterable<Fila>): Fila | null {',
            '  let elegida: Fila | null = null',
            '  for (const item of items) {',
            '    if (!elegida || item.tramo.fin > elegida.tramo.fin) elegida = item',
            '  }',
            '  return elegida',
            '}',
        ].join('\n')
        raizTemporal = crearRepo(true, true)
        writeFileSync(join(raizTemporal, PROBE), clon)
        const resultado = verificarArchivoNuevo(PROBE, { raiz: raizTemporal })
        expect(resultado.permitido).toBe(false)
        expect(resultado.borrado).toBe(true)
        expect(resultado.reporte).toContain('revisor-funciones')
        expect(resultado.reporte).toContain('clon')
        expect(existsSync(join(raizTemporal, PROBE))).toBe(false)
    })

    it('deja pasar un archivo declarado y sin clones', () => {
        raizTemporal = crearRepo(true)
        writeFileSync(join(raizTemporal, PROBE), 'export const guardianProbe = 1;\n')
        const resultado = verificarArchivoNuevo(PROBE, { raiz: raizTemporal })
        expect(resultado.permitido).toBe(true)
        expect(resultado.borrado).toBe(false)
        expect(resultado.reporte).toContain('OK')
        expect(existsSync(join(raizTemporal, PROBE))).toBe(true)
    })

    it('reporta sin borrar si el archivo ya no existe', () => {
        const resultado = verificarArchivoNuevo(PROBE)
        expect(resultado.permitido).toBe(true)
        expect(resultado.reporte).toContain('ya no existe')
    })
})
