// ============================================================
// bugsProductoMap — procedencia de los 11 bugs de producto (2026-09-14)
// ------------------------------------------------------------
// `plans/bugs-producto-2026-09-14.md` cita rutas y lineas que HOY no existen
// (`HorarioPizarron.tsx`, `deterministicArbiter.js:94`, `App.tsx:4490`): el codigo
// se movio y se reescribio. Sin un mapa, "¿siguen pendientes estos 11 casos?" no
// tiene respuesta: los casos se cerraron, el fichero envejecio y nadie se entero.
//
// MEDIDO (2026-09-22): los 11 casos estan cerrados por trabajo posterior.
//   - 10 tienen guard de comportamiento propio (nombrado abajo).
//   - El caso 8 quedo MOOT: la vista que contenia el campo Color desaparecio.
//
// Este guard NO re-verifica el comportamiento (eso es de cada guard, y son 136
// tests); fija la PROCEDENCIA: que cada caso siga teniendo su guard en disco y que
// el documento siga enumerando los 11. Si alguien borra un guard o un caso, se ve.
// ============================================================
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DOC = 'plans/bugs-producto-2026-09-14.md'

/** Caso del documento -> guard que lo cubre hoy. `null` = cerrado sin guard (moot). */
export const GUARDS: Record<number, string | null> = {
    1: 'tests/agendaQueryScenarios.test.ts',
    2: 'tests/useWorkspaceImageClear.test.ts',
    3: 'tests/minuteHandlersDayRollover.test.ts',
    4: 'tests/workspaceHubRestoreMedia.test.tsx',
    5: 'tests/documentTextVsBinary.test.ts',
    6: 'tests/injectedValues.test.ts',
    7: 'tests/audioAlertRepeat.test.ts',
    8: null,
    9: 'tests/conversationTurnSingleRow.test.ts',
    10: 'tests/noteRemoveIntent.test.ts',
    11: 'tests/noteSuperDestFirst.test.ts',
}

/** Un caso que se cierra sin guard necesita motivo escrito, no un hueco. */
export const SIN_GUARD_MOTIVO: Record<number, string> = {
    8: 'la vista HorarioPizarron que contenia el campo Color fue eliminada; ' +
        'sus responsabilidades pasaron a AgendaPanel, que no expone ese campo',
}

/** Guards declarados que NO existen en disco. */
export function guardsAusentes(
    guards: Record<number, string | null>,
    existe: (f: string) => boolean,
): string[] {
    return Object.entries(guards)
        .filter(([, g]) => g !== null && !existe(g))
        .map(([n, g]) => '#' + n + ' -> ' + g)
}

/** Casos cerrados sin guard y sin motivo escrito. */
export function sinMotivo(
    guards: Record<number, string | null>,
    motivos: Record<number, string>,
): string[] {
    return Object.entries(guards)
        .filter(([n, g]) => g === null && !motivos[Number(n)])
        .map(([n]) => '#' + n)
}

/** Numeros de caso que el documento ya no enumera (con su linea "N. **...**"). */
export function casosPerdidos(doc: string, numeros: number[]): string[] {
    return numeros
        .filter((n) => !new RegExp('^' + n + '\\.\\s', 'm').test(doc))
        .map(String)
}

const CASOS = Object.keys(GUARDS).map(Number).sort((a, b) => a - b)

describe('bugs de producto 2026-09-14 - procedencia: los 11 casos siguen trazados', () => {
    it('estan los 11 casos declarados (ninguno desaparece sin decirlo)', () => {
        expect(CASOS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    })

    it('cada guard declarado existe en disco', () => {
        const faltan = guardsAusentes(GUARDS, existsSync)
        expect(faltan, 'guard ausente (N=' + faltan.length + '): ' + faltan.join(', ')).toEqual([])
    })

    it('un caso sin guard tiene motivo escrito', () => {
        const huecos = sinMotivo(GUARDS, SIN_GUARD_MOTIVO)
        expect(huecos, 'cerrado sin guard y sin motivo: ' + huecos.join(', ')).toEqual([])
    })

    it('el documento sigue enumerando los 11 casos', () => {
        const perdidos = casosPerdidos(readFileSync(DOC, 'utf8'), CASOS)
        expect(perdidos, 'caso borrado del documento: ' + perdidos.join(', ')).toEqual([])
    })
})

// Prueba del DETECTOR (mutacion): sin esto el guard seria decorativo, porque un
// guard que nunca falla no se distingue de uno que no comprueba nada. Aqui se
// alimentan entradas infractoras sinteticas y se comprueba que el detector MARCA.
describe('prueba del detector (mutacion): el detector discrimina de verdad', () => {
    it('guardsAusentes marca el guard inexistente y respeta el que si existe', () => {
        const g: Record<number, string | null> = {
            1: 'tests/existe.test.ts',
            2: 'tests/no-existe.test.ts',
            8: null,
        }
        const existe = (f: string): boolean => f === 'tests/existe.test.ts'
        expect(guardsAusentes(g, existe)).toEqual(['#2 -> tests/no-existe.test.ts'])
    })

    it('sinMotivo marca el cierre sin guard y deja pasar el que tiene motivo', () => {
        expect(sinMotivo({ 8: null, 9: null }, { 8: 'vista eliminada' })).toEqual(['#9'])
    })

    it('casosPerdidos marca el caso que el documento ya no enumera', () => {
        expect(casosPerdidos('1. uno\n3. tres\n', [1, 2, 3])).toEqual(['2'])
    })
})
