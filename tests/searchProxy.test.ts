// ============================================================
// searchProxy.test.ts — Proxy del Buscador web + IA + imágenes + vídeo (F3/F4)
// ------------------------------------------------------------
// Cubre las tres rutas GET con fetch mockeado:
//   /api/search/web    → wikipedia + duckduckgo, allowlist curada
//   /api/search/images → Wikimedia Commons (keyless; allowlist NO aplica)
//   /api/search/video  → YouTube Data v3 (key) / Invidious / Commons vídeo
//   - ruta feliz: merge de dos proveedores + tope + marca allowlist
//   - headers User-Agent / Accept-Language según idioma
//   - timeout (AbortError) → se salta ese proveedor
//   - fetch no-ok → se salta ese proveedor
//   - tope per-proveedor (maxResults) y global (max)
//   - sin q → 400 { ok:false, reason:"invalid" }
//   - sin proveedores / providers inválido → 200 { results: [] }
//   - no-GET → delega al siguiente middleware
// ============================================================
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSearchProxy } from '../src/server/searchProxy';

const WIKI_PROVIDER = {
    id: 'wikipedia',
    label: 'Wikipedia',
    enabled: true,
    endpoint: 'https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={q}&format=json',
    maxResults: 2,
};

const DDG_PROVIDER = {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    enabled: true,
    endpoint: 'https://api.duckduckgo.com/?q={q}&format=json&no_html=1&kl={lang}',
    maxResults: 2,
};

const WIKI_JSON = {
    query: {
        search: [
            { title: 'París', snippet: 'Es la capital de Francia.' },
            { title: 'Francia', snippet: 'País de Europa Occidental.' },
        ],
    },
};

const DDG_JSON = {
    Heading: 'Capital de Francia',
    AbstractText: 'París es la capital de Francia.',
    AbstractURL: 'https://es.wikipedia.org/wiki/Par%C3%ADs',
    RelatedTopics: [
        { Text: 'París - Ciudad capital de Francia', FirstURL: 'https://duckduckgo.com/Par%C3%ADs' },
    ],
};

// F4 — Wikimedia Commons (imágenes, keyless): generator=search + imageinfo.
const COMMONS_PROVIDER = {
    id: 'commons',
    label: 'Wikimedia Commons',
    enabled: true,
    endpoint:
        'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch={q}&gsrnamespace=6&prop=imageinfo&iiprop=url|size&iiurlwidth=320&format=json',
    maxResults: 4,
};

// F4 — Wikimedia Commons (vídeo, keyless): generator=search + videoinfo.

// F4 — YouTube Data v3 (con key configurable). Plantillas embed/watch {id}.
const YOUTUBE_PROVIDER = {
    id: 'youtube',
    label: 'YouTube',
    enabled: true,
    key: 'test-key',
    endpoint:
        'https://www.googleapis.com/youtube/v3/search?part=snippet&q={q}&type=video&maxResults={n}&key={key}',
    embedUrlTemplate: 'https://www.youtube.com/embed/{id}',
    watchUrlTemplate: 'https://www.youtube.com/watch?v={id}',
    maxResults: 3,
};

const COMMONS_IMAGES_JSON = {
    query: {
        pages: {
            '123': {
                pageid: 123,
                ns: 6,
                title: 'File:Paris - Eiffel Tower.jpg',
                imageinfo: [
                    {
                        url: 'https://upload.wikimedia.org/wikipedia/commons/3/3c/Paris_-_Eiffel_Tower.jpg',
                        descriptionurl:
                            'https://commons.wikimedia.org/wiki/File:Paris_-_Eiffel_Tower.jpg',
                        thumburl:
                            'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Paris_-_Eiffel_Tower.jpg/320px-Paris_-_Eiffel_Tower.jpg',
                        width: 2000,
                        height: 3000,
                    },
                ],
            },
            '456': {
                pageid: 456,
                ns: 6,
                title: 'File:Paris - Louvre.jpg',
                imageinfo: [
                    {
                        url: 'https://upload.wikimedia.org/wikipedia/commons/4/4b/Paris_-_Louvre.jpg',
                        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Paris_-_Louvre.jpg',
                        thumburl:
                            'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Paris_-_Louvre.jpg/320px-Paris_-_Louvre.jpg',
                        width: 1600,
                        height: 1200,
                    },
                ],
            },
        },
    },
};

