// @vitest-environment jsdom
/**
 * DocumentsHistoryPanel - historial de documentos generados/cargados (0%).
 *
 * POR QUE ESTE TEST: es presentacional (recibe las props ya filtradas), pero su
 * unica logica propia es el etiquetado bilingue desde FLU_CONFIG, el resumen de
 * cada entrada y la descarga del artefacto (ref remota o contenido como data URL
 * / blob). Se comprueban los tres estados de render, los botones de accion y
 * downloadDocumentContent sustituyendo la frontera DOM (anclas y URLs de objeto).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentsHistoryPanel, downloadDocumentContent } from '../src/components/DocumentsHistoryPanel';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

/** DocumentRecord minimo; solo importan los campos que el panel lee. */
const doc = (over: Record<string, unknown> = {}) => (({
    id: 'd1',
    kind: 'generated',
    formato: 'pdf',
    titulo: 'Carta',
    nombre: 'carta.pdf',
    createdAt: 1,
    updatedAt: 1,
    sync: { revision: 1, updated_at: '', deleted: false },
    ...over,
}) as unknown as import("../src/core/db/fluDatabase").DocumentRecord);

let clickAncla: { mock: { instances: unknown[]; calls: unknown[] } };
let crearUrl: { mock: { calls: unknown[][]; results: { value: unknown }[] } };
let revocarUrl: unknown;

beforeEach(() => {
    clickAncla = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}) as never;
    crearUrl = vi.fn(() => 'blob:mock') as never;
    revocarUrl = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = crearUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revocarUrl;
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

// ------------------------------------------------------------
// Bloque: estados de render (cargando, vacio y listado)
// ------------------------------------------------------------
describe('DocumentsHistoryPanel - estados de render', () => {
    it('en carga muestra el indicador y no la lista', () => {
        render(<DocumentsHistoryPanel documents={[doc()]} loading />);

        expect(screen.getByTestId('documents-history')).toBeTruthy();
        expect(screen.queryByTestId('documents-history-list')).toBeNull();
    });

    it('sin documentos muestra el texto de vacio de la config', () => {
        render(<DocumentsHistoryPanel documents={[]} loading={false} />);

        expect(screen.queryByTestId('documents-history-list')).toBeNull();
        expect(screen.getByText(FLU_CONFIG.documents.ui.empty.es)).toBeTruthy();
    });

    it('lista cada documento con su data-kind y su titulo', () => {
        render(
            <DocumentsHistoryPanel
                documents={[
                    doc({ id: 'g1', kind: 'generated', titulo: 'Carta' }),
                    doc({ id: 'u1', kind: 'uploaded', titulo: 'Notas', formato: 'txt' }),
                ]}
                loading={false}
            />,
        );

        expect(screen.getByTestId('documents-history-list')).toBeTruthy();
        expect(screen.getByTestId('document-item-g1').getAttribute('data-kind')).toBe('generated');
        expect(screen.getByTestId('document-item-u1').getAttribute('data-kind')).toBe('uploaded');
        expect(screen.getByText(/Carta/)).toBeTruthy();
        expect(screen.getByText(/Notas/)).toBeTruthy();
    });

    it('muestra el prefijo recortado de una ref remota http', () => {
        const url = 'https://example.com/video/muy-largo-para-recortar.mp4';
        render(<DocumentsHistoryPanel documents={[doc({ id: 'g1', ref: url })]} loading={false} />);

        expect(screen.getByTestId('document-item-g1').textContent).toContain(url.slice(0, 40));
    });

    it('sin onRemove ni contenido/ref no ofrece ninguna accion', () => {
        render(<DocumentsHistoryPanel documents={[doc({ id: 'g1' })]} loading={false} />);

        expect(screen.queryByTestId('document-remove-g1')).toBeNull();
        expect(screen.queryByTestId('document-download-g1')).toBeNull();
    });
});

