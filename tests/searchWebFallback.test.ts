// ============================================================
// searchWebFallback.test.ts — Cadena web Tavily → OpenRouter → Wikipedia
// ------------------------------------------------------------
// Guard de COMPORTAMIENTO de la unificación web (no solo conteo):
//   - buildProviderRequest: POST + headers/body con tokens {q}/{n}/{model}/{key}
//   - normalizeResults: Tavily (results[]) y OpenRouter (url_citation)
//   - proxy: prioridad 1 gana y NO consulta los escalones siguientes
//   - proxy: error/timeout/0 de Tavily → cae a OpenRouter
//   - regresión: sin `priority` los proveedores siguen fusionándose
// ============================================================
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSearchProxy } from '../src/server/searchProxy';
import {
    buildProviderRequest,
    normalizeResults,
} from '../src/core/search/searchSession';

const TAVILY_PROVIDER = {
    id: 'tavily',
    label: 'Tavily',
    enabled: true,
    method: 'POST' as const,
    endpoint: 'https://api.tavily.com/search',
    headers: { Authorization: 'Bearer {key}', 'Content-Type': 'application/json' },
    body: { query: '{q}', max_results: '{n}', search_depth: 'basic' },
    key: 'tvly-test',
    priority: 1,
    maxResults: 5,
    timeoutMs: 5000,
};

const OPENROUTER_PROVIDER = {
    id: 'openrouter',
    label: 'OpenRouter (web)',
    enabled: true,
    method: 'POST' as const,
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { Authorization: 'Bearer {key}', 'Content-Type': 'application/json' },
    body: { model: '{model}', messages: [{ role: 'user', content: '{q}' }] },
    key: 'sk-or-test',
    model: 'openai/gpt-oss-20b:free:online',
    priority: 2,
    maxResults: 5,
    timeoutMs: 8000,
};

const WIKI_PROVIDER = {
    id: 'wikipedia',
    label: 'Wikipedia',
    enabled: true,
    endpoint:
        'https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={q}&format=json',
    articleUrlTemplate: 'https://{lang}.wikipedia.org/wiki/{title}',
    priority: 3,
    maxResults: 2,
};

const TAVILY_JSON = {
    results: [
        {
            title: 'iPhone - Apple',
            url: 'https://www.apple.com/iphone/',
            content: 'El iPhone es la línea de smartphones de Apple.',
        },
        {
            title: 'iPhone - Wikipedia',
            url: 'https://es.wikipedia.org/wiki/IPhone',
            content: 'El iPhone es un teléfono inteligente.',
        },
    ],
};

const OPENROUTER_JSON = {
    choices: [
        {
            message: {
                content: 'Aquí tienes resultados.',
                annotations: [
                    {
                        type: 'url_citation',
                        url_citation: {
                            url: 'https://www.apple.com/iphone/',
                            title: 'Apple iPhone',
                            content: 'Sitio oficial del iPhone.',
                        },
                    },
                    // Un tipo distinto de anotación se ignora.
                    { type: 'other', url_citation: { url: 'https://ignored.example' } },
                ],
            },
        },
    ],
};

const WIKI_JSON = {
    query: { search: [{ title: 'IPhone', snippet: 'Teléfono de Apple.' }] },
};

const DDG_PROVIDER = {
    id: 'duckduckgo',
    enabled: true,
    endpoint: 'https://api.duckduckgo.com/?q={q}&format=json&no_html=1&kl={lang}',
    maxResults: 2,
};

const DDG_JSON = {
    Heading: 'Capital de Francia',
    AbstractText: 'París es la capital de Francia.',
    AbstractURL: 'https://es.wikipedia.org/wiki/Par%C3%ADs',
};

function createHarness() {
    const handlers: Record<string, any> = {};
    const server = {
        middlewares: {
            use: (path: string, fn: any) => {
                handlers[path] = fn;
            },
        },
    };
    createSearchProxy({}).configureServer(server);

    return {
        async invoke(rawUrl: string, method = 'GET'): Promise<{ status: number; body: any }> {
            const res: any = {
                writableEnded: false,
                destroyed: false,
                statusCode: 0,
                body: null,
                writeHead(status: number) {
                    res.statusCode = status;
                },
                end(payload: string) {
                    res.body = payload;
                },
            };
            const req: any = { url: rawUrl, method };
            const pathname = rawUrl.split('?')[0];
            const handler = handlers[pathname];
            if (!handler) throw new Error(`No hay middleware registrado para ${pathname}`);
            await handler(req, res, () => {});
            return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
        },
    };
}

function okResponse(json: unknown) {
    return { ok: true, status: 200, json: async () => json };
}

function failResponse(status: number) {
    return { ok: false, status, json: async () => ({}) };
}

function abortError(): Error {
    return Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}

function providersParam(providers: unknown): string {
    return encodeURIComponent(JSON.stringify(providers));
}

const harness = createHarness();

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('buildProviderRequest — POST con headers/body (tokens)', () => {
    it('Tavily: method POST, Authorization con {key} y body con {q}/{n}', () => {
        const req = buildProviderRequest(TAVILY_PROVIDER, 'iPhone 15', 'es');
        expect(req.method).toBe('POST');
        expect(req.url).toBe('https://api.tavily.com/search');
        expect(req.headers.Authorization).toBe('Bearer tvly-test');
        expect(req.body).toEqual({ query: 'iPhone 15', max_results: 5, search_depth: 'basic' });
    });

    it('OpenRouter: body lleva {model} verbatim y {q} en el mensaje', () => {
        const req = buildProviderRequest(OPENROUTER_PROVIDER, 'iPhone 15', 'es');
        expect(req.method).toBe('POST');
        expect(req.headers.Authorization).toBe('Bearer sk-or-test');
        expect(req.body).toEqual({
            model: 'openai/gpt-oss-20b:free:online',
            messages: [{ role: 'user', content: 'iPhone 15' }],
        });
    });
});

