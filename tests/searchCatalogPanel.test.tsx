// @vitest-environment jsdom
// ============================================================
// SearchCatalogPanel - catalogo de sitios del Buscador (0%).
// ------------------------------------------------------------
// Componente presentacional controlado: recibe el catalogo y las
// acciones por props (NO accede a stores). Se prueba el contrato
// visible REAL sin mockear el modulo bajo prueba ni sus servicios:
//   - estados vacio/cargando y lista con built-in vs dinamico
//   - formulario crear/editar: validacion, normalizacion del payload
//     (trim + minusculas), cierre al guardar y mapa de errores
//   - borrado con confirmacion y cancelacion sin guardar
// La unica frontera sustituida es window.confirm (navegador).
// ============================================================
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { RegisterResult, UpdateResult } from '../src/core/catalogs/catalogRegistry';
import type { SearchSite } from '../src/core/search/searchSiteTypes';
import { SearchCatalogPanel } from '../src/components/SearchCatalogPanel';
import type { SearchCatalogPanelProps } from '../src/components/SearchCatalogPanel';

type RegisterMock = Mock<(data: SearchSite) => Promise<RegisterResult<SearchSite>>>;
type UpdateMock = Mock<(id: string, data: SearchSite) => Promise<UpdateResult<SearchSite>>>;
type RemoveMock = Mock<(id: string) => Promise<boolean>>;

let onRegister: RegisterMock;
let onUpdate: UpdateMock;
let onRemove: RemoveMock;

const entrada = (over: Partial<SearchSite> = {}): SearchSite => ({
    dominio: 'foo.org',
    label: 'Foo',
    categorias: ['juegos'],
    idiomas: ['es'],
    nivel: 'detallado',
    aprobado: true,
    ...over,
});

function renderPanel(over: Partial<SearchCatalogPanelProps> = {}) {
    const props: SearchCatalogPanelProps = {
        sites: [],
        dynamicDomains: new Set<string>(),
        loading: false,
        onRegister,
        onUpdate,
        onRemove,
        ...over,
    };
    return render(<SearchCatalogPanel {...props} />);
}

function abrirFormulario(): void {
    fireEvent.click(screen.getByTestId('search-site-create'));
}

function rellenarValido(): void {
    fireEvent.change(screen.getByTestId('search-site-dominio'), { target: { value: '  KhanAcademy.ORG ' } });
    fireEvent.change(screen.getByTestId('search-site-label'), { target: { value: '  Khan  ' } });
    fireEvent.click(screen.getByTestId('search-site-categoria-educacion'));
}

