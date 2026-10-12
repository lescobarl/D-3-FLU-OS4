/**
 * voice/lib/imageGeneration — generacion de imagen del Pizarrón (0% -> cubierto).
 *
 * POR QUE ESTE TEST: `src/voice/lib/imageGeneration.js` (390 lineas) es la ruta
 * de PRODUCTO de imagen/video: decide si un workspace es visual, promete/evita
 * la generacion (cache), llama al proxy local con deadline, distingue JSON de
 * blob, y degrada a SVG local cuando algo falla. Estaba al 0%: nadie ejecutaba
 * ninguna de esas decisiones. Aqui se fija la CONDUCTA con `fetch` y
 * `URL.createObjectURL` sustituidos (el transporte se prueba aparte), mirando el
 * par { image_url, trace } que es el contrato que consume la UI.
 *
 * Aislamiento: la cache es estado de MODULO y no tiene API para vaciarla, asi
 * que cada caso usa un workspace unico (la clave es idioma::prompt).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildWorkspaceImageArtifact,
    fetchFalVideo,
    fetchOpenRouterImageFallback,
    fetchWorkspaceImageSource,
    resolveWorkspaceAiImageSource,
} from '../src/voice/lib/imageGeneration.js';
import { VISUAL_CONFIG } from '../src/voice/lib/visualConfig.js';
import { AI_PROVIDER_IDS } from '../src/core/config/sharedConfig';

type FakeResponse = {
    ok: boolean;
    status: number;
    headers: { get: (name: string) => string | null };
    json: () => Promise<unknown>;
    text: () => Promise<string>;
    blob: () => Promise<{ size: number }>;
};

function jsonResponse(
    payload: unknown,
    {
        ok = true,
        status = 200,
        blobSize = 0,
        textOverride,
        contentType = 'application/json',
    }: { ok?: boolean; status?: number; blobSize?: number; textOverride?: string; contentType?: string } = {},
): FakeResponse {
    return {
        ok,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
        json: async () => payload,
        text: async () => textOverride ?? JSON.stringify(payload),
        blob: async () => ({ size: blobSize }),
    };
}

/** Lee el trace como contrato de runtime (la funcion devuelve una union de formas). */
const traceOf = (out: { trace: object }) =>
    out.trace as { source?: string; hasImage?: boolean; prompt?: string; seed?: number; error?: string; provider?: string };

/** Workspace visual (tipo del contrato) con sujeto unico por caso. */
const visual = (seed: string) => ({ tipo: 'diagram', prompt_visual: `corte de la celula ${seed}` });
const nonVisual = (seed: string) => ({ tipo: 'doc', contenido: `apunte de clase ${seed}` });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:flu-1');
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('imageGeneration — SVG local de respaldo', () => {
    it('compone un data URL SVG con el sujeto y su trace de fuente local', async () => {
        const out = await resolveWorkspaceAiImageSource({ workspace: visual('mitosis'), language: 'es' });

        expect(out.image_url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
        expect(out.trace).toMatchObject({ provider: 'local-svg', kind: 'inline', source: 'local_svg_fallback', hasImage: true });
        const svg = decodeURIComponent(out.image_url);
        expect(svg).toContain('corte de la celula mitosis');
        expect(out.trace.prompt).toBeTruthy();
    });

    it('escapa el sujeto en XML (no puede inyectar marcado en el SVG)', async () => {
        const out = await resolveWorkspaceAiImageSource({
            workspace: { tipo: 'diagram', prompt_visual: 'a & b <script>x</script>' },
        });

        const svg = decodeURIComponent(out.image_url);
        expect(svg).toContain('a &amp; b &lt;script&gt;x&lt;/script&gt;');
        expect(svg).not.toContain('<script>x</script>');
    });

    it('recorta el sujeto largo antes de meterlo en el SVG', async () => {
        const out = await resolveWorkspaceAiImageSource({
            workspace: { tipo: 'diagram', prompt_visual: 'x'.repeat(400) },
        });

        const label = decodeURIComponent(out.image_url).match(/aria-label="([^"]*)"/)?.[1] ?? '';
        expect(label.length).toBeLessThan(400);
    });
});

