// ============================================================
// turnMultiItem — dos ítems del MISMO dominio en un turno ⇒ se estructuran AMBOS
// ------------------------------------------------------------
// Hallazgo de auditoría: al resolver el turno primero y deduplicar por DOMINIO,
// si un turno pedía dos notas (mismo dominio) la segunda se descartaba.
// Invariante: el dedup es por dominio + TEXTO; los fragmentos distintos del
// mismo dominio se conservan.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNoteIntentText } from '../src/voice/lib/noteIntentParser';

/** El dedup del turno es por dominio+TEXTO (mismo criterio del guard). */
export function dedupsByDomainAndText(src: string): boolean {
    return src.includes('coveredKeys') && !src.includes('coveredDomains');
}

describe('turno con dos ítems del MISMO dominio', () => {
    it('dos fragmentos de nota distintos se estructuran por separado', () => {
        const a = parseNoteIntentText('apunta comprar pan');
        const b = parseNoteIntentText('nota para el super');
        expect(a?.label).toBeTruthy();
        expect(b?.label).toBeTruthy();
        expect(String(a?.label).toLowerCase()).not.toBe(String(b?.label).toLowerCase());
    });

    it('App deduplica por dominio+TEXTO (no por dominio solo)', () => {
        const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
        // La clave de cobertura combina dominio y texto → mismo dominio, distinto
        // fragmento, se conserva; el fragmento idéntico se descarta.
        expect(dedupsByDomainAndText(app)).toBe(true);
    });
});

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('turno con dos items del MISMO dominio - el detector no es decorativo', () => {
    it('marca el dedup por texto y no el dedup por dominio solo', () => {
        expect(dedupsByDomainAndText('const k = coveredKeys')).toBe(true)
        expect(dedupsByDomainAndText('const k = coveredDomains')).toBe(false)
    })
})