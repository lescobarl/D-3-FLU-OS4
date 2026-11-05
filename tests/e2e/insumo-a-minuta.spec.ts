// ============================================================
// insumo-a-minuta.spec.ts - FLUJO REAL: lo que el usuario CARGA llega a FLU
// ------------------------------------------------------------
// Cierra el hueco medido de documento-insumo.spec.ts: ese spec solo comprueba
// que el panel de analisis APARECE. Aqui se mide la cadena COMPLETA del
// producto, sin mocks del producto:
//   subir archivo -> analisis (parser+IA, IA sustituida EN LA RED)
//   -> INSUMO al conversationHistory (fuente unica que consume la conversacion)
//   -> la peticion de la MINUTA lleva ese insumo (lo que el usuario cargo queda
//      como conversacion de la minuta).
// La IA se sustituye en la red (el motor de texto es OpenAI-compatible y llama
// directo a .../chat/completions), no en el producto: handler, store, borrador,
// snapshot y addMinute corren de verdad. Misma tecnica que minuta-resumen.spec.
// ============================================================
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import {
    gotoClean,
    stubLocalSpeech,
    readStore,
    clearStore,
    seedActiveUser,
    autoSkipOnboarding,
    captureScreenshot,
} from './_helpers';

const OUT = path.join(process.cwd(), 'reports', 'insumo');
fs.mkdirSync(OUT, { recursive: true });

// Contenido de la tarea subida (dibujo de texto plano). "matematicas" es la
// MARCA que debe viajar por toda la cadena (sin acento, para no depender del
// juego de caracteres del buffer).
const TAREA = 'Tarea de matematicas: resolver 3+4 y 5x2. Entrega el lunes a las 08:00.';
const MARCA_TAREA = 'matematicas';
// Para el dibujo (imagen sin texto): la materia que el analisis de vision emite.
const MARCA_DIBUJO = 'Ingles inicial';

/** Formato OS2 que produce el motor de texto (deepseek.generateMinute). */
const MINUTE = {
    titulo: 'Minuta e2e insumo',
    participantes: ['Ana'],
    resumen: 'Se apoyo la tarea cargada por el usuario.',
    acuerdos: ['Revisar la tarea'],
    pendientes: ['Confirmar entrega'],
    siguientes_pasos: ['Enviar el acta'],
    tema_sesion: 'neutral',
};

interface AiRec {
    vision: number;
    doc: number;
    minute: number;
    gen: number;
    minuteBodies: string[];
    docBodies: string[];
    genBodies: string[];
}

/**
 * Sustituye la IA EN LA RED. El motor de texto (default: OpenRouter via el
 * adapter OpenAI-compatible) manda TODO a `.../chat/completions`:
 *   - analisis de documento: texto en el contenido de usuario
 *   - vision (imagen): contenido de usuario en formato multimodal (array)
 *   - minuta/resumen: el contenido de usuario pide "a minute"/"minuta"
 * Se discrimina por la forma del cuerpo, no por URL (es la misma).
 */
