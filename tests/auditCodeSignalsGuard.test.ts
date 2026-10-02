/**
 * auditCodeSignalsGuard — barrera de la AUDITORIA DE CODIGO.
 *
 * Contexto medido (2026-10-02): `scripts/auditoria.mjs` decia "28/28 hallazgos en META"
 * mientras una auditoria propia encontraba duplicados de dato y dos detectores del
 * propio catalogo verdes por apuntar a ficheros inexistentes. Ese catalogo mide 28
 * puntos; NO mide el codigo. `scripts/auditoria-codigo.mjs` es la auditoria de CODIGO
 * (rutas dobles / parches / hardcode) con las mismas senales que se usaron a mano.
 *
 * Este guard es lo que impide que esas senales se vuelvan teatro (7.7.d / 7.7.f(2)):
 *   1) las 6 senales DEBEN disparar con su defecto sintetico y no marcar lo legitimo;
 *   2) el eje que se cerro (colisiones de export) DEBE seguir a 0 en el arbol real.
 * La senal de "mismo cuerpo" fallo su propio control negativo la primera vez (umbral de
 * 80 caracteres: no disparaba con un cuerpo copiado de 4 lineas) — exactamente el fallo
 * que este guard existe para cazar.
 *
 * Prueba de DETECTOR real (0.24): el caso sintetico alimenta el defecto y comprueba que el detector
 * lo marca; si el guard siguiera verde sin marcar, seria teatro.
 */
import { describe, expect, it } from 'vitest';
import {
    buildReport,
    exportedCollisions,
    homonymFunctions,
    patchedCode,
    readSources,
    runSelfTest,
} from '../scripts/auditoria-codigo.mjs';

describe('auditCodeSignalsGuard — la auditoria de codigo mide de verdad', () => {
    it('las 6 senales disparan con su defecto sintetico y no marcan lo legitimo', () => {
        expect(runSelfTest()).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: la senal de homonimos ve el homonimo sintetico', () => {
        const homonimos = homonymFunctions([
            { file: 'src/a.ts', source: 'function clamp(v) {\n  return v;\n}' },
            { file: 'src/b.ts', source: 'function clamp(v) {\n  return Math.max(0, v);\n}' },
        ]);
        expect(homonimos.map((h) => h.name)).toEqual(['clamp']);
    });

    it('PRUEBA DE DETECTOR: la senal de parches ve el monkey-patch sin marcar un comentario', () => {
        const parches = patchedCode([
            { file: 'src/a.ts', source: 'Array.prototype.map = function () {};' },
            { file: 'src/b.ts', source: '// Array.prototype.map = function () {};' },
        ]);
        expect(parches).toHaveLength(1);
        expect(parches[0]).toContain('src/a.ts:1');
    });

    it('COMPORTAMIENTO contra el arbol real: el eje cerrado sigue a 0 y el reporte recorre src', () => {
        const sources = readSources('src');
        expect(sources.length).toBeGreaterThan(300);
        // Las colisiones de export se cerraron (P8.6): 6 -> 0. Si vuelven, la senal lo dice.
        expect(exportedCollisions(sources)).toEqual([]);
        // El reporte es del arbol, no una constante: los homonimos que quedan son los del ledger.
        const nombres = buildReport('src').homonymFunctions.map((h) => h.name);
        expect(nombres).toContain('getAsrConfig');
        expect(nombres).not.toContain('buildMinuteKey');
    });
});
