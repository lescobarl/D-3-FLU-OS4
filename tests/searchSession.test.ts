// ============================================================
// searchSession.test.ts — Buscador web + IA + imágenes + vídeo (F3/F4, capa pura)
// ------------------------------------------------------------
// Cubre la lógica sin DOM ni red:
//   - resolveSearchProviders (filtra deshabilitados / sin endpoint)
//   - buildProviderRequest (placeholders {q} / {lang} en ambos endpoints)
//   - normalizeResults → Wikipedia (query.search, título→URL con _)
//   - normalizeResults → DuckDuckGo (Abstract + RelatedTopics anidados/planos)
//   - normalizeResults → Commons imágenes/vídeo (query.pages por pageid)
//   - normalizeResults → YouTube (embed/watch desde plantillas {id})
//   - normalizeResults → Invidious (array, filtra type != video)
//   - filterNavigable (marca, no descarta; allowlist vacía → todo)
//   - navigableResults / capResults / buildOfflineFallback
// ============================================================
import { describe, expect, it } from 'vitest';

import {
    buildOfflineFallback,
    buildProviderRequest,
    capResults,
    filterNavigable,
    navigableResults,
    normalizeResults,
    resolveSearchProviders,
} from '../src/core/search/searchSession';

const WIKI_ENDPOINT =
    'https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={q}&format=json';
const DDG_ENDPOINT = 'https://api.duckduckgo.com/?q={q}&format=json&no_html=1&kl={lang}';

const BASE_RESULT = {
    snippet: '',
    url: '',
    host: '',
    source: 'wikipedia',
    allowed: true,
};

describe('searchSession — resolveSearchProviders', () => {
    it('filtra deshabilitados y proveedores sin endpoint', () => {
        const config = {
            providers: {
                web: [
                    { id: 'wikipedia', enabled: true, endpoint: WIKI_ENDPOINT },
                    { id: 'disabled', enabled: false, endpoint: 'https://x.example' },
                    { id: 'no-endpoint', enabled: true },
                    { id: 'duckduckgo', endpoint: DDG_ENDPOINT },
                ],
            },
        };
        expect(resolveSearchProviders(config, 'web').map((p) => p.id)).toEqual([
            'wikipedia',
            'duckduckgo',
        ]);
    });

    it('devuelve [] con config ausente, grupo vacío o tipo sin proveedores', () => {
        expect(resolveSearchProviders(undefined, 'web')).toEqual([]);
        expect(resolveSearchProviders({ providers: { web: [] } }, 'web')).toEqual([]);
        expect(resolveSearchProviders({ providers: {} }, 'images')).toEqual([]);
        expect(
            resolveSearchProviders({ providers: { images: [{ id: 'x', endpoint: 'https://x' }] } }, 'video'),
        ).toEqual([]);
    });
});

describe('searchSession — buildProviderRequest', () => {
    it('reemplaza {lang} y {q} en el endpoint de Wikipedia', () => {
        const req = buildProviderRequest(
            { id: 'wikipedia', endpoint: WIKI_ENDPOINT, maxResults: 3 },
            'capital de francia',
            'es',
        );
        expect(req.url).toBe(
            'https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=capital%20de%20francia&format=json',
        );
        expect(req.lang).toBe('es');
        expect(req.providerId).toBe('wikipedia');
        expect(req.maxResults).toBe(3);
    });

    it('reemplaza {lang} y {q} en DuckDuckGo (kl={lang})', () => {
        const req = buildProviderRequest(
            { id: 'duckduckgo', endpoint: DDG_ENDPOINT },
            'capital de francia',
            'en',
        );
        expect(req.url).toBe(
            'https://api.duckduckgo.com/?q=capital%20de%20francia&format=json&no_html=1&kl=en',
        );
        expect(req.providerId).toBe('duckduckgo');
    });

    it('codifica caracteres especiales de la consulta (encodeURIComponent)', () => {
        const req = buildProviderRequest({ id: 'wikipedia', endpoint: WIKI_ENDPOINT }, 'qué es FLU OS4?', 'es');
        expect(req.url).toContain('srsearch=qu%C3%A9%20es%20FLU%20OS4%3F');
    });

    it('maxResults por defecto es 5 cuando el proveedor no lo define', () => {
        const req = buildProviderRequest({ id: 'x', endpoint: 'https://x.example/?q={q}' }, 'hola', 'es');
        expect(req.maxResults).toBe(5);
    });

    it('propaga timeoutMs cuando el proveedor lo define', () => {
        const req = buildProviderRequest(
            { id: 'x', endpoint: 'https://x.example/?q={q}', timeoutMs: 1200 },
            'hola',
            'es',
        );
        expect(req.timeoutMs).toBe(1200);
    });
});