describe('imageGeneration — artefacto de workspace', () => {
    it('un tipo NO visual no genera nada (trace not_visual, sin llamada de red)', async () => {
        const out = await buildWorkspaceImageArtifact(nonVisual('algebra'), 'es');

        expect(out).toEqual({
            image_url: '',
            trace: { provider: expect.any(String), model: expect.any(String), kind: 'url', source: 'not_visual', hasImage: false },
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('un tipo visual delega en Pollinations con sello determinista', async () => {
        const ws = visual('fotosintesis');
        const a = await buildWorkspaceImageArtifact(ws, 'es');
        const b = await buildWorkspaceImageArtifact(ws, 'es');
        const ta = traceOf(a);
        const tb = traceOf(b);

        expect(ta.source).toBe('pollinations_generation');
        expect(ta.hasImage).toBe(true);
        expect(a.image_url).toContain('/prompt/');
        expect(a.image_url).toContain(encodeURIComponent(String(ta.prompt)).slice(0, 12));
        // Misma entrada -> mismo seed (reproducible); distinta entrada -> distinto seed.
        expect(ta.seed).toBe(tb.seed);
        const otro = await buildWorkspaceImageArtifact(visual('otro tema distinto'), 'es');
        expect(traceOf(otro).seed).not.toBe(ta.seed);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sin sujeto (workspace vacio) no hay prompt: no es visual', async () => {
        const out = await buildWorkspaceImageArtifact({ tipo: 'diagram' }, 'es');

        expect(out.image_url).toBe('');
        expect(out.trace.source).toBe('not_visual');
    });
});

describe('imageGeneration — fetchWorkspaceImageSource', () => {
    it('un tipo no visual sale sin tocar la red', async () => {
        const out = await fetchWorkspaceImageSource({ workspace: nonVisual('historia') });

        expect(out.image_url).toBe('');
        expect(out.trace.source).toBe('not_visual');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('JSON con image_url: devuelve la url y el trace del servidor', async () => {
        const ws = visual('json-ok');
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ image_url: 'https://cdn.example/img.png', trace: { source: 'server_json', hasImage: true } }),
        );

        const out = await fetchWorkspaceImageSource({ workspace: ws, language: 'en', apiKey: 'k-1' });

        expect(out.image_url).toBe('https://cdn.example/img.png');
        expect(out.trace.source).toBe('server_json');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(VISUAL_CONFIG.image.proxies.workspaceImage);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ workspace: ws, language: 'en', apiKey: 'k-1' });
    });

    it('sin apiKey, la clave no viaja en el cuerpo', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ image_url: 'https://cdn.example/sin-key.png' }));

        await fetchWorkspaceImageSource({ workspace: visual('sin-key') });

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('apiKey');
    });

    it('JSON sin image_url degrada al SVG local con el error anotado', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ trace: { source: 'server_json' } }));

        const out = await fetchWorkspaceImageSource({ workspace: visual('json-vacio') });

        expect(out.image_url.startsWith('data:image/svg+xml')).toBe(true);
        expect(out.trace.source).toBe('local_svg_fallback');
        expect(out.trace.error).toBe('workspace_image_empty_json');
    });

    it('blob del proxy: objeto-url y NO se cachea (la url es efimera)', async () => {
        const ws = visual('blob-ok');
        fetchMock.mockResolvedValue(jsonResponse(null, { blobSize: 2_048, contentType: 'image/png' }));

        const first = await fetchWorkspaceImageSource({ workspace: ws });
        const second = await fetchWorkspaceImageSource({ workspace: ws });

        expect(first.image_url).toBe('blob:flu-1');
        expect(first.trace.source).toBe('server_proxy');
        expect(second.image_url).toBe('blob:flu-1');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('blob vacio se trata como fallo (no se entrega una imagen sin bytes)', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { blobSize: 0, contentType: 'image/png' }));

        const out = await fetchWorkspaceImageSource({ workspace: visual('blob-vacio') });

        expect(out.image_url.startsWith('data:image/svg+xml')).toBe(true);
        expect(out.trace.error).toBe('workspace_image_empty_blob');
    });

    it('respuesta no-ok: el detalle del servidor viaja en el trace', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 503, textOverride: 'proveedor caido' }));

        const out = await fetchWorkspaceImageSource({ workspace: visual('http-503') });

        expect(out.trace.error).toBe('proveedor caido');
        expect(out.image_url.startsWith('data:image/svg+xml')).toBe(true);
    });

    it('respuesta no-ok sin texto: cae al codigo de estado', async () => {
        fetchMock.mockResolvedValueOnce({
            ...jsonResponse(null, { ok: false, status: 500 }),
            text: async () => {
                throw new Error('sin cuerpo');
            },
        });

        const out = await fetchWorkspaceImageSource({ workspace: visual('http-500') });

        expect(out.trace.error).toBe('workspace_image_http_500');
    });

    it('timeout (AbortError): el trace lo distingue de un fallo generico', async () => {
        fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));

        const out = await fetchWorkspaceImageSource({ workspace: visual('timeout') });

        expect(out.trace.error).toBe('workspace_image_timeout');
    });

    it('fallo de red: degrada al SVG local con el mensaje del error', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('sin conexion'));

        const out = await fetchWorkspaceImageSource({ workspace: visual('red-caida') });

        expect(out.trace.source).toBe('local_svg_fallback');
        expect(out.trace.error).toBe('sin conexion');
    });

    it('con errorFallback distinto de localSvg devuelve vacio, no un SVG', async () => {
        const pipeline = VISUAL_CONFIG.image.pipeline;
        const previo = pipeline.errorFallback;
        pipeline.errorFallback = 'none';
        try {
            fetchMock.mockRejectedValueOnce(new TypeError('sin conexion'));

            const out = await fetchWorkspaceImageSource({ workspace: visual('sin-fallback') });

            expect(out.image_url).toBe('');
            expect(out.trace.source).toBe('generation_failed');
            expect(out.trace.error).toBe('sin conexion');
        } finally {
            pipeline.errorFallback = previo;
        }
    });

    it('cache: la misma peticion se resuelve UNA vez y se reutiliza', async () => {
        const ws = visual('cache-ok');
        fetchMock.mockResolvedValueOnce(jsonResponse({ image_url: 'https://cdn.example/cache.png' }));

        const first = await fetchWorkspaceImageSource({ workspace: ws });
        const second = await fetchWorkspaceImageSource({ workspace: ws });

        expect(second).toBe(first);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('cache en vuelo: dos peticiones simultaneas comparten la promesa', async () => {
        const ws = visual('cache-inflight');
        let liberar: (value: unknown) => void = () => {};
        fetchMock.mockReturnValueOnce(
            new Promise((resolve) => {
                liberar = resolve;
            }),
        );

        const p1 = fetchWorkspaceImageSource({ workspace: ws });
        const p2 = fetchWorkspaceImageSource({ workspace: ws });
        liberar(jsonResponse({ image_url: 'https://cdn.example/inflight.png' }));
        const [r1, r2] = await Promise.all([p1, p2]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(r1.image_url).toBe('https://cdn.example/inflight.png');
        expect(r2).toEqual(r1);
    });
});

describe('imageGeneration — fallback de imagen por OpenRouter', () => {
    it('con imageUrl devuelve la url y el trace del proveedor', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ imageUrl: 'data:image/png;base64,AAA' }));

        const out = await fetchOpenRouterImageFallback({ workspace: visual('or-ok'), apiKey: 'k' });

        expect(out.image_url).toBe('data:image/png;base64,AAA');
        expect(out.trace).toMatchObject({ provider: AI_PROVIDER_IDS.OPENROUTER, source: 'openrouter_image_fallback', hasImage: true });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(VISUAL_CONFIG.image.proxies.openrouterImage);
        expect(JSON.parse(init.body)).toMatchObject({ language: 'es', apiKey: 'k' });
    });

    it('respuesta sin imageUrl: manda el trace del servidor si viene', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ trace: { source: 'server', reason: 'no_key' } }));

        const out = await fetchOpenRouterImageFallback({ workspace: visual('or-vacio') });

        expect(out.image_url).toBe('');
        expect(out.trace.source).toBe('server');
        expect(out.trace.reason).toBe('no_key');
    });

    it('respuesta sin imageUrl NI trace: se marca como vacia, no como fallo', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({}));

        const out = await fetchOpenRouterImageFallback({ workspace: visual('or-vacio-sin-trace') });

        expect(out.image_url).toBe('');
        expect(out.trace).toMatchObject({ source: 'empty_response', hasImage: false });
    });

    it('no-ok usa el detalle del servidor y timeout se distingue', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 502, textOverride: 'sin key' }));
        const sinKey = await fetchOpenRouterImageFallback({ workspace: visual('or-502') });
        expect(sinKey.trace.source).toBe('proxy_error');
        expect(sinKey.trace.error).toBe('sin key');

        fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        const timeout = await fetchOpenRouterImageFallback({ workspace: visual('or-timeout') });
        expect(timeout.trace.source).toBe('openrouter_image_timeout');
    });
});

