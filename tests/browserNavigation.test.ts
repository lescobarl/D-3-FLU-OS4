// ============================================================
// browserNavigation.test.ts — Navegación curada por voz → Pizarrón
// ------------------------------------------------------------
// Pruebas unitarias de la capa pura resolveBrowserNavigation:
//  1) Ruta válida → artefacto "Navegación curada" con URL y host.
//  2) Subdominios permitidos (es.wikipedia.org).
//  3) Reescritura http → https (navegador curado).
//  4) Dominio fuera de la allowlist → "Sitio no permitido".
//  5) Entrada vacía/inválida → "No pude entender la dirección".
// Reutiliza la misma allowlist y etiquetas de FLU_CONFIG (sin hardcode).
// ============================================================
import { describe, expect, it } from 'vitest';
import { resolveBrowserNavigation } from '../src/core/browser/browserNavigation';

const ALLOWLIST = ['wikipedia.org', 'educ.ar'];

// Etiquetas idénticas a FLU_CONFIG.browser.ui (Regla #1: sin hardcode).
const LABELS = {
    resultTitle: 'Navegación curada',
    blockedTitle: 'Sitio no permitido',
    invalidTitle: 'No pude entender la dirección',
    pointSite: 'Sitio: ',
    pointUrl: 'URL: ',
    pointQuery: 'Búsqueda: ',
};

describe('browserNavigation — resolveBrowserNavigation', () => {
    it('acepta un dominio permitido y construye el artefacto del Pizarrón', () => {
        const result = resolveBrowserNavigation('wikipedia.org', ALLOWLIST, 'https', LABELS);

        expect(result.ok).toBe(true);
        expect(result.reason).toBeUndefined();
        expect(result.url).toBe('https://wikipedia.org/');
        expect(result.host).toBe('wikipedia.org');
        expect(result.titulo).toBe('Navegación curada');
        expect(result.contenido).toBe('Navegación curada\n\nhttps://wikipedia.org/');
        expect(result.puntos_clave).toEqual([
            'Sitio: wikipedia.org',
            'URL: https://wikipedia.org/',
        ]);
    });

    it('acepta subdominios del dominio permitido', () => {
        const result = resolveBrowserNavigation('es.wikipedia.org', ALLOWLIST, 'https', LABELS);

        expect(result.ok).toBe(true);
        expect(result.url).toBe('https://es.wikipedia.org/');
        expect(result.host).toBe('es.wikipedia.org');
        expect(result.puntos_clave[0]).toBe('Sitio: es.wikipedia.org');
    });

    it('reescribe http → https cuando el esquema base es https', () => {
        const result = resolveBrowserNavigation('http://educ.ar', ALLOWLIST, 'https', LABELS);

        expect(result.ok).toBe(true);
        expect(result.url).toBe('https://educ.ar/');
        expect(result.host).toBe('educ.ar');
    });

    it('bloquea dominios fuera de la allowlist con reason "blocked"', () => {
        const result = resolveBrowserNavigation('example.com', ALLOWLIST, 'https', LABELS);

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('blocked');
        expect(result.host).toBe('example.com');
        expect(result.titulo).toBe('Sitio no permitido');
        expect(result.contenido).toBe('Sitio no permitido\n\nexample.com');
        expect(result.puntos_clave).toEqual(['Sitio: example.com']);
    });

    it('rechaza entradas vacías con reason "invalid"', () => {
        const result = resolveBrowserNavigation('', ALLOWLIST, 'https', LABELS);

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('invalid');
        expect(result.titulo).toBe('No pude entender la dirección');
        expect(result.contenido).toBe('No pude entender la dirección');
        expect(result.puntos_clave).toEqual([]);
    });
});