const YOUTUBE_JSON = {
    items: [
        {
            id: { kind: 'youtube#video', videoId: 'abc123' },
            snippet: {
                title: 'París en 4K',
                description: 'Un recorrido por París en resolución 4K.',
                thumbnails: {
                    medium: { url: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg' },
                },
            },
        },
    ],
};

const USER_AGENT = 'FLU-OS4-Curaduria/1.0 (modo lectura curada)';

function createHarness() {
    // F4 — mapea ruta → middleware para cubrir las tres rutas registradas.
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
        async invoke(rawUrl: string, method = 'GET'): Promise<{ status: number; body: any; nextCalled: boolean }> {
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
            let nextCalled = false;
            await handler(req, res, () => {
                nextCalled = true;
            });
            return {
                status: res.statusCode,
                body: res.body ? JSON.parse(res.body) : null,
                nextCalled,
            };
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

describe('searchProxy — /api/search/web', () => {
    it('ruta feliz: merge de dos proveedores + tope + marca allowlist', async () => {
        const fetchMock = vi.fn((input: any) => {
            const url = String(input);
            if (url.includes('wikipedia.org/w/api.php')) return Promise.resolve(okResponse(WIKI_JSON));
            if (url.includes('api.duckduckgo.com')) return Promise.resolve(okResponse(DDG_JSON));
            return Promise.resolve(failResponse(404));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=capital%20de%20francia&lang=es&allowlist=wikipedia.org' +
            `&providers=${providersParam([WIKI_PROVIDER, DDG_PROVIDER])}&max=8&timeout=3000`;

        const { status, body } = await harness.invoke(url);

        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.query).toBe('capital de francia');
        expect(body.lang).toBe('es');
        expect(body.results).toHaveLength(4);

        const wiki = body.results.filter((r: any) => r.source === 'wikipedia');
        const ddg = body.results.filter((r: any) => r.source === 'duckduckgo');
        expect(wiki).toHaveLength(2);
        expect(wiki[0].host).toBe('es.wikipedia.org');
        expect(wiki[0].allowed).toBe(true);
        expect(ddg).toHaveLength(2);
        // El abstract de DDG apunta a wikipedia.org (permitido); el RelatedTopic
        // a duckduckgo.com (NO está en la allowlist curada).
        expect(ddg[0].host).toBe('es.wikipedia.org');
        expect(ddg[0].allowed).toBe(true);
        expect(ddg[1].host).toBe('duckduckgo.com');
        expect(ddg[1].allowed).toBe(false);
    });

    it('envía User-Agent y Accept-Language del idioma pedido', async () => {
        const fetchMock = vi.fn((_input: any, _init: any) => Promise.resolve(okResponse(WIKI_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const url = `/api/search/web?q=capital&lang=en&providers=${providersParam([WIKI_PROVIDER])}&max=8`;

        await harness.invoke(url);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [input, init] = fetchMock.mock.calls[0];
        expect(String(input)).toContain('en.wikipedia.org');
        expect(String(input)).toContain('srsearch=capital');
        expect((init as any).headers['User-Agent']).toBe(USER_AGENT);
        expect((init as any).headers['Accept-Language']).toBe('en, en-US;q=0.9, es;q=0.7');
    });

    it('timeout (AbortError) → se salta ese proveedor y quedan los demás', async () => {
        const fetchMock = vi.fn((input: any) => {
            if (String(input).includes('wikipedia.org')) return Promise.reject(abortError());
            return Promise.resolve(okResponse(DDG_JSON));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=capital%20de%20francia&lang=es&allowlist=wikipedia.org' +
            `&providers=${providersParam([WIKI_PROVIDER, DDG_PROVIDER])}&max=8&timeout=3000`;

        const { status, body } = await harness.invoke(url);

        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.results).toHaveLength(2);
        expect(body.results.every((r: any) => r.source === 'duckduckgo')).toBe(true);
    });

    it('fetch no-ok → se salta ese proveedor', async () => {
        const fetchMock = vi.fn((input: any) => {
            if (String(input).includes('wikipedia.org')) return Promise.resolve(failResponse(500));
            return Promise.resolve(okResponse(DDG_JSON));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=capital&lang=es' + `&providers=${providersParam([WIKI_PROVIDER, DDG_PROVIDER])}&max=8`;

        const { status, body } = await harness.invoke(url);

        expect(status).toBe(200);
        expect(body.results).toHaveLength(2);
        expect(body.results.every((r: any) => r.source === 'duckduckgo')).toBe(true);
    });

    it('aplica el tope per-proveedor (maxResults) y el global (max)', async () => {
        const bigWiki = {
            query: {
                search: ['a', 'b', 'c', 'd', 'e'].map((t) => ({ title: t, snippet: 's' })),
            },
        };
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(bigWiki)));
        vi.stubGlobal('fetch', fetchMock);

        const url =
            `/api/search/web?q=capital&lang=es&providers=${providersParam([{ ...WIKI_PROVIDER, maxResults: 3 }])}` +
            '&max=2';

        const { body } = await harness.invoke(url);

        expect(body.results).toHaveLength(2); // cap global max=2
    });

    it('sin q → 400 { ok:false, reason:"invalid" } sin llamar a los proveedores', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(WIKI_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const emptyQ = await harness.invoke('/api/search/web?q=&lang=es');
        expect(emptyQ.status).toBe(400);
        expect(emptyQ.body).toEqual({ ok: false, reason: 'invalid' });

        const noQ = await harness.invoke('/api/search/web?lang=es');
        expect(noQ.status).toBe(400);
        expect(noQ.body.reason).toBe('invalid');

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sin proveedores → 200 { ok:true, results: [] }', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(WIKI_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const url = `/api/search/web?q=capital&lang=es&providers=${providersParam([])}`;
        const { status, body } = await harness.invoke(url);

        expect(status).toBe(200);
        expect(body).toMatchObject({ ok: true, query: 'capital', lang: 'es', results: [] });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('providers JSON inválido → sin proveedores (200 con resultados vacíos)', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(WIKI_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const url = '/api/search/web?q=capital&lang=es&providers=no-es-json';
        const { status, body } = await harness.invoke(url);

        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.results).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no-GET → delega al siguiente middleware', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(WIKI_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const { nextCalled } = await harness.invoke('/api/search/web?q=capital', 'POST');
        expect(nextCalled).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('searchProxy — /api/search/images (F4)', () => {
    it('normaliza Wikimedia Commons: thumbnail, fileUrl, título sin prefijo File:', async () => {
        const fetchMock = vi.fn((input: any) => {
            if (String(input).includes('commons.wikimedia.org')) {
                return Promise.resolve(okResponse(COMMONS_IMAGES_JSON));
            }
            return Promise.resolve(failResponse(404));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/images?q=paris&lang=es&allowlist=wikipedia.org' +
            `&providers=${providersParam({ images: [COMMONS_PROVIDER] })}&max=8`;

        const { status, body } = await harness.invoke(url);

        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.query).toBe('paris');
        expect(body.results).toHaveLength(2);

        const first = body.results[0];
        expect(first.type).toBe('images');
        expect(first.source).toBe('commons');
        expect(first.title).toBe('Paris - Eiffel Tower.jpg');
        expect(first.fileUrl).toContain('upload.wikimedia.org');
        expect(first.thumbnail).toContain('/thumb/');
        expect(first.width).toBe(2000);
        expect(first.height).toBe(3000);
        // La allowlist solo restringe la navegación web; las cuadrículas muestran todo.
        expect(first.allowed).toBe(true);
    });

    it('sin q → 400 y sin proveedores → 200 con results vacíos', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(COMMONS_IMAGES_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const emptyQ = await harness.invoke('/api/search/images?q=&lang=es');
        expect(emptyQ.status).toBe(400);
        expect(emptyQ.body.reason).toBe('invalid');

        const noProviders = await harness.invoke(
            `/api/search/images?q=paris&lang=es&providers=${providersParam([])}`,
        );
        expect(noProviders.status).toBe(200);
        expect(noProviders.body.results).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('searchProxy — /api/search/video (F4)', () => {
    it('YouTube: embed/watch desde plantillas, tipo video y key en la URL', async () => {
        const fetchMock = vi.fn((input: any) => {
            if (String(input).includes('googleapis.com/youtube/v3/search')) {
                return Promise.resolve(okResponse(YOUTUBE_JSON));
            }
            return Promise.resolve(failResponse(404));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/video?q=paris&lang=es' + `&providers=${providersParam({ video: [YOUTUBE_PROVIDER] })}&max=8`;

        const { status, body } = await harness.invoke(url);

        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.results).toHaveLength(1);

        const first = body.results[0];
        expect(first.type).toBe('video');
        expect(first.source).toBe('youtube');
        expect(first.title).toBe('París en 4K');
        expect(first.thumbnail).toBe('https://i.ytimg.com/vi/abc123/mqdefault.jpg');
        expect(first.url).toBe('https://www.youtube.com/watch?v=abc123');
        expect(first.embedUrl).toBe('https://www.youtube.com/embed/abc123');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [input] = fetchMock.mock.calls[0];
        expect(String(input)).toContain('key=test-key');
        expect(String(input)).toContain('type=video');
    });

    it('la allowlist no filtra las cuadrículas de vídeo (allowed queda true)', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(YOUTUBE_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/video?q=paris&lang=es&allowlist=wikipedia.org' +
            `&providers=${providersParam({ video: [YOUTUBE_PROVIDER] })}&max=8`;

        const { body } = await harness.invoke(url);
        expect(body.results[0].allowed).toBe(true);
    });

    it('no-GET → delega al siguiente middleware', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(YOUTUBE_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const { nextCalled } = await harness.invoke('/api/search/video?q=paris', 'POST');
        expect(nextCalled).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

// F5 — Modo seguro (safeSearch / supervisado): safe=1 filtra por allowlist en TODOS los tipos.
describe('searchProxy — modo seguro safe=1 (F5)', () => {
    it('web con safe=1 conserva solo los resultados permitidos por la allowlist', async () => {
        const fetchMock = vi.fn((input: any) => {
            const url = String(input);
            if (url.includes('wikipedia.org/w/api.php')) return Promise.resolve(okResponse(WIKI_JSON));
            if (url.includes('api.duckduckgo.com')) return Promise.resolve(okResponse(DDG_JSON));
            return Promise.resolve(failResponse(404));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=capital%20de%20francia&lang=es&allowlist=wikipedia.org&safe=1' +
            `&providers=${providersParam([WIKI_PROVIDER, DDG_PROVIDER])}&max=8&timeout=3000`;

        const { status, body } = await harness.invoke(url);

        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        // Sin safe hay 4 resultados (el RelatedTopic de duckduckgo.com queda marcado como
        // no permitido); con safe=1 solo pasan los 3 que la allowlist permite.
        expect(body.results).toHaveLength(3);
        expect(body.results.every((r: any) => r.allowed === true)).toBe(true);
        expect(body.results.some((r: any) => r.host === 'duckduckgo.com')).toBe(false);
        expect(body.results.map((r: any) => r.host).sort()).toEqual([
            'es.wikipedia.org',
            'es.wikipedia.org',
            'es.wikipedia.org',
        ]);
    });

    it('web sin safe=1 mantiene 4 resultados con el RelatedTopic marcado como no permitido', async () => {
        const fetchMock = vi.fn((input: any) => {
            const url = String(input);
            if (url.includes('wikipedia.org/w/api.php')) return Promise.resolve(okResponse(WIKI_JSON));
            if (url.includes('api.duckduckgo.com')) return Promise.resolve(okResponse(DDG_JSON));
            return Promise.resolve(failResponse(404));
        });
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/web?q=capital%20de%20francia&lang=es&allowlist=wikipedia.org' +
            `&providers=${providersParam([WIKI_PROVIDER, DDG_PROVIDER])}&max=8&timeout=3000`;

        const { body } = await harness.invoke(url);

        expect(body.results).toHaveLength(4);
        expect(
            body.results.some((r: any) => r.host === 'duckduckgo.com' && r.allowed === false),
        ).toBe(true);
    });

    it('vídeo con safe=1 filtra la cuadrícula (youtube.com no está en la allowlist) → []', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(YOUTUBE_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/video?q=paris&lang=es&allowlist=wikipedia.org&safe=1' +
            `&providers=${providersParam({ video: [YOUTUBE_PROVIDER] })}&max=8`;

        const { body } = await harness.invoke(url);

        expect(body.results).toEqual([]);
    });

    it('vídeo sin safe=1 muestra la cuadrícula completa aunque el host no esté en la allowlist', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse(YOUTUBE_JSON)));
        vi.stubGlobal('fetch', fetchMock);

        const url =
            '/api/search/video?q=paris&lang=es&allowlist=wikipedia.org' +
            `&providers=${providersParam({ video: [YOUTUBE_PROVIDER] })}&max=8`;

        const { body } = await harness.invoke(url);

        expect(body.results).toHaveLength(1);
        expect(body.results[0].allowed).toBe(true);
    });
});
