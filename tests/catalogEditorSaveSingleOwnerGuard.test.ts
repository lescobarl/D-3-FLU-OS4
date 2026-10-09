// ============================================================
// P7.82 - El bloque de guardado de un panel de catalogo tiene un solo dueno.
// ============================================================
/**
 * CONTEXTO MEDIDO: AmbientesPanel, PaletasPanel y SearchCatalogPanel tenian el
 * MISMO bloque copiado (contexto -> alta/edicion -> exito cierra, fallo traduce
 * el motivo). Tres copias de una politica: cambiar el flujo obligaba a acertar
 * en las tres.
 *
 * REGLA (unica fuente): `saveCatalogEntry()` en
 * src/core/catalogs/catalogEditorSave.ts decide el flujo. Los paneles solo
 * aportan sus funciones y su traduccion de motivos.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { saveCatalogEntry } from '../src/core/catalogs/catalogEditorSave';

const PANELS = [
    'src/components/AmbientesPanel.tsx',
    'src/components/PaletasPanel.tsx',
    'src/components/SearchCatalogPanel.tsx',
];

/** Detecta el flujo copiado: comprobar contexto + ramificar por `mode`. */
export function countInlineSaveFlow(src: string): number {
    return (src.match(/if \(!editor\) return[\s\S]{0,400}?editor\.mode === 'create'/g) || []).length;
}

describe('P7.82 catalogEditorSave - un solo dueno del flujo de guardado', () => {
    it('ningun panel reintroduce el bloque de guardado', () => {
        const offenders = PANELS.map((f) => [f, countInlineSaveFlow(readFileSync(f, 'utf8'))] as const)
            .filter(([, n]) => n > 0);
        expect(
            offenders.map(([f, n]) => `${f}: ${n}`),
            'Usa saveCatalogEntry() de catalogEditorSave en vez de copiar el bloque',
        ).toEqual([]);
    });

    it('los tres paneles usan al dueno', () => {
        for (const f of PANELS) {
            const src = readFileSync(f, 'utf8');
        // El panel USA el dueno del flujo de guardado: llamandolo (`saveCatalogEntry`) o
        // delegando el envoltorio entero (`submitCatalogPanel`, que vive en
        // catalogPanelEditors.ts y es quien llama al dueno).
        expect(
            src.includes('saveCatalogEntry') || src.includes('submitCatalogPanel'),
            `${f} no usa el dueno del flujo de guardado (ni saveCatalogEntry ni submitCatalogPanel)`,
        ).toBe(true);
        }
    });

    it('el detector no es decorativo: marca el bloque copiado', () => {
        const copiado = `if (!editor) return ui.invalidError;\n        if (editor.mode === 'create') {\n            const result = await onRegister(payload);`;
        expect(countInlineSaveFlow(copiado)).toBe(1);
        expect(countInlineSaveFlow('const error = await saveCatalogEntry({ editor, payload });')).toBe(0);
    });

    it('sin contexto no guarda', async () => {
        let called = 0;
        const error = await saveCatalogEntry<{ id: string }>({
            editor: null,
            payload: { id: 'x' },
            invalidError: 'sin contexto',
            register: async () => {
                called++;
                return { ok: true, record: { id: 'x' } } as never;
            },
            update: async () => {
                called++;
                return { ok: true, record: { id: 'x' } } as never;
            },
            mapReason: () => 'no deberia usarse',
        });
        expect(error).toBe('sin contexto');
        expect(called).toBe(0);
    });

    it('en alta llama a register y en edicion a update con el id del editor', async () => {
        const seen: string[] = [];
        const register = async (p: { id: string }) => {
            seen.push(`register:${p.id}`);
            return { ok: true, record: p } as never;
        };
        const update = async (id: string, p: { id: string }) => {
            seen.push(`update:${id}:${p.id}`);
            return { ok: true, record: p } as never;
        };
        const args = { payload: { id: 'p1' }, invalidError: 'x', register, update, mapReason: () => 'z' };

        expect(await saveCatalogEntry({ ...args, editor: { mode: 'create' } })).toBeNull();
        expect(await saveCatalogEntry({ ...args, editor: { mode: 'edit', id: 'E7' } })).toBeNull();
        expect(seen).toEqual(['register:p1', 'update:E7:p1']);
    });

    it('un fallo devuelve el motivo traducido y no cierra el editor', async () => {
        const error = await saveCatalogEntry<{ id: string }>({
            editor: { mode: 'create' },
            payload: { id: 'p1' },
            invalidError: 'x',
            register: async () => ({ ok: false, reason: 'duplicate' }) as never,
            update: async () => ({ ok: true, record: { id: 'p1' } }) as never,
            mapReason: (reason) => `motivo:${reason}`,
        });
        expect(error).toBe('motivo:duplicate');
    });
});
