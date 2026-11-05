import { chromium, type FullConfig } from '@playwright/test';

// ============================================================
// _globalSetup - paga UNA vez el arranque en frio del dev server
// ------------------------------------------------------------
// Vite compila la app entera en la PRIMERA carga. Si esa carga la paga el
// primer spec, el presupuesto de espera se agota, el worker muere y el sintoma
// es "did not run" / "Target page has been closed": un fallo de arranque que se
// lee como fallo de producto. Playwright levanta el dev server y DESPUES corre
// el globalSetup, asi que aqui se carga la app una vez y los specs miden limpio.
// ============================================================
export default async function globalSetup(config: FullConfig): Promise<void> {
    const baseURL =
        process.env.FLU_E2E_BASE_URL ||
        config.projects[0]?.use?.baseURL ||
        `http://localhost:${Number(process.env.PORT) || 5173}`;
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
        await page.goto(String(baseURL), { waitUntil: 'load', timeout: 180000 });
        // El shell (o el alta) es lo ultimo: cuando aparece, la compilacion termino.
        await page
            .waitForSelector('.flu-shell, [data-testid="onboarding-input"]', { timeout: 180000 })
            .catch(() => undefined);
    } finally {
        await browser.close();
    }
}
