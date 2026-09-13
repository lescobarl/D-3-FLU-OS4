// ============================================================
// documento-insumo.spec.ts — E2E punto 11
// ------------------------------------------------------------
// Sube un documento soportado y verifica que se analiza y se muestra el panel
// (confirmación visible). El insumo al historial se cubre en el unit test
// tests/documentInsumo.test.ts.
// ============================================================
import { test, expect } from '@playwright/test';
import { gotoClean, stubLocalSpeech } from './_helpers';

test('documento subido → se analiza y muestra el panel', async ({ page }) => {
    test.setTimeout(120000);
    stubLocalSpeech(page);
    await gotoClean(page);

    const input = page.locator('[data-testid="doc-input"]').first();
    await input.setInputFiles({
        name: 'tarea.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(
            'Tarea de matematicas: resolver 3+4 y 5x2. Entrega el lunes a las 08:00.',
        ),
    });

    const panel = page.locator('[data-testid="document-analysis"]').first();
    await panel.waitFor({ state: 'visible', timeout: 60000 });
    await expect(panel).toBeVisible();
});