// ------------------------------------------------------------
// Bloque: acciones (eliminar y descargar)
// ------------------------------------------------------------
describe('DocumentsHistoryPanel - acciones', () => {
    it('el boton de eliminar invoca onRemove con el id', () => {
        const onRemove = vi.fn();
        render(
            <DocumentsHistoryPanel
                documents={[doc({ id: 'g1' })]}
                loading={false}
                onRemove={onRemove}
            />,
        );

        fireEvent.click(screen.getByTestId('document-remove-g1'));
        expect(onRemove).toHaveBeenCalledWith('g1');
    });

    it('con contenido ofrece descargar y al pulsar dispara la descarga', () => {
        render(
            <DocumentsHistoryPanel
                documents={[doc({ id: 'g1', contenido: 'texto plano' })]}
                loading={false}
            />,
        );

        fireEvent.click(screen.getByTestId('document-download-g1'));

        expect(clickAncla.mock.calls.length).toBe(1);
        expect(crearUrl.mock.calls.length).toBe(1);
        expect(clickAncla.mock.instances[0]).toBeInstanceOf(HTMLAnchorElement);
    });
});

// ------------------------------------------------------------
// Bloque: etiquetas bilingues desde FLU_CONFIG
// ------------------------------------------------------------
describe('DocumentsHistoryPanel - idioma', () => {
    it('por defecto usa las etiquetas en espanol', () => {
        render(<DocumentsHistoryPanel documents={[]} loading={false} />);

        expect(screen.getByText(FLU_CONFIG.documents.ui.title.es)).toBeTruthy();
    });

    it('con language en usa las etiquetas en ingles', () => {
        render(<DocumentsHistoryPanel documents={[]} loading={false} language="en" />);

        expect(screen.getByText(FLU_CONFIG.documents.ui.title.en)).toBeTruthy();
        expect(screen.getByText(FLU_CONFIG.documents.ui.empty.en)).toBeTruthy();
    });
});

// ------------------------------------------------------------
// Bloque: downloadDocumentContent (frontera DOM / URL de objeto)
// ------------------------------------------------------------
describe('downloadDocumentContent', () => {
    it('una ref remota abre un ancla con href y nombre de descarga', () => {
        downloadDocumentContent(doc({ ref: 'https://x.test/a.mp4', nombre: 'a.mp4' }) as never);

        const ancla = clickAncla.mock.instances[0] as HTMLAnchorElement;
        expect(clickAncla.mock.calls.length).toBe(1);
        expect(ancla.href).toBe('https://x.test/a.mp4');
        expect(ancla.download).toBe('a.mp4');
        expect(ancla.target).toBe('_blank');
        expect(crearUrl.mock.calls.length).toBe(0);
    });

    it('contenido plano usa un blob url y programa su revocacion', () => {
        vi.useFakeTimers();

        downloadDocumentContent(
            doc({ contenido: 'hola', mime: 'text/plain', nombre: 'n.txt' }) as never,
        );

        expect(crearUrl.mock.calls.length).toBe(1);
        expect(crearUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
        expect(crearUrl.mock.results[0].value).toBe('blob:mock');

        vi.runAllTimers();
        expect(revocarUrl).toHaveBeenCalledWith('blob:mock');
    });

    it('contenido data url no crea blob y usa el data url tal cual', () => {
        downloadDocumentContent(doc({ contenido: 'data:text/plain;base64,aG9sYQ==' }) as never);

        const ancla = clickAncla.mock.instances[0] as HTMLAnchorElement;
        expect(crearUrl.mock.calls.length).toBe(0);
        expect(ancla.href.startsWith('data:')).toBe(true);
    });

    it('sin fuente (ref vacia y contenido vacio) no hace nada', () => {
        downloadDocumentContent(doc({ ref: '   ', contenido: '' }) as never);

        expect(clickAncla.mock.calls.length).toBe(0);
    });

    it('la ref tiene prioridad sobre el contenido', () => {
        downloadDocumentContent(
            doc({ ref: 'https://x.test/v.mp4', contenido: 'texto ignorado' }) as never,
        );

        const ancla = clickAncla.mock.instances[0] as HTMLAnchorElement;
        expect(ancla.href).toBe('https://x.test/v.mp4');
        expect(crearUrl.mock.calls.length).toBe(0);
    });
});
