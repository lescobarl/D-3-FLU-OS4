// @vitest-environment jsdom
/**
 * hookServiceRefSingleOwnerGuard — el patron "servicio en un ref" tiene un solo dueno.
 *
 * Auditoria de codigo 2026-10-02: 10 hooks de src/hooks tenian copiado el mismo bloque
 * (`const serviceRef = useRef<X | null>(null); if (!serviceRef.current) { ... } const
 * service = serviceRef.current;`) con su comentario sobre la zona muerta temporal. El
 * patron (no la logica del hook) es lo que se unifica: el dueno es src/hooks/useServiceRef.ts.
 *
 * Queda una declaracion legítima y declarada: `useOnboarding.ts`, que NO tiene la forma
 * copiada (no hace `const service = serviceRef.current`, usa `serviceRef.current?.x`
 * porque el servicio es opcional segun la ruta) -> se conserva a proposito.
 * Y `useSearchSites.ts` aparecia en el grep solo por un COMENTARIO ("no se necesita
 * serviceRef"): no era una copia.
 *
 * El guard pregunta DOS cosas (0.12): el dueno unico (texto) y que el dueno cree el
 * servicio UNA sola vez entre renders (conducta, con React real y sin JSX para poder
 * vivir en lint:guards como .test.ts).
 *
 * Prueba de DETECTOR real (0.24): se alimenta una copia sintetica y se comprueba que el detector
 * la marca; si el guard siguiera verde sin marcar, seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { useServiceRef } from '../src/hooks/useServiceRef';

export interface SourceFile {
    file: string;
    source: string;
}

/** `archivo:linea` de cada declaracion local del patron `const serviceRef = useRef<`. */
export function findServiceRefDeclarations(sources: ReadonlyArray<SourceFile>): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            if (/^\s*const\s+serviceRef\s*=\s*useRef[<(]/.test(line)) hits.push(`${file}:${index + 1}`);
        });
    }
    return hits;
}

function hookSources(): SourceFile[] {
    const dir = join(process.cwd(), 'src/hooks');
    return readdirSync(dir)
        .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
        .map((name) => ({ file: `src/hooks/${name}`, source: readFileSync(join(dir, name), 'utf8') }));
}

describe('hookServiceRefSingleOwnerGuard — un dueno del patron', () => {
    it('solo queda la variante declarada de useOnboarding (no la forma copiada)', () => {
        const sites = findServiceRefDeclarations(hookSources());
        expect(sites, `Declaraciones locales del patron: ${sites.join(', ')}`).toHaveLength(1);
        expect(sites[0]).toContain('src/hooks/useOnboarding.ts:');
    });

    it('los hooks que usaban el patron importan el dueno', () => {
        const sinDueno = hookSources()
            .filter(({ source }) => source.includes('serviceRef.current'))
            .filter(({ source }) => !source.includes('useServiceRef') && !source.includes('useOnboarding'))
            .map(({ file }) => file);
        expect(sinDueno).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: una copia del patron se marca', () => {
        const synthetic: SourceFile[] = [
            { file: 'src/hooks/x.ts', source: '  const serviceRef = useRef<X | null>(null);' },
        ];
        expect(findServiceRefDeclarations(synthetic)).toEqual(['src/hooks/x.ts:1']);
    });

    it('el codigo limpio no se marca', () => {
        const clean: SourceFile[] = [
            { file: 'src/hooks/x.ts', source: '  const service = useServiceRef(() => createX());' },
        ];
        expect(findServiceRefDeclarations(clean)).toEqual([]);
    });

    it('COMPORTAMIENTO: el dueno crea el servicio UNA sola vez entre renders', () => {
        let calls = 0;
        const factory = () => {
            calls += 1;
            return { id: calls };
        };
        const Probe = ({ n }: { n: number }) => {
            const service = useServiceRef(factory);
            return createElement('span', { 'data-testid': 'probe' }, `${service.id}:${n}`);
        };
        const { getByTestId, rerender } = render(createElement(Probe, { n: 1 }));
        rerender(createElement(Probe, { n: 2 }));
        expect(calls).toBe(1);
        expect(getByTestId('probe').textContent).toBe('1:2');
    });
});