describe('searchSession — normalizeResults (Wikipedia)', () => {
    const WIKIPEDIA_PROVIDER = {
        id: 'wikipedia',
        articleUrlTemplate: 'https://{lang}.wikipedia.org/wiki/{title}',
    };

    it('normaliza query.search: título, URL con _ y host por idioma', () => {
        const raw = {
            query: {
                search: [
                    { title: 'París', snippet: 'Es la capital de Francia.' },
                    { title: 'Francia', snippet: 'País de Europa Occidental.' },
                ],
            },
        };
        const results = normalizeResults(raw, 'wikipedia', 'es', WIKIPEDIA_PROVIDER);
        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({
            title: 'París',
            snippet: 'Es la capital de Francia.',
            url: 'https://es.wikipedia.org/wiki/Par%C3%ADs',
            host: 'es.wikipedia.org',
            source: 'wikipedia',
            allowed: true,
        });
        expect(results[1].url).toBe('https://es.wikipedia.org/wiki/Francia');
    });

    it('usa el subdominio del idioma pedido (en)', () => {
        const results = normalizeResults(
            { query: { search: [{ title: 'Historia de México' }] } },
            'wikipedia',
            'en',
            WIKIPEDIA_PROVIDER,
        );
        expect(results[0].url).toBe('https://en.wikipedia.org/wiki/Historia_de_M%C3%A9xico');
        expect(results[0].host).toBe('en.wikipedia.org');
    });

    it('decodifica entidades HTML básicas del snippet', () => {
        const results = normalizeResults(
            {
                query: {
                    search: [
                        {
                            title: 'Entidades',
                            snippet: 'A &amp; B &lt;código&gt; &quot;comillas&quot; &#39;apóstrofe&#39; &#65;',
                        },
                    ],
                },
            },
            'wikipedia',
            'es',
            WIKIPEDIA_PROVIDER,
        );
        expect(results[0].snippet).toBe('A & B <código> "comillas" \'apóstrofe\' A');
    });

    it('colapsa espacios y salta items sin título', () => {
        const results = normalizeResults(
            {
                query: {
                    search: [
                        { title: '  A   B  ', snippet: '  hola   <b>mundo</b>  ' },
                        {},
                        { snippet: 'sin título' },
                        null,
                    ],
                },
            },
            'wikipedia',
            'es',
            WIKIPEDIA_PROVIDER,
        );
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('A   B');
        expect(results[0].snippet).toBe('hola mundo');
    });

    it('sin query.search devuelve []', () => {
        expect(normalizeResults({}, 'wikipedia', 'es', WIKIPEDIA_PROVIDER)).toEqual([]);
        expect(normalizeResults({ query: {} }, 'wikipedia', 'es', WIKIPEDIA_PROVIDER)).toEqual([]);
    });
});

