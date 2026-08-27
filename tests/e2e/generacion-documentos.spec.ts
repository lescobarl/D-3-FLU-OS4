// ============================================================
// generacion-documentos.spec.ts — E2E navegador F1 → F3 (y F4)
// ============================================================
// Recorre el flujo productivo completo EN MODO 100% LOCAL (sin
// servidor externo ni API key):
//
//   F1: subir un documento .txt → análisis (parseDocument +
//       fallback heurístico) → DocumentResultPanel
//   F3: dispatch del evento de generación → documento descargable
//       (fallback offline) → GenerationProgressPanel
//   F4 (ligero): dispatch de generación de video → guion/storyboard
//       (o mp4 real con ffmpeg.wasm autohospedado)
//
// Los selectores de estado son invariantes al idioma y al proveedor
// de IA, por lo que el flujo es totalmente offline.
// ============================================================

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';

const OS4_URL = 'http://localhost:5175';
const SAMPLE_TXT = 'tests/e2e/fixtures/sample.txt';

// Selector del input de documento (accept incluye .txt, .md, text/*)
const DOC_INPUT = 'input[type="file"][accept*=".txt"]';

// ─── Helpers ────────────────────────────────────────────────

async function gotoClean(page: Page) {
    await page.goto(OS4_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await page.evaluate(() => {
        try {
            localStorage.clear();
        } catch {
            // ignore
        }
    });
    const tablistSelectors = ['nav[role="tablist"]', '[role="tablist"]', '.flu-shell-tabs'];
    const timeout = 15000;
    const start = Date.now();
    let lastError: unknown;
    while (Date.now() - start < timeout) {
        for (const sel of tablistSelectors) {
            const loc = page.locator(sel).first();
            const count = await loc.count().catch(() => 0);
            if (count > 0) {
                try {
                    await loc.waitFor({ state: 'attached', timeout: 3000 });
                    await page.waitForTimeout(500);
                    return;
                } catch (e) {
                    lastError = e;
                }
            }
        }
        await page.waitForTimeout(200);
    }
    throw lastError || new Error(`gotoClean: timeout waiting for tablist after ${timeout}ms`);
}

/** Instala un stub de speechSynthesis ANTES de que cargue la app. */
function stubLocalSpeech(page: Page) {
    return page.addInitScript(() => {
        const voice = {
            name: 'Voz Local',
            lang: 'es-MX',
            localService: true,
            default: true,
            voiceURI: 'voz-local-es-mx',
        };
        try {
            Object.defineProperty(window, 'speechSynthesis', {
                configurable: true,
                value: {
                    getVoices: () => [voice],
                    speak: () => {},
                    cancel: () => {},
                },
            });
        } catch {
            // ignore
        }
        // Headless Chromium no implementa SpeechSynthesisUtterance:
        // se define un stub para poder encolar utterances.
        try {
            const MockUtterance = class {
                text: string;
                lang = '';
                voice: unknown = null;
                rate = 1;
                pitch = 1;
                onstart: (() => void) | null = null;
                onend: (() => void) | null = null;
                onerror: ((event: { error?: string }) => void) | null = null;
                constructor(text: string) {
                    this.text = text;
                }
            };
            Object.defineProperty(window, 'SpeechSynthesisUtterance', {
                configurable: true,
                value: MockUtterance,
            });
        } catch {
            // ignore
        }
    });
}

/** Sube el documento de muestra y espera el análisis F1. */
async function uploadAndAnalyze(page: Page) {
    await page.setInputFiles(DOC_INPUT, SAMPLE_TXT);
    await page.waitForSelector('.document-analysis__title', { timeout: 30000 });
    await expect(page.locator('.document-analysis__title')).toContainText('Análisis de Documento');
}

// ─── Suite ──────────────────────────────────────────────────

test.describe('🟢 E2E Generación de Documentos — F1 → F3 (modo 100% local)', () => {
    test('F1 — subir documento .txt genera el análisis (DocumentResultPanel)', async ({ page }) => {
        await gotoClean(page);
        await uploadAndAnalyze(page);

        // Metadatos: tipo y nombre del archivo
        await expect(page.locator('.document-analysis__meta-item').first()).toContainText('Texto');
        await expect(page.locator('.document-analysis__meta-item').nth(1)).toContainText('sample.txt');

        // Resumen heurístico presente
        const resumen = page.locator('.homework-analysis__detail');
        await expect(resumen).toBeVisible();
        await expect(resumen).toContainText('Resumen');
    });

    test('F1 → F3 — tras analizar, genera un documento descargable (offline)', async ({ page }) => {
        await gotoClean(page);
        await uploadAndAnalyze(page);

        // F3: dispara el evento de generación (mismo canal que el comando de voz)
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('flu:generate-document'));
        });

        // El job llega a "listo" y se muestra el bloque de resultado
        await page.waitForSelector('.generation-panel__state--listo', { timeout: 30000 });
        await page.waitForSelector('.generation-panel__result', { timeout: 30000 });

        // Resultado: nombre del documento + botón de descarga
        await expect(page.locator('.generation-panel__result-name')).toContainText('sample');
        const downloadBtn = page.locator('.generation-panel__result button', {
            hasText: 'Descargar',
        });
        await expect(downloadBtn).toBeVisible();

        // ⬇️ CLIC REAL de descarga: captura el evento download de Playwright.
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
        await downloadBtn.click();
        const download = await downloadPromise;

        // 1) El archivo descargado lleva el nombre del documento generado
        //    (derivado del archivo subido 'sample.txt').
        const suggestedName = download.suggestedFilename();
        expect(suggestedName.toLowerCase()).toContain('sample');

        // 2) El archivo existe en disco y NO está vacío.
        const filePath = await download.path();
        expect(filePath).toBeTruthy();
        const buf = fs.readFileSync(filePath as string);
        expect(buf.length).toBeGreaterThan(0);

        // 3) Contenido verificable según el formato serializado:
        if (suggestedName.toLowerCase().endsWith('.pdf')) {
            // PDF generado por pdfkit. Playwright captura los data: URLs como
            // texto (data:application/pdf;base64,...), mientras que un navegador
            // real los decodifica a binario. Se aceptan ambas formas y se exige
            // que los bytes decodificados sean un PDF válido (magic %PDF).
            const text = buf.toString('utf8');
            if (text.startsWith('data:application/pdf;base64,')) {
                const b64 = text.slice('data:application/pdf;base64,'.length);
                const decoded = Buffer.from(b64, 'base64');
                expect(decoded.length).toBeGreaterThan(0);
                expect(decoded.subarray(0, 4).toString('latin1')).toBe('%PDF');
            } else {
                expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
            }
        } else {
            // Fallback markdown (pdfkit no disponible): el texto contiene la
            // fuente subida 'sample.txt' (prueba de que el output deriva del input).
            expect(buf.toString('utf8')).toContain('sample.txt');
        }

        // El botón de narración local solo aparece si hay voces del SO
        // (no se asume en este test; se cubre por separado con stub).
        const tts = page.getByTestId('generation-tts');
        expect(await tts.count()).toBeLessThanOrEqual(1);
    });

    test('F1 → F3 — el botón de narración TTS local reproduce el contenido generado', async ({ page }) => {
        await stubLocalSpeech(page);
        await gotoClean(page);
        await uploadAndAnalyze(page);

        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('flu:generate-document'));
        });

        // Con voz local disponible el botón aparece
        await page.waitForSelector('.generation-panel__tts', { timeout: 30000 });
        const tts = page.getByTestId('generation-tts');
        await expect(tts).toContainText('Reproducir narración');

        // Click → reproduce (pasa al estado "detener")
        await tts.click();
        await expect(tts).toContainText('Detener narración');

        // Click de nuevo → detiene y vuelve al estado inicial
        await tts.click();
        await expect(tts).toContainText('Reproducir narración');
    });

    test('F4 (ligero) — generación de video muestra reproductor mp4 o guion degradado', async ({ page }) => {
        test.setTimeout(120000);
        await gotoClean(page);
        await uploadAndAnalyze(page);

        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('flu:generate-video'));
        });

        await page.waitForSelector('.generation-panel__video', { timeout: 90000 });

        const player = page.locator('.generation-panel__video-player');
        const degraded = page.locator('.generation-panel__video-degraded');
        const playerCount = await player.count();
        const degradedCount = await degraded.count();
        expect(playerCount + degradedCount).toBeGreaterThan(0);

        if (playerCount > 0) {
            await expect(player.first()).toBeVisible();
            // El reproductor debe apuntar a un blob generado localmente
            const src = await player.first().getAttribute('src');
            expect(src).toBeTruthy();
        } else {
            await expect(degraded.first()).toBeVisible();
        }

        // El guion siempre está disponible (details)
        await expect(page.locator('.generation-panel__script')).toBeVisible();
        const scriptText = await page.locator('.generation-panel__script-pre').textContent();
        expect(scriptText && scriptText.trim().length > 0).toBeTruthy();
    });
});
