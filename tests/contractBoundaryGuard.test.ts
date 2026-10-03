/**
 * contractBoundaryGuard ??" el borde del contrato no pierde entradas NI sirve la
 * respuesta de otro contexto.
 *
 * Defecto medido (auditoria 2026-10-03, POST reales al dev server vivo):
 *
 *   I1 ??" ENTRADAS PERDIDAS. `handleContractMode` (`src/server/geminiProxy.ts`)
 *   reenviaba 13 de los 22 campos que envia el cliente: se perdian knowledgeBase,
 *   knowledgeBase2, recentMemory, startupPrompt, agendaText, selfKnowledgeText,
 *   diaryContext, notesContext, horarioContext y resultadosContext. Conducta
 *   medida: con `agendaText = "Pendientes de hoy: 1) regar las plantas 2) llamar
 *   a Marta"` el modelo respondio ?"No tengo ningun recordatorio programado para
 *   hoy?" -> el bloque nunca llego al prompt. Muertos por el borde: el radar de
 *   contexto (bloques 6-9 = Paso 5), la personalidad del perfil (startupPrompt),
 *   el bloque de emocion (recentMemory), el autoconocimiento y la KB/minutas.
 *
 *   I2 ??" COLISION DE CACHE. `buildContractCacheKey` no cubria role, theme, phase
 *   ni ninguno de esos 10 campos. Conducta medida: el MISMO transcript con
 *   `role=Medico` y despues con `role=Chef` devolvio respuestas byte-identicas
 *   (la segunda se sirvio de cache). En 30 s de TTL, una frase corta repetida
 *   (?"si?", ?"ok?", ?"otra vez?") devolvia la voz de otro contexto.
 *
 * El guard mide CONDUCTA sobre el middleware REAL (HTTP, sin red): conduce el
 * proxy, intercepta su unica frontera de salida (`globalThis.fetch`) y lee el
 * prompt que recibe el modelo y cuantas veces se le llamo.
 *
 * PRUEBA DE DETECTOR (0.24): el predicado de marcas y el de sensibilidad de la
 * clave se alimentan con casos infractores sinteticos y se comprueba que marcan.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGeminiMiddleware } from '../src/server/geminiProxy';
import type { MiddlewareHost, ProxyMiddlewareHandler } from '../src/server/httpJson';

/** Campos del turno que el prompt del contrato debe recibir (los 10 medidos). */
export const PROMPT_INPUT_FIELDS: readonly string[] = Object.freeze([
    'knowledgeBase',
    'knowledgeBase2',
    'recentMemory',
    'startupPrompt',
    'agendaText',
    'selfKnowledgeText',
    'diaryContext',
    'notesContext',
    'horarioContext',
    'resultadosContext',
]);

/**
 * Campos cuya inyeccion es CONDICIONAL al modo de conocimiento: el KB de minutas
 * (`knowledgeBase2`) solo entra al prompt cuando `knowledgeMode === 'minutes'`
 * (en `general` el activo es `knowledgeBase`). El guard los mide en su modo, no
 * los da por buenos ni los exime en silencio.
 */
export const MINUTES_ONLY_FIELDS: readonly string[] = Object.freeze(['knowledgeBase2']);

/** Campos medibles en el modo general (todos menos los condicionales). */
export function generalModeFields(): string[] {
    return PROMPT_INPUT_FIELDS.filter((field) => !MINUTES_ONLY_FIELDS.includes(field));
}

/** Claves del literal `await requestFluContract({ ... })` del motor de voz. */
export function clientPromptKeys(source: string): string[] {
    const call = source.indexOf('await requestFluContract({');
    if (call < 0) return [];
    const block = source.slice(call, source.indexOf('})', call));
    return [
        ...new Set(
            [...block.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,:]/gm)]
                .map((match) => match[1])
                .filter((key) => key !== 'await' && key !== 'return'),
        ),
    ];
}

/**
 * Claves que el borde declara como "entradas del turno" (literal del mapper).
 * @param source Fuente de `src/server/geminiProxy.ts`.
 */
export function mapperKeys(source: string): string[] {
    const start = source.indexOf('function proxyBodyToGenerateParams');
    if (start < 0) return [];
    const block = source.slice(start, source.indexOf('\n}', start));
    return [...new Set([...block.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*body\?\./gm)].map((m) => m[1]))];
}

/** Claves que el cliente envia y el borde NO declara (anti-deriva del contrato). */
export function undeclaredBoundaryKeys(clientKeys: string[], boundaryKeys: string[]): string[] {
    return clientKeys.filter((key) => !boundaryKeys.includes(key));
}