describe('normalizeResults — Tavily y OpenRouter', () => {
    it('Tavily mapea results[] a SearchResult con source tavily', () => {
        const results = normalizeResults(TAVILY_JSON, 'tavily', 'es');
        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({
            title: 'iPhone - Apple',
            url: 'https://www.apple.com/iphone/',
            source: 'tavily',
            allowed: true,
            host: 'www.apple.com',
        });
        expect(results[1].snippet).toContain('teléfono inteligente');
    });

    it('OpenRouter mapea solo url_citation y descarta el resto', () => {
        const results = normalizeResults(OPENROUTER_JSON, 'openrouter', 'es');
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            title: 'Apple iPhone',
            url: 'https://www.apple.com/iphone/',
            snippet: 'Sitio oficial del iPhone.',
            source: 'openrouter',
            allowed: true,
        });
    });

    it('sin results/annotations devuelve []', () => {
        expect(normalizeResults({}, 'tavily', 'es')).toEqual([]);
        expect(normalizeResults({ choices: [] }, 'openrouter', 'es')).toEqual([]);
    });
});

describe('searchProxy — cadena web por prioridad', () => {
    it('Tavily (prioridad 1) gana y NO consulta OpenRouter ni Wikipedia', async () => {
        const fetchMock = vi.fn((input: any, _init: any) => {
            const url = String(input);
            if (url.includes('api.tavily.com')) return Promise.resolve(okResponse(TAVILY_JSON));
            if (url.includes('openrouter.ai')) return Promise.resolve(okResponse(OPENROUTER_JSON));
            if (url.includes('wikipedia.org')) return Promise.resolve(okResponse(WIKI_JSON));
            return Promise.resolve(failResponse(404));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=iPhone&lang=es' +
            `&providers=${providersParam([TAVILY_PROVIDER, OPENROUTER_PROVIDER, WIKI_PROVIDER])}&max=8`;

        const { status, body } = await harness.invoke(url);

        expect(status).toBe(200);
        expect(body.results).toHaveLength(2);
        expect(body.results.every((r: any) => r.source === 'tavily')).toBe(true);

        const called = fetchMock.mock.calls.map((call) => String(call[0]));
        expect(called.some((u) => u.includes('openrouter.ai'))).toBe(false);
        expect(called.some((u) => u.includes('wikipedia.org'))).toBe(false);

        const tavilyCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('api.tavily.com'));
        const init = tavilyCall?.[1] as any;
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer tvly-test');
        expect(JSON.parse(init.body)).toMatchObject({ query: 'iPhone', max_results: 5 });
    });

    it('Tavily falla (401) → cae a OpenRouter', async () => {
        const fetchMock = vi.fn((input: any) => {
            const url = String(input);
            if (url.includes('api.tavily.com')) return Promise.resolve(failResponse(401));
            if (url.includes('openrouter.ai')) return Promise.resolve(okResponse(OPENROUTER_JSON));
            return Promise.resolve(okResponse(WIKI_JSON));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=iPhone&lang=es' +
            `&providers=${providersParam([TAVILY_PROVIDER, OPENROUTER_PROVIDER, WIKI_PROVIDER])}&max=8`;

        const { body } = await harness.invoke(url);

        expect(body.results).toHaveLength(1);
        expect(body.results[0].source).toBe('openrouter');
    });

    it('Tavily devuelve 0 resultados → cae a OpenRouter', async () => {
        const fetchMock = vi.fn((input: any) => {
            const url = String(input);
            if (url.includes('api.tavily.com')) return Promise.resolve(okResponse({ results: [] }));
            if (url.includes('openrouter.ai')) return Promise.resolve(okResponse(OPENROUTER_JSON));
            return Promise.resolve(okResponse(WIKI_JSON));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=iPhone&lang=es' +
            `&providers=${providersParam([TAVILY_PROVIDER, OPENROUTER_PROVIDER, WIKI_PROVIDER])}&max=8`;

        const { body } = await harness.invoke(url);

        expect(body.results[0].source).toBe('openrouter');
    });

    it('Tavily timeout → cae a OpenRouter', async () => {
        const fetchMock = vi.fn((input: any) => {
            const url = String(input);
            if (url.includes('api.tavily.com')) return Promise.reject(abortError());
            if (url.includes('openrouter.ai')) return Promise.resolve(okResponse(OPENROUTER_JSON));
            return Promise.resolve(okResponse(WIKI_JSON));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=iPhone&lang=es' +
            `&providers=${providersParam([TAVILY_PROVIDER, OPENROUTER_PROVIDER, WIKI_PROVIDER])}&max=8`;

        const { body } = await harness.invoke(url);

        expect(body.results[0].source).toBe('openrouter');
    });

    it('regresión: sin priority los proveedores siguen fusionándose en paralelo', async () => {
        const fetchMock = vi.fn((input: any) => {
            const url = String(input);
            if (url.includes('wikipedia.org')) return Promise.resolve(okResponse(WIKI_JSON));
            if (url.includes('api.duckduckgo.com')) return Promise.resolve(okResponse(DDG_JSON));
            return Promise.resolve(failResponse(404));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=capital&lang=es' +
            `&providers=${providersParam([{ ...WIKI_PROVIDER, priority: 0 }, DDG_PROVIDER])}&max=8`;

        const { body } = await harness.invoke(url);

        const sources = new Set(body.results.map((r: any) => r.source));
        expect(sources.has('wikipedia')).toBe(true);
        expect(sources.has('duckduckgo')).toBe(true);
    });
});
