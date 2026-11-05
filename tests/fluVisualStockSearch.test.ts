/**
 * voice/lib/fluVisualStockSearch — stock opcional (Openverse) (79 sentencias, 0%).
 *
 * POR QUE ESTE TEST: `src/voice/lib/fluVisualStockSearch.js` decide si una imagen
 * de stock sirve o no: puntua titulo y autor contra el brief del usuario, castiga
 * titulos basura (los `titlePenalties` ingleses) y exige un MINIMO de puntuacion
 * para no colar una foto que no tiene que ver. Estaba al 0%. El transporte se
 * sustituye (`fetchTextEngine` tiene su propio dueno y sus guards); lo que se fija
 * aqui es la politica: cuando se busca, que URL se pide, que resultado gana y
 * cuando se devuelve null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchTextEngineMock = vi.hoisted(() => vi.fn());
vi.mock('../src/core/ai/httpClient', () => ({ fetchTextEngine: fetchTextEngineMock }));

import { resolveOpenverseStockArtifact } from '../src/voice/lib/fluVisualStockSearch.js';
import { VISUAL_CONFIG } from '../src/voice/lib/visualConfig.js';
import { getVisualPipelineConfig } from '../src/voice/lib/fluVisualPipeline.js';

const stockCfg = VISUAL_CONFIG.image.pipeline.stockSearch;
const cfg = getVisualPipelineConfig();
const BRIEF = 'volcan en erupcion';
const workspace = { tipo: 'image_prompt', prompt_visual: BRIEF };

const okJson = (payload: unknown) => ({ ok: true, json: async () => payload });
const resultado = (over: Record<string, unknown> = {}) => ({ title: '', url: 'https://cdn/x.jpg', ...over });

let enabledPrevio: boolean;

beforeEach(() => {
    fetchTextEngineMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    enabledPrevio = stockCfg.enabled;
    stockCfg.enabled = true;
});

afterEach(() => {
    stockCfg.enabled = enabledPrevio;
    vi.restoreAllMocks();
});

describe('fluVisualStockSearch — puertas', () => {
    it('con la busqueda de stock APAGADA no se llama a la red', async () => {
        stockCfg.enabled = false;

        expect(await resolveOpenverseStockArtifact(workspace, 'es')).toBe(null);
        expect(fetchTextEngineMock).not.toHaveBeenCalled();
    });

    it('sin brief no hay busqueda', async () => {
        expect(await resolveOpenverseStockArtifact({ tipo: 'image_prompt' }, 'es')).toBe(null);
        expect(fetchTextEngineMock).not.toHaveBeenCalled();
    });

    it('pide el brief codificado con el tamano de pagina y el filtro de muertas', async () => {
        fetchTextEngineMock.mockResolvedValue(okJson({ results: [] }));

        await resolveOpenverseStockArtifact(workspace, 'en');

        expect(fetchTextEngineMock).toHaveBeenCalledTimes(1);
        const [url, init, timeoutMs] = fetchTextEngineMock.mock.calls[0];
        expect(String(url)).toContain(`q=${encodeURIComponent(BRIEF)}`);
        expect(String(url)).toContain(`page_size=${cfg.stockPageSize}`);
        expect(String(url)).toContain('filter_dead=true');
        expect(String(url)).toContain(String(cfg.openverseApiBase).replace(/\/$/, ''));
        expect(init.headers.Accept).toBe('application/json');
        expect(timeoutMs).toBe(cfg.stockRequestTimeoutMs);
    });
});

describe('fluVisualStockSearch — fallos de transporte', () => {
    it('respuesta no-ok, payload sin results o transporte que lanza: null', async () => {
        fetchTextEngineMock.mockResolvedValueOnce({ ok: false, json: async () => ({ results: [resultado()] }) });
        expect(await resolveOpenverseStockArtifact(workspace)).toBe(null);

        fetchTextEngineMock.mockResolvedValueOnce(okJson({ resultados: [] }));
        expect(await resolveOpenverseStockArtifact(workspace)).toBe(null);

        fetchTextEngineMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('json roto'); } });
        expect(await resolveOpenverseStockArtifact(workspace)).toBe(null);

        fetchTextEngineMock.mockRejectedValueOnce(new Error('sin red'));
        expect(await resolveOpenverseStockArtifact(workspace)).toBe(null);
    });
});

describe('fluVisualStockSearch — puntuacion y umbral', () => {
    it('gana el resultado que casa mas tokens del brief, y el trace lo declara', async () => {
        fetchTextEngineMock.mockResolvedValue(okJson({
            results: [
                resultado({ title: 'paisaje cualquiera', url: 'https://cdn/malo.jpg' }),
                resultado({ title: 'Volcan en erupcion', thumbnail: 'https://cdn/bueno-thumb.jpg', url: 'https://cdn/bueno.jpg' }),
            ],
        }));

        const artefacto = await resolveOpenverseStockArtifact(workspace, 'en');

        expect(artefacto!.image_url).toBe('https://cdn/bueno-thumb.jpg');
        expect(artefacto!.trace).toMatchObject({
            provider: 'openverse',
            source: 'openverse_full_brief',
            hasImage: true,
            query: BRIEF,
            title: 'Volcan en erupcion',
            language: 'en',
        });
        expect(Number(artefacto!.trace.score)).toBe(16);
    });

    it('sin thumbnail cae a la url; sin ninguna de las dos se descarta', async () => {
        fetchTextEngineMock.mockResolvedValueOnce(okJson({
            results: [resultado({ title: 'Volcan en erupcion', thumbnail: '', url: 'https://cdn/solo-url.jpg' })],
        }));
        expect((await resolveOpenverseStockArtifact(workspace))!.image_url).toBe('https://cdn/solo-url.jpg');

        fetchTextEngineMock.mockResolvedValueOnce(okJson({
            results: [{ title: 'Volcan en erupcion' }],
        }));
        expect(await resolveOpenverseStockArtifact(workspace)).toBe(null);
    });

    it('por debajo del minimo aceptado no se cuela nada', async () => {
        fetchTextEngineMock.mockResolvedValue(okJson({
            results: [
                resultado({ title: 'volcan' }), // 8 puntos: casa el token, pero no llega al minimo
                resultado({ title: 'otra cosa' }), // 0 puntos
            ],
        }));

        expect(cfg.stockMinAcceptScore).toBeGreaterThan(8);
        expect(await resolveOpenverseStockArtifact(workspace)).toBe(null);
    });

    it('un titulo con palabra castigada baja y no gana (la lista es INGLESA)', async () => {
        fetchTextEngineMock.mockResolvedValue(okJson({
            results: [
                resultado({ title: 'wreck volcan en erupcion', url: 'https://cdn/castigado.jpg' }),
                resultado({ title: 'Volcan en erupcion', url: 'https://cdn/limpio.jpg' }),
            ],
        }));

        const artefacto = await resolveOpenverseStockArtifact(workspace);

        expect(artefacto!.image_url).toBe('https://cdn/limpio.jpg');
        expect(Number(artefacto!.trace.score)).toBe(16);
    });

    it('LIMITE CONOCIDO: los castigos son ingleses y no ven "abandonado"', async () => {
        // Mismo titulo util, uno con la pinta basura en español: empatan a 16 y gana el PRIMERO.
        fetchTextEngineMock.mockResolvedValue(okJson({
            results: [
                resultado({ title: 'Volcan en erupcion abandonado', url: 'https://cdn/primero.jpg' }),
                resultado({ title: 'Volcan en erupcion', url: 'https://cdn/segundo.jpg' }),
            ],
        }));

        const artefacto = await resolveOpenverseStockArtifact(workspace);

        expect(artefacto!.image_url).toBe('https://cdn/primero.jpg');
        expect(Number(artefacto!.trace.score)).toBe(16);
    });

    it('el autor solo suma al monton: por si mismo no llega al minimo', async () => {
        fetchTextEngineMock.mockResolvedValueOnce(okJson({
            results: [resultado({ title: 'foto 1', creator: 'volcan erupcion' })],
        }));
        // 8 puntos (autor) < minimo aceptado: no se acepta la foto.
        expect(await resolveOpenverseStockArtifact(workspace)).toBe(null);

        fetchTextEngineMock.mockResolvedValueOnce(okJson({
            results: [resultado({ title: 'volcan erupcion', creator: 'volcan erupcion' })],
        }));
        const ambas = await resolveOpenverseStockArtifact(workspace);
        expect(Number(ambas!.trace.score)).toBe(16);
    });

    it('sin resultados no hay artefacto', async () => {
        fetchTextEngineMock.mockResolvedValue(okJson({ results: [] }));

        expect(await resolveOpenverseStockArtifact(workspace)).toBe(null);
    });
});