async function stubAi(
    page: Page,
    opts: { doc: unknown; vision: unknown; minute: unknown; gen?: string },
): Promise<AiRec> {
    const rec: AiRec = { vision: 0, doc: 0, minute: 0, gen: 0, minuteBodies: [], docBodies: [], genBodies: [] };
    // ORDEN IMPORTANTE: Playwright resuelve por la ULTIMA ruta registrada que
    // casa, asi que el comodin de /api/gemini/** va PRIMERO y la ruta especifica
    // de vision DESPUES (si no, el comodin se lleva el vision y devuelve el
    // payload equivocado). El resto del proxy (texto/contrato) solo se usa si el
    // proveedor activo fuese Gemini nativo.
    await page.route('**/api/gemini/**', (route) => {
        const url = route.request().url();
        const payload = /minute|minuta/.test(url) ? opts.minute : opts.doc;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.route('**/api/gemini/vision', (route) => {
        rec.vision += 1;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.vision) });
    });
    await page.route('**/chat/completions', (route) => {
        const raw = route.request().postData() || '';
        let body: any = {};
        try {
            body = JSON.parse(raw);
        } catch {
            /* cuerpo no-JSON: se trata como documento */
        }
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        const userContent = msgs[1]?.content;
        const userStr = String(userContent || '');
        let content: string;
        if (Array.isArray(userContent)) {
            rec.vision += 1;
            content = JSON.stringify(opts.vision);
        } else if (/Genera el contenido para un documento/i.test(userStr)) {
            // Generacion F3/F4 (carta/documento/video): el motor espera TEXTO crudo
            // (formatAdapters solo lo serializa), no un JSON del contrato.
            rec.gen += 1;
            rec.genBodies.push(raw);
            content = opts.gen ?? '';
        } else if (/minute|minuta/i.test(userStr)) {
            rec.minute += 1;
            rec.minuteBodies.push(raw);
            content = JSON.stringify(opts.minute);
        } else {
            rec.doc += 1;
            rec.docBodies.push(raw);
            content = JSON.stringify(opts.doc);
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ message: { content } }] }),
        });
    });
    return rec;
}

/** Lee el historial de conversacion de la app (fuente unica de la sesion). */
async function historyRows(page: Page): Promise<Array<{ role: string; speaker: string; text: string }>> {
    return page.evaluate(() => {
        const rows = (window as any).__fluStore?.getState?.().conversationHistory || [];
        return rows.map((r: any) => ({
            role: String(r.role || ''),
            speaker: String(r.speakerName || ''),
            text: String(r.text || ''),
        }));
    });
}

/** Genera el resumen y guarda la minuta por la VIA REAL de voz (arbitro+dispatch). */
async function generarYGuardarMinuta(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const hook = () => (window as any).__fluOnContractResolved;
        const fn1 = hook();
        if (typeof fn1 !== 'function') throw new Error('__fluOnContractResolved no disponible');
        await fn1({
            contract: { navegacion: { comando: 'GENERAR_RESUMEN' } },
            transcript: 'ok flu genera el resumen',
        });
        await wait(2500);
        const fn2 = hook();
        if (typeof fn2 !== 'function') throw new Error('__fluOnContractResolved ausente tras el resumen');
        await fn2({
            contract: { navegacion: { comando: 'GUARDAR_MINUTA' } },
            transcript: 'ok flu guarda la minuta',
        });
        await wait(2500);
    });
}

test.beforeEach(async ({ page }) => {
    await autoSkipOnboarding(page);
});