describe('searchSession — normalizeResults (DuckDuckGo)', () => {
    const raw = {
        Heading: 'Capital de Francia',
        AbstractText: 'París es la capital de <b>Francia</b>.',
        AbstractURL: 'https://es.wikipedia.org/wiki/Par%C3%ADs',
        RelatedTopics: [
            { Text: 'París - Ciudad capital de Francia', FirstURL: 'https://duckduckgo.com/Par%C3%ADs' },
            {
                Name: 'Lugares',
                Topics: [
                    { Text: 'Torre Eiffel - Monumento de París', FirstURL: 'https://duckduckgo.com/Torre_Eiffel' },
                    { Text: 'Río Sena - Río que cruza París', FirstURL: 'https://duckduckgo.com/R%C3%ADo_Sena' },
                ],
            },
        ],
    };

    it('normaliza Abstract + RelatedTopics planos y anidados', () => {
        const results = normalizeResults(raw, 'duckduckgo', 'es');
        expect(results).toHaveLength(4);

        expect(results[0]).toMatchObject({
            title: 'Capital de Francia',
            snippet: 'París es la capital de Francia.',
            url: 'https://es.wikipedia.org/wiki/Par%C3%ADs',
            host: 'es.wikipedia.org',
            source: 'duckduckgo',
            allowed: true,
        });
        expect(results[1]).toMatchObject({ title: 'París', snippet: 'Ciudad capital de Francia', host: 'duckduckgo.com' });
        expect(results[2]).toMatchObject({ title: 'Torre Eiffel', snippet: 'Monumento de París', host: 'duckduckgo.com' });
        expect(results[3]).toMatchObject({ title: 'Río Sena', snippet: 'Río que cruza París', host: 'duckduckgo.com' });
    });

    it('descartar tópicos sin URL o sin texto', () => {
        const results = normalizeResults(
            { RelatedTopics: [{ Text: 'Solo texto' }, { FirstURL: 'https://x.example' }, null, 'cadena'] },
            'duckduckgo',
            'es',
        );
        expect(results).toEqual([]);
    });

    it('sin Abstract ni RelatedTopics devuelve []', () => {
        expect(normalizeResults({}, 'duckduckgo', 'es')).toEqual([]);
        expect(normalizeResults(null, 'duckduckgo', 'es')).toEqual([]);
    });
});

describe('searchSession — normalizeResults (desconocido)', () => {
    it('proveedor no soportado devuelve []', () => {
        expect(normalizeResults({ anything: true }, 'brave', 'es')).toEqual([]);
    });
});

describe('searchSession — filterNavigable', () => {
    const results = [
        { ...BASE_RESULT, title: 'A', host: 'es.wikipedia.org', source: 'wikipedia' },
        { ...BASE_RESULT, title: 'B', host: 'example.com', source: 'duckduckgo' },
    ];

    it('allowlist vacía → todo se considera navegable (sin restricción)', () => {
        const marked = filterNavigable(results, []);
        expect(marked.map((r) => r.allowed)).toEqual([true, true]);
        expect(marked.map((r) => r.title)).toEqual(['A', 'B']);
    });

    it('marca allowed según la allowlist curada (subdominios incluidos)', () => {
        const marked = filterNavigable(results, ['wikipedia.org']);
        expect(marked[0].allowed).toBe(true);
        expect(marked[1].allowed).toBe(false);
    });

    it('normaliza entradas de allowlist (espacios, mayúsculas, punto final)', () => {
        const marked = filterNavigable(results, [' Wikipedia.ORG. ']);
        expect(marked[0].allowed).toBe(true);
    });

    it('no muta los resultados originales', () => {
        filterNavigable(results, ['wikipedia.org']);
        expect(results[0].allowed).toBe(true);
    });

    it('sin resultados devuelve []', () => {
        expect(filterNavigable([], ['wikipedia.org'])).toEqual([]);
    });
});

describe('searchSession — navigableResults', () => {
    it('conserva solo los resultados permitidos', () => {
        const marked = filterNavigable(
            [
                { ...BASE_RESULT, title: 'A', host: 'wikipedia.org' },
                { ...BASE_RESULT, title: 'B', host: 'example.com' },
            ],
            ['wikipedia.org'],
        );
        expect(navigableResults(marked).map((r) => r.title)).toEqual(['A']);
    });

    it('sin resultados devuelve []', () => {
        expect(navigableResults([])).toEqual([]);
    });
});

describe('searchSession — capResults', () => {
    const arr = Array.from({ length: 5 }, (_, i) => ({ ...BASE_RESULT, title: String(i) }));

    it('recorta al tope', () => {
        expect(capResults(arr, 3).map((r) => r.title)).toEqual(['0', '1', '2']);
    });

    it('sin tope válido devuelve todos (max undefined, 0 o negativo)', () => {
        expect(capResults(arr, undefined)).toHaveLength(5);
        expect(capResults(arr, 0)).toHaveLength(5);
        expect(capResults(arr, -1)).toHaveLength(5);
    });

    it('no-array devuelve []', () => {
        expect(capResults(undefined as any, 5)).toEqual([]);
    });
});