describe('imageGeneration — video real (fal.ai)', () => {
    it('sin prompt no llama al proxy', async () => {
        const out = await fetchFalVideo({ prompt: '   ' });

        expect(out.video_url).toBe('');
        expect(out.trace.source).toBe('empty_prompt');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('con videoUrl devuelve el clip; el modelo solo viaja si se pide', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ videoUrl: 'https://cdn.example/clip.mp4' }));

        const out = await fetchFalVideo({ prompt: 'un volcan', apiKey: 'k' });

        expect(out.video_url).toBe('https://cdn.example/clip.mp4');
        expect(fetchMock.mock.calls[0][0]).toBe(VISUAL_CONFIG.image.proxies.falVideo);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('model');

        fetchMock.mockResolvedValueOnce(jsonResponse({ videoUrl: 'https://cdn.example/clip2.mp4' }));
        await fetchFalVideo({ prompt: 'otro volcan', model: 'fal-1' });
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('fal-1');
    });

    it('fallo del proxy y timeout quedan etiquetados en el trace', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 500, textOverride: 'boom' }));
        const error = await fetchFalVideo({ prompt: 'un rio' });
        expect(error.trace.source).toBe('proxy_error');
        expect(error.trace.error).toBe('boom');

        fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        const timeout = await fetchFalVideo({ prompt: 'otro rio' });
        expect(timeout.trace.source).toBe('fal_video_timeout');
    });
});

describe('PRUEBA DE DETECTOR (el detector no es decorativo): la banda de voz DISTINTA esta por debajo de la de voz nueva', () => {
  it('cosineDistinctVoice < cosineNewVoice: "sin evidencia" no es "voz nueva"', async () => {
    const cfg = await import('../src/core/config/sharedConfig');
    const d = (cfg as unknown as { VOICE_DIARIZATION_DEFAULTS: { cosineDistinctVoice: number; cosineNewVoice: number } }).VOICE_DIARIZATION_DEFAULTS;
    expect(d.cosineDistinctVoice, 'la banda de voz distinta tiene que ser MENOR que la de voz nueva').toBeLessThan(d.cosineNewVoice);
  });
});
