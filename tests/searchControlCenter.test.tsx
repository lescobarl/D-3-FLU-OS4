// @vitest-environment jsdom
/**
 * SearchControlCenter - el Centro de Control del Buscador (0%).
 *
 * POR QUE ESTE TEST: 600 lineas (el mayor de la capa ciega) por las que pasan
 * proveedores, categorias, idiomas por rol, seguridad y vista previa. Se sustituye
 * la FRONTERA (los endpoints de busqueda y el panel de catalogo embebido) y se
 * ejercita la regla central del patron BORRADOR -> COMMIT: los inputs editan local y
 * al guardar SOLO se persisten los valores que DIFIEREN de la config base (por eso
 * los placeholders muestran la base). El guardado global (barra de Configuracion) se
 * usa de verdad: SettingsSaveProvider + SettingsSaveBar.
 *
 * HALLAZGO MEDIDO (declarado, no se toca el producto): de los campos de un
 * proveedor, `key` es el UNICO que se persiste aunque su valor sea IGUAL al de la
 * config base (`enabled`, `model`, `maxResults` y `timeoutMs` si comparan contra la
 * base). Contradice en parte la cabecera del componente ("solo se persisten valores
 * que difieren de la config base"): reescribir la misma clave deja un override
 * redundante en localStorage.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    runtime: { providers: {}, maxResultsByType: { web: 10, images: 10, video: 10 }, timeoutMs: 5000, aiEnabled: true },
    resuelto: {
        endpoints: { web: '/proxy/search' },
        providers: { web: ['w1'] },
        timeoutMs: 5000,
        maxResultsByType: { web: 10 },
        effectiveSafe: true,
        aiEnabled: true,
        maxChars: 400,
        aiOverviewTitle: 'Resumen IA',
    },
    fetchTypeResults: vi.fn(async () => ({ ok: true, results: [] as unknown[] })),
    fetchAiOverview: vi.fn(async () => 'resumen'),
    resolveMergedSearchConfig: vi.fn(),
}));

vi.mock('../src/hooks/useWorkspaceSearch.js', () => ({
    buildRuntimeConfig: () => dobles.runtime,
    resolveMergedSearchConfig: (draft: unknown) => dobles.resolveMergedSearchConfig(draft),
    fetchTypeResults: (...args: unknown[]) => dobles.fetchTypeResults(...(args as [])),
    fetchAiOverview: (...args: unknown[]) => dobles.fetchAiOverview(...(args as [])),
}));

vi.mock('../src/components/SearchCatalogPanel.js', () => ({
    SearchCatalogPanel: ({ sites }: { sites: unknown[] }) => (
        <div data-testid="catalog-stub">{sites.length}</div>
    ),
}));

import { SearchControlCenter } from '../src/components/SearchControlCenter.js';
import { SettingsSaveBar, SettingsSaveProvider } from '../src/components/SettingsSaveContext.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const ui = (FLU_CONFIG.browser as any).search.ui as Record<string, string>;
const browserUi = (FLU_CONFIG.browser as any).ui as Record<string, string>;
const categoriasConfig = (FLU_CONFIG.browser as any).categories as Record<string, string>;

const SERVICIOS = {
    providers: {
        web: [
            { id: 'w1', label: 'Motor A', key: 'k-base', model: 'modelo-base', maxResults: 10, timeoutMs: 5000, enabled: true },
            { id: 'w2', label: 'Motor externo', externalConfig: true, enabled: false },
        ],
        images: [{ id: 'i1', label: 'Imagenes A', enabled: true, maxResults: 20, timeoutMs: 4000 }],
        video: [],
    },
    maxResultsByType: { web: 10, images: 20, video: 5 },
    timeoutMs: 5000,
    aiEnabled: true,
};

const SITIOS = [
    { dominio: 'uno.org', label: 'Uno', categorias: ['educacion'] },
    { dominio: 'dos.org', label: 'Dos', categorias: ['educacion', 'juegos'] },
];

const montar = (over: Partial<Record<string, unknown>> = {}) => {
    const onChange = (over.onChange as ReturnType<typeof vi.fn>) ?? vi.fn();
    const onReset = over.onReset === null ? undefined : ((over.onReset as ReturnType<typeof vi.fn>) ?? vi.fn());
    render(
        <SettingsSaveProvider>
            <SearchControlCenter
                overrides={(over.overrides as never) ?? ({} as never)}
                onChange={onChange as never}
                onReset={onReset as never}
                allowlist={(over.allowlist as never) ?? undefined}
                sites={(over.sites as never) ?? (SITIOS as never)}
                dynamicDomains={(over.dynamicDomains as never) ?? (new Set<string>() as never)}
                loading={(over.loading as boolean) ?? false}
                onRegister={vi.fn() as never}
                onUpdate={vi.fn() as never}
                onRemove={vi.fn() as never}
            />
            <SettingsSaveBar />
        </SettingsSaveProvider>,
    );
    return { onChange, onReset };
};

/** Guarda con la barra global y devuelve los overrides que se persistirian. */
const guardar = (onChange: ReturnType<typeof vi.fn>, previos: Record<string, unknown> = {}) => {
    fireEvent.click(screen.getByTestId('settings-save-all'));
    const updater = onChange.mock.calls.at(-1)![0];
    return typeof updater === 'function' ? updater(previos) : updater;
};