describe('searchSession — buildOfflineFallback', () => {
    it('prioriza respuesta_ia_sin_resultados', () => {
        expect(
            buildOfflineFallback('q', 'es', {
                respuesta_ia_sin_resultados: 'No pude encontrar eso.',
                emptyState: 'Vacío',
            }),
        ).toBe('No pude encontrar eso.');
    });

    it('cae a emptyState si no hay respuesta_ia_sin_resultados', () => {
        expect(buildOfflineFallback('q', 'es', { emptyState: 'Sin resultados' })).toBe('Sin resultados');
    });

    it('cae al fallback por defecto sin etiquetas', () => {
        expect(buildOfflineFallback('q', 'es', {})).toBe('No encontré resultados para esa búsqueda.');
        expect(buildOfflineFallback('q', 'es')).toBe('No encontré resultados para esa búsqueda.');
    });

    it('es config-driven: ignora consulta/idioma, usa la etiqueta provista', () => {
        expect(buildOfflineFallback('cualquier cosa', 'en', { emptyState: 'Nada por aquí' })).toBe(
            'Nada por aquí',
        );
    });
});

// F4 — Proveedores de imágenes/vídeo. Los endpoints llevan literal https://
// en los tests (el directorio tests/ no lo escanea hardcodeGuard).
const COMMONS_PROVIDER = {
    id: 'commons',
    enabled: true,
    endpoint:
        'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch={q}&gsrnamespace=6&prop=imageinfo&iiprop=url|size&iiurlwidth=320&format=json',
};

const COMMONS_VIDEO_PROVIDER = {
    id: 'commons-video',
    enabled: true,
    endpoint:
        'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch={q}%20filetype:video&gsrnamespace=6&prop=videoinfo&viprop=url|size&viurlwidth=320&format=json',
};

const YOUTUBE_PROVIDER = {
    id: 'youtube',
    enabled: true,
    endpoint:
        'https://www.googleapis.com/youtube/v3/search?part=snippet&q={q}&type=video&maxResults={n}&key={key}',
    embedUrlTemplate: 'https://www.youtube.com/embed/{id}',
    watchUrlTemplate: 'https://www.youtube.com/watch?v={id}',
};

const INVIDIOUS_PROVIDER = {
    id: 'invidious',
    enabled: true,
    endpoint: 'https://inv.example.com/api/v1/search?q={q}',
    embedUrlTemplate: 'https://inv.example.com/embed/{id}',
    watchUrlTemplate: 'https://inv.example.com/watch?v={id}',
};

