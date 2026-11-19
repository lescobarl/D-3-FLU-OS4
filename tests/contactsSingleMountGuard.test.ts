/**
 * Contactos — barrera de montura única y dueño único.
 *
 * Contactos se movió al Pizarrón. Este guard lee la fuente REAL: falla si
 * aparece un segundo montaje, un segundo hook `useContacts`, Contactos vuelve
 * a Configuración o la vista recupera el chrome de Ajustes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
    }
    return out;
}

const files = walk(SRC);
const rel = (file: string): string => relative(ROOT, file).replace(/\\/g, '/');
const source = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

describe('Contactos — una sola montura', () => {
    it('ContactsPanel se monta solo en el Pizarrón', () => {
        const mounts = files
            .filter((file) => source(rel(file)).includes('<ContactsPanel'))
            .map(rel);
        expect(mounts).toEqual(['src/components/AgendaPanel.tsx']);
    });

    it('useContacts solo se instancia en App (dueño de datos)', () => {
        const hooks = files
            .map(rel)
            .filter((file) => file !== 'src/hooks/useContacts.ts')
            .filter((file) => /=\s*useContacts\s*\(/.test(source(file)));
        expect(hooks).toEqual(['src/App.tsx']);
    });

    it('Configuración no monta Contactos y la vista no usa el shell de Ajustes', () => {
        expect(source('src/components/FluSettingsTabView.tsx')).not.toContain('ContactsPanel');
        expect(source('src/components/ContactsPanel.tsx')).not.toContain('SettingsPanelShell');
    });
});
