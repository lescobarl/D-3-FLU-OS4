// ============================================================
// mediaRouteSingle.test.ts — Guard ESTRUCTURAL de ruta única
// ------------------------------------------------------------
// Invariante (§8.6): la generación de medios (video/documento) tiene UNA sola
// ruta. Si alguien reintroduce un segundo camino (despacho de eventos
// GENERATE_* o suscripción en el bridge), este guard FALLA.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(join(process.cwd(), relative), 'utf8');

describe('ruta ÚNICA de generación de medios (sin doble ruta)', () => {
    it('App NO despacha eventos GENERATE_VIDEO/DOCUMENT (usa la puerta requestMedia)', () => {
        const app = read('src/App.tsx');
        expect(app).not.toMatch(/dispatchFluEvent\(\s*FLU_EVENTS\.GENERATE_VIDEO/);
        expect(app).not.toMatch(/dispatchFluEvent\(\s*FLU_EVENTS\.GENERATE_DOCUMENT/);
        expect(app).toMatch(/requestMediaRef/);
    });

    it('el bridge ya NO suscribe GENERATE_VIDEO/DOCUMENT (era la 2.ª ruta)', () => {
        const bridge = read('src/hooks/useDocumentGenerationBridge.ts');
        expect(bridge).not.toMatch(/onFluEvent\(\s*FLU_EVENTS\.GENERATE_VIDEO/);
        expect(bridge).not.toMatch(/onFluEvent\(\s*FLU_EVENTS\.GENERATE_DOCUMENT/);
    });

    it('la navegación usa la puerta idempotente requestMedia', () => {
        const nav = read('src/hooks/useNavigationCommands.ts');
        expect(nav).toMatch(/requestMedia/);
    });
});
