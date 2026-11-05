// Simulación PRODUCTIVA: "ok flu platícame de los aviones con imágenes"
// Recorre el pipeline REAL de la app (contrato → artefacto → generación →
// feed) con el proveedor de imágenes SIMULADO respondiendo OK (sin depender
// de la red), para verificar que explicación + imagen se muestran bien.
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoClean, stubLocalSpeech, captureScreenshot } from './_helpers';

const OUT = path.join(process.cwd(), 'reports', 'validacion-final');
fs.mkdirSync(OUT, { recursive: true });

// PNG válido de 1x1 para simular cualquier imagen del proveedor.
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

test('Platícame de los aviones con imágenes → explicación + imagen visible', async ({ page }: { page: Page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);

    // Proveedor de imágenes simulado OK (pollinations y cualquier URL remota).
    await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.includes('image.pollinations.ai') || url.includes('http')) {
            // Solo intercepta imágenes remotas (PNG), deja el resto pasar.
            if (/\.(png|jpg|jpeg|webp)(\?|$)/i.test(url) || url.includes('pollinations')) {
                route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }).catch(() => {});
                return;
            }
        }
        route.continue().catch(() => {});
    });

    // Contrato REAL esperado para "explica de los aviones con imágenes":
    // respuesta_voz = la explicación + workspace imagen con prompt_visual.
    const reply = await page.evaluate(() =>
        (window as any).__fluOnContractResolved({
            transcript: 'ok flu platícame de los aviones con imágenes',
            contract: {
                respuesta_voz:
                    'Claro. Un avión comercial vuela porque sus alas generan sustentación al empujar el aire hacia abajo. Te muestro una imagen de un avión.',
                workspace: {
                    tipo: 'image_prompt',
                    titulo: 'Avión comercial en vuelo',
                    contenido: 'Avión comercial de pasajeros en pleno vuelo sobre nubes, fotorrealista.',
                    prompt_visual: 'Avión comercial de pasajeros en pleno vuelo sobre nubes, fotorrealista.',
                },
            },
        }).then((r: any) => r || ''),
    );
    await page.waitForTimeout(2500);

    // 1) La explicación debe estar en la conversación (zona IA).
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    expect(bodyText.toLowerCase()).toContain('sustentación');

    // 2) Debe haber una IMAGEN realmente cargada (naturalWidth>0) en el feed.
    let imgLoaded = false;
    for (let i = 0; i < 8; i += 1) {
        imgLoaded = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img')).filter(
                (im) => (im as HTMLImageElement).src && (im as HTMLImageElement).complete,
            );
            return imgs.some((im) => (im as HTMLImageElement).naturalWidth > 0);
        });
        if (imgLoaded) break;
        await page.waitForTimeout(1000);
    }
    expect(imgLoaded, 'debe haber al menos una imagen cargada (proveedor simulado OK)').toBe(true);

    await captureScreenshot(page, OUT, 'aviones-imagen-productivo.png', 500);
    console.log('[SIM] reply:', (reply || '').slice(0, 60));
});
