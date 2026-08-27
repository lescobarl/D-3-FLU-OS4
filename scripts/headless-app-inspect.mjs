// ============================================================
// scripts/headless-app-inspect.mjs — F2 fase dinámica (headless)
// ============================================================
// Recorre la app en modo headless (Playwright + Chromium), captura
// cada pestaña (DOM, entradas, acciones, salidas, consola) y escribe
// un reporte JSON con la forma de `appAnalysisContract`:
//   { proyecto, framework, pantallas[], flujos[], errores_detectados[] }
//
// Uso:
//   npm run dev            (o cualquier servidor)
//   node scripts/headless-app-inspect.mjs
//   HEADLESS_APP_URL=http://localhost:5175 node scripts/headless-app-inspect.mjs
//
// Salida (NO usa test-results/ porque Playwright lo limpia en cada corrida):
//   reports/headless/report.json
//   reports/headless/screens/<tab>.png
// ============================================================

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'reports', 'headless');
const SCREENS_DIR = resolve(OUT_DIR, 'screens');

const APP_URL = process.env.HEADLESS_APP_URL || 'http://localhost:5175';
const TIMEOUT = 60000;

// Clases conocidas de "salidas" (resultados renderizados por la app).
const OUTPUT_SELECTORS = [
    '.document-analysis__detail',
    '.homework-analysis__detail',
    '.document-analysis__title',
    '.app-analysis__summary',
    '.generation-panel__result',
    '.generation-panel__video',
    '.frame-content__response',
    '.frame-content__contenido',
    '.frame-content__list',
    '.conversation-log',
    '.minute-draft',
    '.minute-history',
    '.flu-settings-panel',
    '.flu-shell__hero',
];

/**
 * Describe una pantalla (pestaña) a partir del DOM vivo.
 * Entradas = inputs/selects/textareas; acciones = botones/enlaces;
 * salidas = elementos con clases de resultado conocidas.
 */
async function describeScreen(page, tab) {
    return page.evaluate(({ tabId, tabLabel, outputSelectors }) => {
        const panel = document.getElementById(`flu-tabpanel-${tabId}`);
        const scope = panel || document;

        const readText = (el) => {
            const t = (el.getAttribute('aria-label') || '')
                || (el.getAttribute('placeholder') || '')
                || (el.getAttribute('name') || '')
                || (el.getAttribute('data-testid') || '')
                || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
            return t || el.tagName.toLowerCase();
        };

        const entradas = Array.from(
            scope.querySelectorAll('input, select, textarea'),
        )
            .map(readText)
            .filter(Boolean);

        const acciones = Array.from(
            scope.querySelectorAll('button, a[role="button"], [role="tab"], summary'),
        )
            .map(readText)
            .filter(Boolean);

        const salidas = outputSelectors
            .map((sel) => scope.querySelector(sel))
            .filter(Boolean)
            .map((el) => {
                const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
                return `${el.className?.split(' ')[0] || el.tagName}: ${txt}`;
            });

        const heading = scope.querySelector('h1, h2, h3, .panel-frame__title');
        const proposito = heading
            ? (heading.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)
            : tabLabel;

        return {
            id: tabId,
            nombre: tabLabel,
            proposito,
            entradas: [...new Set(entradas)],
            acciones: [...new Set(acciones)],
            salidas: [...new Set(salidas)],
        };
    }, { tabId: tab.id, tabLabel: tab.label, outputSelectors: OUTPUT_SELECTORS });
}

async function main() {
    console.log(`[headless-app-inspect] Abriendo ${APP_URL} (headless)...`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1360, height: 900 },
        locale: 'es-MX',
    });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    try {
        await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
        await page.waitForSelector('[role="tablist"]', { timeout: TIMEOUT });
    } catch (err) {
        console.error(`[headless-app-inspect] No se pudo abrir la app: ${err.message}`);
        await browser.close();
        process.exit(1);
    }

    await page.waitForTimeout(2500);

    const proyecto = await page.title();
    const framework = 'react';

    // Pestañas detectadas en vivo (sin hardcode de ids/labels).
    const tabs = await page.evaluate(() => {
        const tabLabel = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ') || el.id;
        return Array.from(document.querySelectorAll('[role="tab"]'))
            .map((el) => ({ id: el.id.replace('flu-tab-', ''), label: tabLabel(el) }))
            .filter((t) => t.id);
    });

    if (tabs.length === 0) {
        console.error('[headless-app-inspect] No se encontraron pestañas [role="tab"].');
        await browser.close();
        process.exit(1);
    }

    mkdirSync(SCREENS_DIR, { recursive: true });

    const pantallas = [];
    const flowPasos = ['Abrir la aplicación'];

    for (const tab of tabs) {
        await page.evaluate((id) => {
            const fn = window.__fluSetActiveTab;
            if (typeof fn === 'function') {
                fn(id);
            } else {
                const el = document.getElementById(`flu-tab-${id}`);
                if (el) el.click();
            }
        }, tab.id);
        await page.waitForTimeout(1200);

        const pantalla = await describeScreen(page, tab);
        pantallas.push(pantalla);
        flowPasos.push(`Navegar a la pestaña «${tab.label}» (${tab.id})`);

        await page.screenshot({ path: resolve(SCREENS_DIR, `${tab.id}.png`), fullPage: false });
        console.log(`  ✓ Pantalla «${tab.label}» (${tab.id}): ${pantalla.acciones.length} acciones, ${pantalla.entradas.length} entradas`);
    }

    // Flujos representativos del recorrido dinámico.
    const flujos = [
        {
            nombre: 'Navegación por pestañas',
            pasos: flowPasos,
        },
        {
            nombre: 'Explorar controles de cada pestaña',
            pasos: pantallas.map(
                (p) => `En «${p.nombre}»: ${p.acciones.length} acciones y ${p.entradas.length} entradas`,
            ),
        },
    ];

    // Filtra ruido esperado (401 de API sin key, etc.) del reporte.
    const errores_detectados = [...new Set(consoleErrors)].filter((e) =>
        !/401|403|Failed to fetch|ERR_CONNECTION|pollinations|gemini/i.test(e),
    );

    const report = {
        proyecto,
        framework,
        pantallas,
        flujos,
        errores_detectados,
        meta: {
            url: APP_URL,
            capturadoEn: new Date().toISOString(),
            totalPantallas: pantallas.length,
            totalErroresConsola: consoleErrors.length,
        },
    };

    const reportPath = resolve(OUT_DIR, 'report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`[headless-app-inspect] Reporte escrito: ${reportPath}`);
    console.log(`[headless-app-inspect] ${pantallas.length} pantallas · ${flujos.length} flujos · ${errores_detectados.length} errores`);

    await browser.close();
}

main().catch((err) => {
    console.error('[headless-app-inspect] Error fatal:', err);
    process.exit(1);
});
