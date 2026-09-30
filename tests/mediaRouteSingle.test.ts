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

/** Patrones de la regla, extraidos para poder probar el DETECTOR (P2.4). */
const PROHIBIDO_DESPACHO_VIDEO = /dispatchFluEvent\(\s*FLU_EVENTS\.GENERATE_VIDEO/;
const PROHIBIDO_DESPACHO_DOC = /dispatchFluEvent\(\s*FLU_EVENTS\.GENERATE_DOCUMENT/;
const PROHIBIDO_SUSCRIPCION_VIDEO = /onFluEvent\(\s*FLU_EVENTS\.GENERATE_VIDEO/;
const PROHIBIDO_SUSCRIPCION_DOC = /onFluEvent\(\s*FLU_EVENTS\.GENERATE_DOCUMENT/;
const PUERTA_MEDIA_REF = /requestMediaRef/;
const PUERTA_MEDIA = /requestMedia/;

describe('P2.4 mediaRouteSingle - el detector no es decorativo', () => {
    it('marca la doble ruta sintetica y perdona la puerta unica', () => {
        expect(PROHIBIDO_DESPACHO_VIDEO.test('dispatchFluEvent(FLU_EVENTS.GENERATE_VIDEO, x)')).toBe(true);
        expect(PROHIBIDO_DESPACHO_VIDEO.test('dispatchFluEvent(FLU_EVENTS.GENERATE_IMAGE, x)')).toBe(false);
        expect(PROHIBIDO_SUSCRIPCION_DOC.test('onFluEvent(FLU_EVENTS.GENERATE_DOCUMENT, h)')).toBe(true);
        expect(PUERTA_MEDIA_REF.test('const requestMediaRef = useRef(null)')).toBe(true);
        expect(PUERTA_MEDIA.test('const otra = 1')).toBe(false);
    });
});

describe('ruta ÚNICA de generación de medios (sin doble ruta)', () => {
    it('App NO despacha eventos GENERATE_VIDEO/DOCUMENT (usa la puerta requestMedia)', () => {
        const app = read('src/App.tsx');
        expect(app).not.toMatch(PROHIBIDO_DESPACHO_VIDEO);
        expect(app).not.toMatch(PROHIBIDO_DESPACHO_DOC);
        expect(app).toMatch(PUERTA_MEDIA_REF);
    });

    it('el bridge ya NO suscribe GENERATE_VIDEO/DOCUMENT (era la 2.ª ruta)', () => {
        const bridge = read('src/hooks/useDocumentGenerationBridge.ts');
        expect(bridge).not.toMatch(PROHIBIDO_SUSCRIPCION_VIDEO);
        expect(bridge).not.toMatch(PROHIBIDO_SUSCRIPCION_DOC);
    });

    it('la navegación usa la puerta idempotente requestMedia', () => {
        const nav = read('src/hooks/useNavigationCommands.ts');
        expect(nav).toMatch(PUERTA_MEDIA);
    });
});
