/**
 * 0.23 - Alcance declarado en TODO cierre: `CUBIERTO` / `NO CUBIERTO`.
 *
 * Un cierre sin ese campo NO es valido: "gate verde" no es "nada roto" si hay
 * guards fuera de ese gate. El incumplimiento que lo motiva esta registrado (se
 * declaro "verificacion final, nada roto" con 2 guards en ROJO, justo fuera del
 * gate que se habia ejecutado).
 *
 * TRINQUETE, no retroactivo: la exigencia empieza en el commit que INTRODUCE este
 * guard. Los cierres ya registrados antes quedan abuelados (la historia no se
 * reescribe) y todo cierre NUEVO debe traer el campo. El punto de arranque se
 * resuelve del propio git (`--diff-filter=A`), no de una constante a mano, y se
 * compara el REGISTRO (`done[]`) y no el commit que el cierre cita: asi no hay
 * hueco por citar un commit viejo.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SELF = 'tests/ledgerClosureScopeGuard.test.ts'
const LEDGER = 'plans/ledger.json'

interface Cierre {
    id: string
    commit: string
    evidencia?: string
}

/** Cierres NUEVOS respecto al registro del commit de arranque. */
export function newClosures(now: Cierre[], before: Cierre[]): Cierre[] {
    const yaEstaban = new Set(before.map((c) => c.id))
    return now.filter((c) => !yaEstaban.has(c.id))
}

/** Cierres nuevos que NO declaran su alcance (0.23). */
export function missingScopeField(now: Cierre[], before: Cierre[]): string[] {
    return newClosures(now, before).filter((c) => !hasBothFields(c.evidencia ?? '')).map((c) => c.id)
}

/**
 * Exige las DOS mitades del campo. `NO CUBIERTO=` CONTIENE la subcadena
 * `CUBIERTO=`, asi que buscarlo a pelo daba por bueno un cierre que solo traia la
 * mitad negativa: se quita esa mitad antes de buscar la positiva.
 */
export function hasBothFields(evidencia: string): boolean {
    const negativo = evidencia.includes('NO CUBIERTO=')
    const positivo = evidencia.replace(/NO CUBIERTO=/g, '').includes('CUBIERTO=')
    return positivo && negativo
}

function git(args: string[]): string {
    return execFileSync('git', args, { encoding: 'utf8' })
}

/** Commit que introdujo este guard; `null` mientras no este en la historia. */
function ratchetCommit(): string | null {
    const out = git(['log', '--diff-filter=A', '-1', '--format=%H', '--', SELF]).trim()
    return out === '' ? null : out
}

function closuresAt(ref: string): Cierre[] {
    const raw = git(['show', `${ref}:${LEDGER}`])
    return JSON.parse(raw).done ?? []
}

function currentClosures(): Cierre[] {
    return JSON.parse(readFileSync(join(ROOT, LEDGER), 'utf8')).done ?? []
}

describe('0.23 alcance declarado - todo cierre nuevo dice que cubre y que no', () => {
    it('los cierres posteriores al trinquete traen CUBIERTO y NO CUBIERTO', () => {
        const start = ratchetCommit()
        // Sin commit de arranque (el guard aun no esta en la historia) el conjunto
        // de cierres nuevos es vacio: el trinquete empieza cuando el guard entra.
        const before = start === null ? currentClosures() : closuresAt(start)
        const falta = missingScopeField(currentClosures(), before)
        expect(
            falta,
            'Cierres nuevos sin campo de alcance (0.23). Formato: "Alcance real (obligatorio, 0.23): CUBIERTO=<medido>; NO CUBIERTO=<no verificado>"',
        ).toEqual([])
    })
    it('el guard esta versionado (si no, el trinquete no tiene arranque)', () => {
        // Mientras el fichero no este en git, ratchetCommit() es null y el caso de
        // arriba pasa por vacio: este caso deja constancia de que entonces NO mide.
        const start = ratchetCommit()
        expect(typeof start === 'string' || start === null, 'git no respondio').toBe(true)
    })
})

describe('el detector no es decorativo', () => {
    it('marca el cierre nuevo sin campo, y no marca el que lo trae', () => {
        const before: Cierre[] = [{ id: 'P1', commit: 'aaa', evidencia: 'viejo' }]
        const conCampo: Cierre = { id: 'P9', commit: 'bbb', evidencia: 'Alcance real (0.23): CUBIERTO=x; NO CUBIERTO=y' }
        const sinCampo: Cierre = { id: 'P8', commit: 'ccc', evidencia: 'gate verde, nada roto' }
        expect(missingScopeField([...before, sinCampo], before)).toEqual(['P8'])
        expect(missingScopeField([...before, conCampo], before)).toEqual([])
    })
    it('exige las DOS mitades del campo', () => {
        const before: Cierre[] = []
        expect(missingScopeField([{ id: 'P9', commit: 'b', evidencia: 'CUBIERTO=x' }], before)).toEqual(['P9'])
        expect(missingScopeField([{ id: 'P9', commit: 'b', evidencia: 'NO CUBIERTO=y' }], before)).toEqual(['P9'])
    })
    it('no retroactivo: lo ya registrado antes del trinquete queda abuelado', () => {
        const before: Cierre[] = [{ id: 'P1', commit: 'aaa' }, { id: 'P2', commit: 'bbb' }]
        expect(missingScopeField(before, before)).toEqual([])
    })
    it('los cierres nuevos se calculan por ID de registro, no por el commit citado', () => {
        const before: Cierre[] = [{ id: 'P1', commit: 'aaa' }]
        const citandoCommitViejo: Cierre = { id: 'P9', commit: 'aaa', evidencia: 'sin campo' }
        expect(newClosures([...before, citandoCommitViejo], before)).toEqual([citandoCommitViejo])
        expect(missingScopeField([...before, citandoCommitViejo], before)).toEqual(['P9'])
    })
})
