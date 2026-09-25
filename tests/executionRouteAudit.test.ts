// ============================================================
// executionRouteAudit.test.ts — Guard ESTRUCTURAL de rutas únicas
// ------------------------------------------------------------
// Auditoría de un turno: cada intención debe tener UN punto de ejecución.
// Si alguien agrega una segunda ruta, este guard FALLA (patrón §8.6).
//   - Navegación: 1 invocación de handleNavigationCommand en App.
//   - Respuesta FLU: 1 commit (addFluMessage) en App.
//   - Acciones de dominio: 1 helper (dispatchArbiterIntent) con 2 entradas
//     EXCLUYENTES por hasAcciones (ruta LLM vs ruta offline). Si se rompe la
//     exclusión (se solapan), falla.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = (): string => readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const count = (src: string, re: RegExp): number => (src.match(re) || []).length;

describe('auditoría de rutas de ejecución (una por intención)', () => {
    it('navegación: un único punto de ejecución (handleNavigationCommand)', () => {
        expect(count(app(), /await handleNavigationCommand\(/g)).toBe(1);
    });

    it('respuesta FLU: un único commit (logFluReply) en el módulo dueño', () => {
        // El escritor de la fila de FLU vive en UN módulo; App solo lo invoca.
        expect(count(app(), /addFluMessage\(/g)).toBe(0);
        expect(count(app(), /logFluReply\(/g)).toBeGreaterThan(0);
        const logModule = readFileSync(
            join(process.cwd(), 'src/voice/lib/fluConversationLog.ts'),
            'utf8',
        );
        expect(count(logModule, /addFluMessage\(/g)).toBe(1);
    });

    it('acciones de dominio: 1 helper y 2 entradas EXCLUYENTES por hasAcciones', () => {
        const src = app();
        // Definición + 2 llamadas (ruta LLM, ruta offline).
        expect(count(src, /dispatchArbiterIntent\(/g)).toBe(3);
        // La exclusión es lo que evita el doble despacho del mismo turno.
        expect(src).toMatch(/hasAcciones && !rawOnly/);
        expect(src).toMatch(/!rawOnly && !hasAcciones/);
    });

    it('no existe un segundo despacho de eventos para generar medios', () => {
        const src = app();
        expect(src).not.toMatch(/dispatchFluEvent\(\s*FLU_EVENTS\.GENERATE_VIDEO/);
        expect(src).not.toMatch(/dispatchFluEvent\(\s*FLU_EVENTS\.GENERATE_DOCUMENT/);
    });
});
