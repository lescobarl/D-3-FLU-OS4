// @vitest-environment jsdom
// ============================================================
// Validación de render del feed de resultados unificado (Paso 3
// del Pizarrón consolidado). Monta ResultFeed con tarjetas de
// ejemplo y verifica que:
//   - Renderiza la cabecera con título y botones de filtro.
//   - Cada tarjeta muestra su insignia de origen y su título.
//   - El filtro por tipo (Todo | Imágenes | Doc/Video) filtra.
//   - No muestra mensaje de estado vacío (el usuario lo pidió quitar).
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ResultFeed, type ResultFeedItem } from '../src/components/ResultFeed';

function item(overrides: Partial<ResultFeedItem> = {}): ResultFeedItem {
    return {
        id: overrides.id || 'res-1',
        origin: overrides.origin ?? 'web',
        kind: overrides.kind ?? 'text',
        title: overrides.title ?? 'Resultado web',
        body: overrides.body ?? <p>Contenido del resultado</p>,
    };
}

describe('ResultFeed — render del feed de resultados', () => {
    it('renderiza la cabecera con título y los tres filtros', () => {
        const { container } = render(<ResultFeed items={[]} title="Resultados" />);

        const section = container.querySelector('[data-testid="result-feed"]');
        expect(section).not.toBeNull();
        expect(section!.textContent).toContain('Resultados');

        const filters = section!.querySelectorAll('[data-filter]');
        expect(filters.length).toBe(3);
        expect(section!.querySelector('[data-filter="all"]')).not.toBeNull();
        expect(section!.querySelector('[data-filter="image"]')).not.toBeNull();
        expect(section!.querySelector('[data-filter="doc"]')).not.toBeNull();
    });

    it('no muestra ningún mensaje de estado vacío cuando no hay ítems', () => {
        const { container } = render(<ResultFeed items={[]} />);
        const section = container.querySelector('[data-testid="result-feed"]');
        expect(section).not.toBeNull();
        // El usuario pidió quitar el texto de estado vacío del Pizarrón.
        expect(container.querySelector('.result-feed__empty')).toBeNull();
        expect(container.querySelector('[data-testid="result-feed-list"]')).toBeNull();
    });

    it('renderiza una tarjeta por ítem con su insignia de origen', () => {
        const { container } = render(
            <ResultFeed
                items={[
                    item({ id: 'res-web', origin: 'web', kind: 'text', title: 'Web result' }),
                    item({ id: 'res-ia', origin: 'ia', kind: 'image', title: 'IA image' }),
                    item({ id: 'res-ocr', origin: 'ocr', kind: 'doc', title: 'OCR doc' }),
                ]}
            />
        );

        const list = container.querySelector('[data-testid="result-feed-list"]');
        expect(list).not.toBeNull();

        const web = container.querySelector('[data-testid="result-feed-card-res-web"]');
        expect(web).not.toBeNull();
        expect(web!.getAttribute('data-origin')).toBe('web');
        expect(web!.textContent).toContain('Web result');

        const ia = container.querySelector('[data-testid="result-feed-card-res-ia"]');
        expect(ia).not.toBeNull();
        expect(ia!.getAttribute('data-origin')).toBe('ia');

        const ocr = container.querySelector('[data-testid="result-feed-card-res-ocr"]');
        expect(ocr).not.toBeNull();
        expect(ocr!.getAttribute('data-origin')).toBe('ocr');
        expect(ocr!.textContent).toContain('OCR doc');
    });

    it('filtra por imágenes al pulsar el botón Imágenes', () => {
        const { container } = render(
            <ResultFeed
                items={[
                    item({ id: 'res-web', origin: 'web', kind: 'text', title: 'Web result' }),
                    item({ id: 'res-ia', origin: 'ia', kind: 'image', title: 'IA image' }),
                    item({ id: 'res-ocr', origin: 'ocr', kind: 'doc', title: 'OCR doc' }),
                ]}
            />
        );

        const imageFilter = container.querySelector('[data-filter="image"]');
        fireEvent.click(imageFilter!);

        expect(container.querySelector('[data-testid="result-feed-card-res-web"]')).toBeNull();
        expect(container.querySelector('[data-testid="result-feed-card-res-ia"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="result-feed-card-res-ocr"]')).toBeNull();
    });

    it('filtra por doc/video al pulsar el botón Doc/Video', () => {
        const { container } = render(
            <ResultFeed
                items={[
                    item({ id: 'res-web', origin: 'web', kind: 'text', title: 'Web result' }),
                    item({ id: 'res-ia', origin: 'ia', kind: 'image', title: 'IA image' }),
                    item({ id: 'res-doc', origin: 'ocr', kind: 'doc', title: 'OCR doc' }),
                    item({ id: 'res-video', origin: 'ia', kind: 'video', title: 'IA video' }),
                ]}
            />
        );

        const docFilter = container.querySelector('[data-filter="doc"]');
        fireEvent.click(docFilter!);

        expect(container.querySelector('[data-testid="result-feed-card-res-web"]')).toBeNull();
        expect(container.querySelector('[data-testid="result-feed-card-res-ia"]')).toBeNull();
        expect(container.querySelector('[data-testid="result-feed-card-res-doc"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="result-feed-card-res-video"]')).not.toBeNull();
    });

    it('no muestra mensaje de estado vacío cuando el filtro no tiene coincidencias', () => {
        const { container } = render(
            <ResultFeed
                items={[item({ id: 'res-web', origin: 'web', kind: 'text', title: 'Web result' })]}
            />
        );

        const imageFilter = container.querySelector('[data-filter="image"]');
        fireEvent.click(imageFilter!);

        // El usuario pidió quitar el texto de estado vacío del Pizarrón.
        expect(container.querySelector('.result-feed__empty')).toBeNull();
        expect(container.querySelector('[data-testid="result-feed-list"]')).toBeNull();
    });
});
