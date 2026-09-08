// ============================================================
// _sim-pollinations-caida-openrouter.spec.ts (tools/e2e-sims)
// ------------------------------------------------------------
// Validación determinista del respaldo de imagen vía OpenRouter:
//  1. Bloquea TODA llamada a image.pollinations.ai (route abort).
//  2. Dispara el contrato visual real de "ok flu genera una imagen
//     de un elefante" (workspace.tipo 'image_prompt' + prompt_visual).
//  3. El <img> de Pollinations falla → retryLoad ×3 → fallbackToOpenRouter
//     → POST /api/openrouter-image → Image API de OpenRouter → data URL visible.
// Corre solo este spec: npx playwright test tools/e2e-sims/...
// ============================================================
import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoClean, stubLocalSpeech, captureScreenshot } from '../tests/e2e/_helpers';

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'validacion-openrouter');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

function readEnvKey(name: string): string {
    try {
        const text = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
        const match = text.split(/\r?\n/).find((line) => line.startsWith(`${name}=`));
        if (!match) return '';
        const value = match.slice(name.length + 1).trim();
        return value.replace(/^["']|["']$/g, '');
    } catch {
        return '';
    }
}

test('Bloqueo de Pollinations → respaldo OpenRouter muestra la imagen', async ({ page }) => {
    test.setTimeout(180_000);

    stubLocalSpeech(page);

    let pollinationsAttempts = 0;
    let openrouterImageRequests = 0;
    await page.route('**://image.pollinations.ai/**', async (route) => {
        pollinationsAttempts += 1;
        await route.abort('failed');
    });
    page.on('request', (req) => {
        if (req.url().includes('/api/openrouter-image')) openrouterImageRequests += 1;
    });

    await gotoClean(page, { waitWorkspaceHub: true });

    const orKey = readEnvKey('VITE_OPENROUTER_API_KEY');
    if (orKey) {
        await page.evaluate((key) => localStorage.setItem('flu-text-api-key', key), orKey);
    }

    const dispatched = await page.evaluate(() => {
        const fn = (window as any).__fluOnContractResolved;
        if (typeof fn !== 'function') {
            throw new Error('__fluOnContractResolved no disponible');
        }
        return fn({
            contract: {
                navegacion: { comando: null, destino: null, parametros: {} },
                workspace: {
                    tipo: 'image_prompt',
                    titulo: 'Elefante',
                    contenido: '',
                    prompt_visual:
                        'Un elefante africano caminando por la sabana al atardecer, fotorrealista, luz cálida, sin texto.',
                    puntos_clave: [],
                },
                respuesta_voz: 'Claro, genero una imagen de un elefante.',
            },
            transcript: 'ok flu genera una imagen de un elefante',
        }).then((result: any) => result || '');
    });

    expect(dispatched !== undefined).toBe(true);

    const attemptsBefore = pollinationsAttempts;
    try {
        await expect(page.locator('.generated-image__img[src^="data:image"]').first()).toBeVisible({
            timeout: 120_000,
        });
        expect(pollinationsAttempts).toBeGreaterThan(attemptsBefore);
    } finally {
        console.log('POLLINATIONS_ATTEMPTS', pollinationsAttempts, 'OPENROUTER_IMAGE_REQUESTS', openrouterImageRequests);
        await captureScreenshot(page, SHOTS_DIR, 'elefante-openrouter-state.png', 200);
    }
});