const proveedor = (tipo: string, id: string, campo: string) => screen.getByTestId(`search-provider-${campo}-${tipo}-${id}`) as HTMLInputElement;

beforeEach(() => {
    dobles.runtime = SERVICIOS;
    dobles.fetchTypeResults.mockClear();
    dobles.fetchAiOverview.mockClear();
    dobles.resolveMergedSearchConfig.mockClear();
    dobles.resolveMergedSearchConfig.mockReturnValue(dobles.resuelto);
    dobles.fetchTypeResults.mockResolvedValue({ ok: true, results: [] });
    dobles.fetchAiOverview.mockResolvedValue('resumen');
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('SearchControlCenter - estructura y catalogos de la config', () => {
    it('titulo, intro y catalogo embebido con los sitios recibidos', () => {
        montar();

        expect(screen.getByText(ui.searchControlTitle)).toBeTruthy();
        expect(screen.getByText(ui.searchControlIntro)).toBeTruthy();
        expect(screen.getByTestId('catalog-stub').textContent).toBe('2');
    });

    it('las categorias se listan con CUANTOS sitios tiene cada una', () => {
        montar();

        const lista = screen.getByTestId('search-categories-list');
        const filas = [...lista.querySelectorAll('li')];

        expect(filas).toHaveLength(Object.keys(categoriasConfig).length);
        const educacion = filas.find((f) => f.textContent?.includes(categoriasConfig.educacion))!;
        expect(educacion.textContent).toContain('2');
        const juegos = filas.find((f) => f.textContent?.includes(categoriasConfig.juegos))!;
        expect(juegos.textContent).toContain('1');
    });

    it('idiomas y nivel por rol salen de la config', () => {
        montar();

        const roles = screen.getByTestId('search-roles-list');
        const primerRol = Object.keys((FLU_CONFIG.browser as any).defaultsByRole)[0];

        expect(roles.textContent).toContain(primerRol);
        expect(roles.textContent).toContain(browserUi.languageLabel);
        expect(roles.textContent).toContain(browserUi.readingLevelLabel);
    });
});

describe('SearchControlCenter - proveedores', () => {
    it('pinta un bloque por tipo con proveedores, y omite los tipos vacios', () => {
        montar();

        expect(screen.getByTestId('search-provider-web-w1')).toBeTruthy();
        expect(screen.getByTestId('search-provider-web-w2')).toBeTruthy();
        expect(screen.getByTestId('search-provider-images-i1')).toBeTruthy();
        expect(screen.queryByTestId('search-provider-video-')).toBeNull();
        expect(screen.getByText(ui.providersSection)).toBeTruthy();
    });

    it('un proveedor de config externa no ofrece clave ni modelo', () => {
        montar();

        expect(screen.queryByTestId('search-provider-key-web-w2')).toBeNull();
        expect(screen.queryByTestId('search-provider-model-web-w2')).toBeNull();
        // ...pero si sus topes.
        expect(screen.getByTestId('search-provider-max-web-w2')).toBeTruthy();
    });

    it('el placeholder muestra el valor BASE (no se duplica en storage)', () => {
        montar();

        expect(proveedor('web', 'w1', 'key').placeholder).toBe('k-base');
        expect(proveedor('web', 'w1', 'model').placeholder).toBe('modelo-base');
        expect(proveedor('web', 'w1', 'max').placeholder).toBe('10');
        expect(proveedor('web', 'w1', 'timeout').placeholder).toBe('5000');
    });

    it('apagar un proveedor se persiste SOLO al guardar', () => {
        const { onChange } = montar();
        fireEvent.click(proveedor('web', 'w1', 'enabled'));

        expect(onChange).not.toHaveBeenCalled();

        const next = guardar(onChange);

        expect(next).toEqual({ providers: { web: { w1: { enabled: false } } } });
    });

    it('la clave y el modelo editados se persisten; los topes se recortan a entero', () => {
        const { onChange } = montar();
        fireEvent.change(proveedor('web', 'w1', 'key'), { target: { value: 'k-nueva' } });
        fireEvent.change(proveedor('web', 'w1', 'model'), { target: { value: 'modelo-2' } });
        fireEvent.change(proveedor('web', 'w1', 'max'), { target: { value: '25' } });

        const next = guardar(onChange);

        expect(next).toEqual({
            providers: { web: { w1: { key: 'k-nueva', model: 'modelo-2', maxResults: 25 } } },
        });
    });

    it('la clave se guarda aunque sea la MISMA que la base (el resto de campos no)', () => {
        const { onChange } = montar();
        fireEvent.change(proveedor('web', 'w1', 'key'), { target: { value: 'k-base' } });
        fireEvent.change(proveedor('web', 'w1', 'model'), { target: { value: 'modelo-base' } });
        fireEvent.change(proveedor('web', 'w1', 'max'), { target: { value: '10' } });

        // HALLAZGO MEDIDO: `key` es el UNICO campo que se persiste aunque coincida
        // con la base; `model`, `maxResults`, `timeoutMs` y `enabled` si comparan.
        expect(guardar(onChange)).toEqual({ providers: { web: { w1: { key: 'k-base' } } } });
    });

    it('al guardar se COMPONE con lo que ya habia de otros paneles', () => {
        const { onChange } = montar();
        fireEvent.change(proveedor('images', 'i1', 'max'), { target: { value: '30' } });

        const next = guardar(onChange, { providers: { web: { w2: { enabled: true } } } });

        expect(next.providers!.web).toEqual({ w2: { enabled: true } });
        expect(next.providers!.images).toEqual({ i1: { maxResults: 30 } });
    });
});

describe('SearchControlCenter - seguridad y limite', () => {
    it('los interruptores van al borrador y se persisten al guardar', () => {
        const { onChange } = montar();

        fireEvent.click(screen.getByTestId('search-security-safesearch'));
        fireEvent.click(screen.getByTestId('search-security-supervised'));

        const next = guardar(onChange);

        expect(next).toEqual({ safeSearch: true, supervised: true });
    });

    it('el limite diario 0 significa SIN limite', () => {
        const { onChange } = montar();

        fireEvent.change(screen.getByTestId('search-security-dailylimit'), { target: { value: '0' } });
        expect(guardar(onChange)).toEqual({});

        fireEvent.change(screen.getByTestId('search-security-dailylimit'), { target: { value: '7' } });
        expect(guardar(onChange)).toEqual({ dailyLimit: 7 });
    });
});

describe('SearchControlCenter - restablecer (barra global)', () => {
    it('con onReset delega en App y limpia el borrador', () => {
        const { onChange, onReset } = montar();
        fireEvent.click(proveedor('web', 'w1', 'enabled'));

        fireEvent.click(screen.getByTestId('settings-reset-all'));

        expect(onReset).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
        // El borrador queda limpio: guardar despues no persiste nada.
        expect(guardar(onChange)).toEqual({});
    });

    it('sin onReset, restablecer persiste el vacio', () => {
        const { onChange } = montar({ onReset: null });

        fireEvent.click(screen.getByTestId('settings-reset-all'));

        expect(onChange).toHaveBeenCalledWith({});
    });
});

describe('SearchControlCenter - vista previa', () => {
    it('sin consulta no llama al buscador', () => {
        montar();

        fireEvent.submit(screen.getByTestId('search-preview-run').closest('form')!);

        expect(dobles.fetchTypeResults).not.toHaveBeenCalled();
        expect(screen.getByTestId('search-preview-empty')).toBeTruthy();
    });

    it('con consulta pide resultados e IA, y muestra ambos', async () => {
        dobles.fetchTypeResults.mockResolvedValue({
            ok: true,
            results: [{ title: 'Uno', snippet: 'trozo' }],
        });
        montar({ allowlist: ['uno.org'] });
        fireEvent.change(screen.getByTestId('search-preview-query'), { target: { value: '  volcanes  ' } });

        fireEvent.submit(screen.getByTestId('search-preview-run').closest('form')!);

        await waitFor(() => {
            expect(screen.getByTestId('search-preview-done')).toBeTruthy();
        });
        expect(screen.getByText('Uno')).toBeTruthy();
        expect(screen.getByText('trozo')).toBeTruthy();
        expect(screen.getByText('resumen')).toBeTruthy();

        // Parametros: consulta recortada, idioma, seguro y allowlist curada.
        const params = (dobles.fetchTypeResults.mock.calls[0] as unknown[])[3] as URLSearchParams;
        expect(params.get('q')).toBe('volcanes');
        expect(params.get('lang')).toBe('es');
        expect(params.get('safe')).toBe('1');
        expect(params.get('allowlist')).toBe('uno.org');
        expect(dobles.resolveMergedSearchConfig).toHaveBeenCalled();
    });

    it('sin resultados avisa y sin IA no pinta el resumen', async () => {
        dobles.fetchTypeResults.mockResolvedValue({ ok: true, results: [] });
        dobles.fetchAiOverview.mockResolvedValue('');
        montar();

        fireEvent.change(screen.getByTestId('search-preview-query'), { target: { value: 'nada' } });
        fireEvent.submit(screen.getByTestId('search-preview-run').closest('form')!);

        await waitFor(() => {
            expect(screen.getByTestId('search-preview-done')).toBeTruthy();
        });
        expect(screen.getByText(ui.previewEmpty)).toBeTruthy();
        expect(screen.queryByText(ui.previewAi)).toBeNull();
    });

    it('un fallo del buscador se muestra como error, no como vacio', async () => {
        dobles.fetchTypeResults.mockResolvedValue({ ok: false, results: [] });
        montar();

        fireEvent.change(screen.getByTestId('search-preview-query'), { target: { value: 'x' } });
        fireEvent.submit(screen.getByTestId('search-preview-run').closest('form')!);

        await waitFor(() => {
            expect(screen.getByTestId('search-preview-error')).toBeTruthy();
        });
        expect(dobles.fetchAiOverview).not.toHaveBeenCalled();
    });

    it('si la busqueda revienta, se registra y sale el aviso de error', async () => {
        dobles.fetchTypeResults.mockRejectedValue(new Error('proxy caido'));
        montar();

        fireEvent.change(screen.getByTestId('search-preview-query'), { target: { value: 'x' } });
        fireEvent.submit(screen.getByTestId('search-preview-run').closest('form')!);

        await waitFor(() => {
            expect(screen.getByTestId('search-preview-error')).toBeTruthy();
        });
        expect(console.error).toHaveBeenCalled();
    });

    it('mientras consulta se ve el aviso de carga', async () => {
        let resolver: (valor: unknown) => void = () => {};
        dobles.fetchTypeResults.mockImplementation(() => new Promise((listo) => {
            resolver = (valor) => listo(valor as { ok: boolean; results: unknown[] });
        }));
        montar();
        fireEvent.change(screen.getByTestId('search-preview-query'), { target: { value: 'x' } });

        fireEvent.submit(screen.getByTestId('search-preview-run').closest('form')!);

        expect(screen.getByTestId('search-preview-loading')).toBeTruthy();
        resolver({ ok: true, results: [] });
        await waitFor(() => {
            expect(screen.getByTestId('search-preview-done')).toBeTruthy();
        });
    });
});