/** Una marca distinta por campo medido (para localizarla en el prompt). */
export function promptMarkers(): Record<string, string> {
    return Object.fromEntries(PROMPT_INPUT_FIELDS.map((field) => [field, `MARCA_${field.toUpperCase()}`]));
}

/** Campos cuyas marcas NO aparecen en el prompt (predicado falsable de I1). */
export function missingMarkers(prompt: string, markers: Record<string, string>): string[] {
    return Object.entries(markers)
        .filter(([, marker]) => !prompt.includes(marker))
        .map(([field, marker]) => `${field}=${marker}`);
}

/**
 * Claves de cache que DOS cuerpos distintos producen.
 * @returns true si los cuerpos comparten clave (colisionarian en la cache).
 */
export function cacheCollides(keyA: string, keyB: string): boolean {
    return keyA === keyB;
}

interface Captured {
    prompts: string[];
}

/**
 * Conduce el proxy real por HTTP con la salida del modelo interceptada.
 * @param body Cuerpo del contrato (se le anade una apiKey ficticia para que el
 *             proxy construya el prompt en vez de responder su fallback).
 */
async function postContractWithCapture(body: Record<string, unknown>): Promise<{
    status: number;
    captured: Captured;
}> {
    const originalFetch = globalThis.fetch;
    const captured: Captured = { prompts: [] };

    globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? '');
        if (url.includes('/chat/completions')) {
            captured.prompts.push(String(init?.body ?? ''));
            const content = JSON.stringify({
                respuesta_voz: 'ok',
                navegacion: { comando: null, destino: null, parametros: {} },
            });
            return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        return originalFetch(input as RequestInfo, init as RequestInit);
    }) as typeof globalThis.fetch;

    const routes = new Map<string, ProxyMiddlewareHandler>();
    const host: MiddlewareHost = {
        middlewares: {
            use(path: string, handler: ProxyMiddlewareHandler) {
                routes.set(path, handler);
            },
        },
    };
    const plugin = createGeminiMiddleware({ env: {} }) as unknown as {
        configureServer(server: MiddlewareHost): void;
    };
    plugin.configureServer(host);
    const handler = routes.get('/api/gemini/contract');
    if (!handler) throw new Error('el proxy debe montar /api/gemini/contract');

    const server = http.createServer((req, res) => {
        Promise.resolve(handler(req, res, () => {
            res.statusCode = 404;
            res.end('sin ruta');
        })).catch(() => {
            res.statusCode = 500;
            res.end('fallo');
        });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;
    try {
        const response = await originalFetch(`http://127.0.0.1:${port}/api/gemini/contract`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: 'test-key', ...body }),
        });
        return { status: response.status, captured };
    } finally {
        globalThis.fetch = originalFetch;
        await new Promise<void>((done) => server.close(() => done()));
    }
}

/** Contador monotono: cada caso usa un transcript propio (sin colisiones cruzadas). */
let caseCounter = 0;
function uniqueTranscript(label: string): string {
    caseCounter += 1;
    return `caso ${label} ${caseCounter} ${Date.now()}`;
}

function baseTurn(transcript: string): Record<string, unknown> {
    return {
        transcript,
        intent: { comando: null, destino: null, parametros: {} },
        speaker: 'Hablante 1',
        theme: 'e2e',
        role: 'Asistente',
        phase: 'SESION_ACTIVA',
        language: 'es',
        history: [],
    };
}