test.describe('Lo que el usuario carga entra en FLU y en la minuta (flujo real)', () => {
    test.describe.configure({ mode: 'serial' });

    test('una TAREA subida entra al historial y viaja a la minuta', async ({ page }) => {
        test.setTimeout(150000);
        stubLocalSpeech(page);
        await gotoClean(page);
        await seedActiveUser(page);
        await clearStore(page, 'minutes');
        const rec = await stubAi(page, {
            doc: { resumen: 'Analisis de la tarea de matematicas', puntos_clave: ['3+4', '5x2'], escenarios: [] },
            vision: { materia: MARCA_DIBUJO, problemas: [], instrucciones: '', nivel: 'inicial', texto_extraido: '' },
            minute: MINUTE,
        });

        // 1) Subir un documento soportado (la tarea) por el input real.
        const input = page.locator('[data-testid="doc-input"]').first();
        await input.setInputFiles({ name: 'tarea.txt', mimeType: 'text/plain', buffer: Buffer.from(TAREA) });
        await page.locator('[data-testid="document-analysis"]').first().waitFor({ state: 'visible', timeout: 60000 });

        // 2) El INSUMO entra al historial (fuente unica que consume la conversacion).
        await expect
            .poll(async () => (await historyRows(page)).some((r) => r.role === 'system' && r.text.includes(MARCA_TAREA)), {
                message: 'el insumo del documento debe entrar al conversationHistory',
                timeout: 30000,
            })
            .toBe(true);
        const conInsumo = (await historyRows(page)).find((r) => r.role === 'system' && r.text.includes(MARCA_TAREA));
        console.log('[SIM] insumo en historial:', (conInsumo?.text || '').slice(0, 120));

        // Un turno de usuario (la conversacion que da sentido a la tarea).
        await page.evaluate(() => {
            (window as any).__fluStore.getState().addConversationEntry({
                id: 'insumo-e2e-user',
                speakerName: 'Ana',
                text: 'apoyame con la tarea de matematicas',
                timestamp: Date.now(),
            });
        });

        // 3) Generar y guardar la minuta por la via real.
        await generarYGuardarMinuta(page);

        // 4) La PETICION de la minuta llevo el insumo: lo que el usuario cargo
        //    queda como conversacion de la minuta (el objeto del encargo).
        expect(rec.minute, 'la minuta debe pedir la IA (stub de /chat/completions)').toBeGreaterThan(0);
        expect(
            rec.minuteBodies.some((b) => b.includes(MARCA_TAREA)),
            'la peticion de la minuta debe incluir el insumo del documento cargado',
        ).toBe(true);

        // 5) La minuta queda PERSISTIDA en la tienda Dexie `minutes`.
        const rows = await readStore(page, 'minutes');
        expect(rows.length, 'debe persistir la minuta en `minutes`').toBeGreaterThan(0);

        await captureScreenshot(page, OUT, 'tarea-a-minuta.png', 500);
    });

    test('un DIBUJO sin texto entra como contexto (FLU puede continuar)', async ({ page }) => {
        test.setTimeout(150000);
        // Un crash de render debe verse como tal, no como "el insumo no llego".
        const pageErrors: string[] = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));
        stubLocalSpeech(page);
        await gotoClean(page);
        await seedActiveUser(page);
        const rec = await stubAi(page, {
            doc: { resumen: 'doc', puntos_clave: [], escenarios: [] },
            vision: { materia: MARCA_DIBUJO, problemas: ['colorear'], instrucciones: 'pinta el dibujo y nombra los colores', nivel: 'inicial', texto_extraido: '' },
            minute: MINUTE,
        });

        // Imagen por el input real (sin data-testid propio: se localiza por accept).
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
        );
        await page.locator('input[accept="image/*"]').first().setInputFiles({ name: 'dibujo.png', mimeType: 'image/png', buffer: png });

        // El analisis de vision se pidio (si no, la prueba no cubre el flujo).
        await expect.poll(() => rec.vision, { message: 'la vision debe pedirse', timeout: 30000 }).toBeGreaterThan(0);

        // El contexto del dibujo (SIN texto_extraido) entra al historial: es el
        // hueco que cierra buildImageInsumo (P8.78).
        await expect
            .poll(async () => (await historyRows(page)).some((r) => r.role === 'system' && r.text.includes(MARCA_DIBUJO)), {
                message: 'un dibujo sin texto debe dejar contexto en el historial',
                timeout: 30000,
            })
            .toBe(true);
        const row = (await historyRows(page)).find((r) => r.role === 'system' && r.text.includes(MARCA_DIBUJO));
        console.log('[SIM] contexto de dibujo:', (row?.text || '').slice(0, 160));

        await captureScreenshot(page, OUT, 'dibujo-contexto.png', 500);
        expect(pageErrors, 'el flujo de imagen no debe romper el render').toEqual([]);
    });

    // El ejemplo exacto del dueno: "si cargan un dibujo para tutoria en INGLES
    // pueda continuar con la explicacion en ingles". El contexto del insumo es
    // language-aware: con la app en EN, la etiqueta del contexto tambien es EN,
    // que es lo que FLU recibe en el historial para responder en ese idioma.
    test('un DIBUJO con la app en INGLES deja el contexto en INGLES', async ({ page }) => {
        test.setTimeout(150000);
        stubLocalSpeech(page);
        await gotoClean(page);
        await seedActiveUser(page);

        // Cambia el idioma por el UNICO selector de la cabecera (aria-label="Idioma").
        await page.locator('select[aria-label="Idioma"]').first().selectOption('en');

        const rec = await stubAi(page, {
            doc: { resumen: 'doc', puntos_clave: [], escenarios: [] },
            vision: { materia: 'English initial', problemas: [], instrucciones: 'name the colors', nivel: 'initial', texto_extraido: '' },
            minute: MINUTE,
        });

        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
        );
        await page.locator('input[accept="image/*"]').first().setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: png });

        await expect.poll(() => rec.vision, { message: 'la vision debe pedirse', timeout: 30000 }).toBeGreaterThan(0);

        // La etiqueta EN del insumo (uiStrings: contexto_de_imagen_subida_por_el_usua.en).
        await expect
            .poll(
                async () =>
                    (await historyRows(page)).some(
                        (r) => r.role === 'system' && /image context uploaded by user/i.test(r.text),
                    ),
                { message: 'con la app en EN el contexto del dibujo debe ir en INGLES', timeout: 30000 },
            )
            .toBe(true);
        const row = (await historyRows(page)).find((r) => r.role === 'system' && /image context uploaded by user/i.test(r.text));
        console.log('[SIM] contexto de dibujo (EN):', (row?.text || '').slice(0, 160));

        await captureScreenshot(page, OUT, 'dibujo-contexto-en.png', 500);
    });

    // El artefacto GENERADO (carta/documento) tambien es informacion para FLU:
    // su cuerpo entra al historial de conversacion (P8.82), simetrico a lo CARGADO.
    test('una CARTA generada por FLU entra al historial (FLU puede explicarla)', async ({ page }) => {
        test.setTimeout(150000);
        stubLocalSpeech(page);
        await gotoClean(page);
        await seedActiveUser(page);
        const rec = await stubAi(page, {
            doc: { resumen: 'doc', puntos_clave: [], escenarios: [] },
            vision: { materia: 'x', problemas: [], instrucciones: '', nivel: '', texto_extraido: '' },
            minute: MINUTE,
            gen: 'Querida familia: les escribo desde el viaje. CARTA_GENERADA_E2E',
        });

        // RUTA REAL de generacion: el contrato pide un documento (workspace.tipo='doc')
        // y App lo genera por requestMediaRef (unica puerta). La IA se sustituye en
        // la red; el resto del pipeline (generateDocument -> serializa -> insumo) corre.
        await page.evaluate(async () => {
            const hook = (window as any).__fluOnContractResolved;
            if (typeof hook !== 'function') throw new Error('__fluOnContractResolved no disponible');
            await hook({
                transcript: 'ok flu escribeme una carta para la familia',
                contract: {
                    respuesta_voz: 'Preparando la carta.',
                    workspace: {
                        tipo: 'doc',
                        titulo: 'Carta a la familia',
                        contenido: 'Querida familia, les escribo desde el viaje.',
                    },
                },
            });
        });

        expect(rec.gen, 'la generacion debe pedir la IA (stub de /chat/completions)').toBeGreaterThan(0);

        // El cuerpo GENERADO de la carta entra al historial (fuente unica de la sesion).
        await expect
            .poll(async () => (await historyRows(page)).some((r) => r.role === 'system' && r.text.includes('CARTA_GENERADA_E2E')), {
                message: 'el cuerpo generado por FLU debe entrar al conversationHistory',
                timeout: 45000,
            })
            .toBe(true);
        const row = (await historyRows(page)).find((r) => r.role === 'system' && r.text.includes('CARTA_GENERADA_E2E'));
        console.log('[SIM] insumo generado:', (row?.text || '').slice(0, 160));

        await captureScreenshot(page, OUT, 'carta-generada-insumo.png', 500);
    });
});