beforeEach(() => {
    onRegister = vi.fn((_data: SearchSite) => Promise.resolve({ ok: true, record: {} as never }));
    onUpdate = vi.fn((_id: string, _data: SearchSite) => Promise.resolve({ ok: true, record: {} as never }));
    onRemove = vi.fn((_id: string) => Promise.resolve(true));
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
// Bloque: estados de la lista
// ------------------------------------------------------------
describe('SearchCatalogPanel - lista y estados', () => {
    it('sin sitios y sin carga muestra el estado vacio', () => {
        renderPanel();

        expect(screen.getByText(/No hay sitios/)).toBeTruthy();
        expect(screen.queryByTestId('search-catalog-list')).toBeNull();
    });

    it('mientras carga muestra el aviso y no la lista', () => {
        renderPanel({ loading: true });

        expect(screen.getByText(/Cargando cat/)).toBeTruthy();
        expect(screen.queryByTestId('search-catalog-list')).toBeNull();
    });

    it('pinta cada sitio del catalogo con su dominio', () => {
        renderPanel({ sites: [entrada()] });

        const item = screen.getByTestId('search-site-item-foo.org');
        expect(item.textContent).toContain('Foo');
        expect(item.textContent).toContain('foo.org');
    });

    it('un built-in muestra el badge Sistema y no tiene editar/borrar', () => {
        renderPanel({ sites: [entrada()], dynamicDomains: new Set<string>() });

        expect(screen.getByText('Sistema')).toBeTruthy();
        expect(screen.queryByTestId('search-site-edit-foo.org')).toBeNull();
        expect(screen.queryByTestId('search-site-remove-foo.org')).toBeNull();
    });

    it('un sitio dinamico expone editar y borrar', () => {
        renderPanel({ sites: [entrada()], dynamicDomains: new Set(['foo.org']) });

        expect(screen.getByTestId('search-site-edit-foo.org')).toBeTruthy();
        expect(screen.getByTestId('search-site-remove-foo.org')).toBeTruthy();
        expect(screen.queryByText('Sistema')).toBeNull();
    });
});

// ------------------------------------------------------------
// Bloque: formulario de alta
// ------------------------------------------------------------
describe('SearchCatalogPanel - alta', () => {
    it('el boton Nuevo sitio abre el formulario con chips y niveles de la config', () => {
        renderPanel();
        abrirFormulario();

        expect(screen.getByTestId('search-catalog-form')).toBeTruthy();
        expect(screen.getByTestId('search-site-categoria-educacion')).toBeTruthy();
        expect(screen.getByTestId('search-site-idioma-es')).toBeTruthy();
        expect(document.querySelectorAll('[data-testid^="search-site-categoria-"]').length).toBe(4);
        expect(document.querySelectorAll('[data-testid="search-site-nivel"] option').length).toBe(3);
    });

    it('sin dominio, nombre ni categoria no guarda y muestra el error', () => {
        renderPanel();
        abrirFormulario();
        fireEvent.click(screen.getByTestId('search-site-save'));

        expect(screen.getByTestId('search-catalog-error')).toBeTruthy();
        expect(onRegister).not.toHaveBeenCalled();
    });

    it('normaliza el payload (trim + minusculas) y cierra al guardar', async () => {
        renderPanel();
        abrirFormulario();
        rellenarValido();
        fireEvent.click(screen.getByTestId('search-site-save'));

        await waitFor(() => expect(onRegister).toHaveBeenCalledTimes(1));
        expect(onRegister.mock.calls[0][0]).toEqual({
            dominio: 'khanacademy.org',
            label: 'Khan',
            categorias: ['educacion'],
            idiomas: [],
            nivel: 'simple',
            aprobado: true,
        });
        await waitFor(() => expect(screen.queryByTestId('search-catalog-form')).toBeNull());
    });

    it('traduce el motivo "duplicate" y mantiene el formulario abierto', async () => {
        onRegister.mockImplementationOnce(() => Promise.resolve({ ok: false, reason: 'duplicate' }));
        renderPanel();
        abrirFormulario();
        rellenarValido();
        fireEvent.click(screen.getByTestId('search-site-save'));

        await waitFor(() => expect(screen.getByTestId('search-catalog-error').textContent).toMatch(/Ya existe un sitio/));
        expect(screen.getByTestId('search-catalog-form')).toBeTruthy();
    });
});

// ------------------------------------------------------------
// Bloque: edicion y cancelacion
// ------------------------------------------------------------
describe('SearchCatalogPanel - edicion', () => {
    it('editar precarga el sitio y guarda por onUpdate con el id del dominio', async () => {
        renderPanel({ sites: [entrada()], dynamicDomains: new Set(['foo.org']) });
        fireEvent.click(screen.getByTestId('search-site-edit-foo.org'));

        expect((screen.getByTestId('search-site-dominio') as HTMLInputElement).value).toBe('foo.org');
        fireEvent.change(screen.getByTestId('search-site-label'), { target: { value: 'Foo Nuevo' } });
        fireEvent.click(screen.getByTestId('search-site-save'));

        await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
        expect(onUpdate.mock.calls[0][0]).toBe('foo.org');
        expect(onUpdate.mock.calls[0][1]).toMatchObject({
            dominio: 'foo.org',
            label: 'Foo Nuevo',
            categorias: ['juegos'],
            nivel: 'detallado',
        });
    });

    it('cancelar cierra el formulario sin guardar', () => {
        renderPanel();
        abrirFormulario();
        fireEvent.click(screen.getByTestId('search-site-cancel'));

        expect(screen.queryByTestId('search-catalog-form')).toBeNull();
        expect(onRegister).not.toHaveBeenCalled();
        expect(onUpdate).not.toHaveBeenCalled();
    });
});

// ------------------------------------------------------------
// Bloque: borrado con confirmacion
// ------------------------------------------------------------
describe('SearchCatalogPanel - borrado', () => {
    it('si el usuario confirma se llama a onRemove con el dominio', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        renderPanel({ sites: [entrada()], dynamicDomains: new Set(['foo.org']) });
        fireEvent.click(screen.getByTestId('search-site-remove-foo.org'));

        await waitFor(() => expect(onRemove).toHaveBeenCalledWith('foo.org'));
    });

    it('si el usuario cancela no se borra nada', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        renderPanel({ sites: [entrada()], dynamicDomains: new Set(['foo.org']) });
        fireEvent.click(screen.getByTestId('search-site-remove-foo.org'));

        expect(onRemove).not.toHaveBeenCalled();
    });
});