describe('contractBoundaryGuard I1 ??" el contrato no pierde las entradas del turno', () => {
    it('PRUEBA DE DETECTOR: el detector marca un prompt sin marcas y no marca el completo', () => {
        const markers = promptMarkers();
        expect(missingMarkers('Transcripcion limpia: hola', markers)).toHaveLength(PROMPT_INPUT_FIELDS.length);
        expect(missingMarkers(`prompt ${Object.values(markers).join(' ')}`, markers)).toEqual([]);
    });

    it('el motor de voz sigue enviando los campos medidos (anti-vacuidad del origen)', () => {
        const hook = readFileSync(join(process.cwd(), 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8');
        const keys = clientPromptKeys(hook);
        expect(keys.length, 'no se pudo leer la llamada del motor de voz').toBeGreaterThan(15);
        for (const field of PROMPT_INPUT_FIELDS) {
            expect(keys, `el motor dejo de enviar ${field}`).toContain(field);
        }
    });

    it('ANTI-DERIVA: el borde declara TODAS las entradas que el motor envia', () => {
        const hook = readFileSync(join(process.cwd(), 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8');
        const proxy = readFileSync(join(process.cwd(), 'src/server/geminiProxy.ts'), 'utf8');
        const client = clientPromptKeys(hook);
        const boundary = mapperKeys(proxy);
        // Anti-vacuidad: si el parser no lee las dos listas, no hay veredicto valido.
        expect(client.length, 'no se leyo la llamada del motor de voz').toBeGreaterThan(15);
        expect(boundary.length, 'no se leyo la lista del borde').toBeGreaterThan(15);
        const faltan = undeclaredBoundaryKeys(client, boundary);
        expect(
            faltan,
            `Claves que el motor envia y el borde (src/server/geminiProxy.ts) NO declara:\n  ${faltan.join('\n  ')}`,
        ).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: el detector de deriva marca una clave que el borde no declara', () => {
        expect(undeclaredBoundaryKeys(['transcript', 'agendaText'], ['transcript'])).toEqual(['agendaText']);
        expect(undeclaredBoundaryKeys(['transcript'], ['transcript', 'agendaText'])).toEqual([]);
    });

    it('TODAS las entradas del turno (modo general) llegan al prompt que recibe el modelo', async () => {
        const markers = Object.fromEntries(
            generalModeFields().map((field) => [field, `MARCA_${field.toUpperCase()}`]),
        );
        const body: Record<string, unknown> = { ...baseTurn(uniqueTranscript('entradas')) };
        for (const [field, marker] of Object.entries(markers)) body[field] = marker;

        const { status, captured } = await postContractWithCapture(body);

        expect(status, 'el proxy no completo la peticion').toBe(200);
        expect(captured.prompts.length, 'no se intercepto ninguna llamada al modelo').toBeGreaterThan(0);
        const prompt = captured.prompts.join('\n');
        expect(prompt, 'el transcript (campo que SI viaja) no aparece: captura vacia').toContain(
            String(body.transcript),
        );
        const missing = missingMarkers(prompt, markers);
        expect(
            missing,
            `Campos del turno que NO llegan al prompt (src/server/geminiProxy.ts):\n  ${missing.join('\n  ')}`,
        ).toEqual([]);
    });

    it('la KB de MINUTAS (knowledgeBase2) llega al prompt en su modo (minutes)', async () => {
        const markers = Object.fromEntries(
            MINUTES_ONLY_FIELDS.map((field) => [field, `MARCA_${field.toUpperCase()}`]),
        );
        const body: Record<string, unknown> = { ...baseTurn(uniqueTranscript('minutas')), knowledgeMode: 'minutes' };
        for (const [field, marker] of Object.entries(markers)) body[field] = marker;

        const { status, captured } = await postContractWithCapture(body);

        expect(status, 'el proxy no completo la peticion').toBe(200);
        expect(captured.prompts.length, 'no se intercepto ninguna llamada al modelo').toBeGreaterThan(0);
        const missing = missingMarkers(captured.prompts.join('\n'), markers);
        expect(
            missing,
            `Campos condicionales que NO llegan a su prompt (src/server/geminiProxy.ts):\n  ${missing.join('\n  ')}`,
        ).toEqual([]);
    });
});

describe('contractBoundaryGuard I2 ??" la cache no responde por otro contexto', () => {
    it('PRUEBA DE DETECTOR: el predicado de colision marca dos claves iguales con cuerpos distintos', () => {
        expect(cacheCollides('misma', 'misma')).toBe(true);
        expect(cacheCollides('clave-a', 'clave-b')).toBe(false);
    });

    it('ANTI-VACUIDAD: la cache sigue cacheando la MISMA peticion (no se desactiva)', async () => {
        const body = baseTurn(uniqueTranscript('repeat'));
        const first = await postContractWithCapture(body);
        expect(first.captured.prompts.length, 'la primera peticion no llego al modelo').toBe(1);
        const second = await postContractWithCapture(body);
        expect(second.captured.prompts.length, 'la repeticion identica NO se sirvio de cache').toBe(0);
    });

    it('dos turnos que solo difieren en rol/tema NO comparten respuesta', async () => {
        const transcript = uniqueTranscript('contexto');
        const asDoctor = { ...baseTurn(transcript), role: 'Medico de cabecera', theme: 'salud' };
        const asChef = { ...baseTurn(transcript), role: 'Chef de cocina', theme: 'recetas' };

        const first = await postContractWithCapture(asDoctor);
        expect(first.captured.prompts.length, 'la primera peticion no llego al modelo').toBe(1);

        const second = await postContractWithCapture(asChef);
        expect(
            second.captured.prompts.length,
            'COLISION DE CACHE: el turno con otro rol/tema se sirvio de la respuesta anterior (0 llamadas al modelo)',
        ).toBe(1);
        expect(second.captured.prompts[0], 'el prompt no refleja el rol del turno').toContain('Chef de cocina');
    });
});