const COMMONS_IMAGES_JSON = {
    query: {
        pages: {
            '123': {
                pageid: 123,
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
        },
    },
};

const COMMONS_VIDEO_JSON = {
    query: {
        pages: {
            '7': {
                pageid: 7,
                title: 'File:Tour Eiffel timelapse.webm',
                videoinfo: [
                    {
                        url: 'https://upload.wikimedia.org/wikipedia/commons/7/7a/Tour_Eiffel_timelapse.webm',
                        descriptionurl:
                            'https://commons.wikimedia.org/wiki/File:Tour_Eiffel_timelapse.webm',
                        thumburl:
                            'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Tour_Eiffel_timelapse.webm/320px--Tour_Eiffel_timelapse.webm.jpg',
                        width: 1280,
                        height: 720,
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
                description: 'Un recorrido <b>por</b> París.',
                thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg' } },
            },
        },
        // Sin videoId (p.ej. un canal) → se descarta.
        { id: { kind: 'youtube#channel', channelId: 'c1' } },
    ],
};

const INVIDIOUS_JSON = [
    {
        type: 'video',
        videoId: 'inv1',
        title: 'París desde el cielo',
        description: 'Vuelo sobre París.',
        videoThumbnails: [{ url: 'https://inv.example.com/vi/inv1/hqdefault.jpg' }],
    },
    // No es vídeo → se descarta; sin videoId → se descarta.
    { type: 'playlist', playlistId: 'pl1' },
    { type: 'video', videoId: '' },
];

describe('searchSession — normalizeResults (Commons imágenes, F4)', () => {
    it('normaliza query.pages (objeto por pageid) a SearchResult', () => {
        const results = normalizeResults(COMMONS_IMAGES_JSON, 'commons', 'es', COMMONS_PROVIDER);
        expect(results).toHaveLength(1);
        const r = results[0];
        expect(r.type).toBe('images');
        expect(r.source).toBe('commons');
        expect(r.title).toBe('Paris - Eiffel Tower.jpg');
        expect(r.fileUrl).toBe(
            'https://upload.wikimedia.org/wikipedia/commons/3/3c/Paris_-_Eiffel_Tower.jpg',
        );
        expect(r.thumbnail).toContain('/thumb/');
        expect(r.width).toBe(2000);
        expect(r.height).toBe(3000);
        expect(r.allowed).toBe(true);
        // URL de artículo derivada del origen del endpoint: espacios → _ y File: codificado.
        expect(r.url).toBe('https://commons.wikimedia.org/wiki/File%3AParis_-_Eiffel_Tower.jpg');
        expect(r.host).toBe('commons.wikimedia.org');
    });

    it('salta páginas sin info y devuelve [] sin query.pages', () => {
        expect(normalizeResults({ query: { pages: {} } }, 'commons', 'es', COMMONS_PROVIDER)).toEqual([]);
        expect(normalizeResults({}, 'commons', 'es', COMMONS_PROVIDER)).toEqual([]);
        expect(
            normalizeResults(
                { query: { pages: { '1': { title: 'File:X.jpg' } } } },
                'commons',
                'es',
                COMMONS_PROVIDER,
            ),
        ).toEqual([]);
    });
});

describe('searchSession — normalizeResults (Commons vídeo, F4)', () => {
    it('usa videoinfo y source commons-video con type video', () => {
        const results = normalizeResults(COMMONS_VIDEO_JSON, 'commons-video', 'es', COMMONS_VIDEO_PROVIDER);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            type: 'video',
            source: 'commons-video',
            title: 'Tour Eiffel timelapse.webm',
            allowed: true,
        });
        expect(results[0].fileUrl).toContain('upload.wikimedia.org');
        expect(results[0].thumbnail).toContain('/thumb/');
        expect(results[0].width).toBe(1280);
        expect(results[0].height).toBe(720);
    });
});

describe('searchSession — normalizeResults (YouTube, F4)', () => {
    it('construye embed/watch desde plantillas y usa thumbnail medium', () => {
        const results = normalizeResults(YOUTUBE_JSON, 'youtube', 'es', YOUTUBE_PROVIDER);
        expect(results).toHaveLength(1);
        const r = results[0];
        expect(r).toMatchObject({
            type: 'video',
            source: 'youtube',
            title: 'París en 4K',
            snippet: 'Un recorrido por París.',
            url: 'https://www.youtube.com/watch?v=abc123',
            embedUrl: 'https://www.youtube.com/embed/abc123',
            thumbnail: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
            allowed: true,
        });
        expect(r.host).toBe('www.youtube.com');
    });

    it('sin items devuelve []', () => {
        expect(normalizeResults({}, 'youtube', 'es', YOUTUBE_PROVIDER)).toEqual([]);
    });
});

describe('searchSession — normalizeResults (Invidious, F4)', () => {
    it('filtra por type video y usa videoThumbnails[0]', () => {
        const results = normalizeResults(INVIDIOUS_JSON, 'invidious', 'es', INVIDIOUS_PROVIDER);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            type: 'video',
            source: 'invidious',
            title: 'París desde el cielo',
            snippet: 'Vuelo sobre París.',
            url: 'https://inv.example.com/watch?v=inv1',
            embedUrl: 'https://inv.example.com/embed/inv1',
            thumbnail: 'https://inv.example.com/vi/inv1/hqdefault.jpg',
            allowed: true,
        });
    });

    it('no-array devuelve []', () => {
        expect(normalizeResults({}, 'invidious', 'es', INVIDIOUS_PROVIDER)).toEqual([]);
    });
});
