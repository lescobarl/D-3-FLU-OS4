/**
 * serverResponseSingleOwnerGuard — UN solo escritor de respuesta JSON en los proxies.
 *
 * Defecto medido (auditoria de codigo, 2026-10-02): `src/server/geminiProxy.ts`
 * reimplementaba el `sendJson` de `src/server/httpJson.ts` (mismo try +
 * writableEnded/destroyed + writeHead/end + log del error) y ADEMAS escribia
 * `res.writeHead(...)` a mano en 7 sitios mas. La copia no declaraba `charset`:
 * respondia `Content-Type: application/json` mientras el dueno unico responde
 * `application/json; charset=utf-8`, y en 3 sinks diagnosticos el `writeHead`
 * iba FUERA de try (un socket cerrado tumbaba el dev server).
 *
 * El guard pregunta DOS cosas (0.12):
 *   1) TEXTO: cuantas definiciones de `sendJson` hay en src/server (debe ser 1) y
 *      cuantos `writeHead` con JSON quedan a mano (deben ser 0).
 *   2) COMPORTAMIENTO: el proxy de gemini responde de verdad por el escritor
 *      compartido (un servidor HTTP real contesta 400 missing_prompt con UTF-8),
 *      que es la propiedad que el defecto rompia. NO repite la conducta de
 *      `sendJson` (ya cubierta en tests/httpJson.test.ts).
 *
 * Prueba de DETECTOR real (0.24): se alimenta el infractor (la copia y el
 * writeHead a mano) y se comprueba que el detector lo marca; si el guard
 * siguiera verde seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGeminiMiddleware } from '../src/server/geminiProxy';
import type { MiddlewareHost, ProxyMiddlewareHandler } from '../src/server/httpJson';

export interface ServerSource {
    file: string;
    source: string;
}

/** Definiciones de `function sendJson` en las fuentes dadas. */
export function findSendJsonDefs(sources: ReadonlyArray<ServerSource>): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            if (/function\s+sendJson\s*[(<]/.test(line)) hits.push(`${file}:${index + 1}`);
        });
    }
    return hits;
}

/** `writeHead` con Content-Type JSON escrito a mano (el escritor compartido no lo necesita). */
export function findRawJsonWriteHeads(sources: ReadonlyArray<ServerSource>): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            if (line.includes('writeHead(') && line.includes('application/json')) {
                hits.push(`${file}:${index + 1}: ${line.trim()}`);
            }
        });
    }
    return hits;
}

/** Infracciones del invariante, listadas como `archivo:linea`. */
export function findServerResponseOffenders(sources: ReadonlyArray<ServerSource>): string[] {
    const defs = findSendJsonDefs(sources);
    const raw = findRawJsonWriteHeads(sources);
    const bad: string[] = [];
    if (defs.length !== 1) bad.push(`sendJson definido ${defs.length} veces (debe ser 1): ${defs.join(', ') || '(ninguna)'}`);
    bad.push(...raw.map((site) => `writeHead JSON a mano: ${site}`));
    return bad;
}

function serverSources(): ServerSource[] {
    const dir = join(process.cwd(), 'src/server');
    return readdirSync(dir)
        .filter((name) => /\.(ts|js)$/.test(name))
        .map((name) => ({ file: `src/server/${name}`, source: readFileSync(join(dir, name), 'utf8') }));
}

describe('serverResponseSingleOwnerGuard — un escritor JSON en src/server', () => {
    it('sendJson tiene un solo dueno y no quedan writeHead JSON a mano', () => {
        const bad = findServerResponseOffenders(serverSources());
        expect(bad, `Escritores de respuesta duplicados:\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: la copia y el writeHead a mano se marcan', () => {
        const synthetic: ServerSource[] = [
            { file: 'src/server/httpJson.ts', source: 'export function sendJson(res, s, d, l) {\n  res.writeHead(s, { \'Content-Type\': \'application/json; charset=utf-8\' });\n}' },
            { file: 'src/server/otro.ts', source: 'function sendJson(res, s, d) {\n  res.writeHead(s, { \'Content-Type\': \'application/json\' });\n}' },
        ];
        const bad = findServerResponseOffenders(synthetic);
        expect(bad.join('\n')).toContain('sendJson definido 2 veces');
        expect(bad.join('\n')).toContain('writeHead JSON a mano');
    });

    it('PRUEBA DE DETECTOR: la ausencia del escritor tambien se marca (anti-vacuidad)', () => {
        const vacio: ServerSource[] = [{ file: 'src/server/a.ts', source: 'export const x = 1;' }];
        expect(findServerResponseOffenders(vacio).join('\n')).toContain('sendJson definido 0 veces');
    });

    it('el codigo limpio no se marca', () => {
        const clean: ServerSource[] = [
            { file: 'src/server/httpJson.ts', source: 'export function sendJson(res, s, d, l) {\n  res.writeHead(s, { \'Content-Type\': CT });\n}' },
            { file: 'src/server/otro.ts', source: "import { sendJson } from './httpJson';\nsendJson(res, 200, { ok: true }, 'x');" },
        ];
        expect(findServerResponseOffenders(clean)).toEqual([]);
    });
});

describe('serverResponseSingleOwnerGuard — CONDUCTA del proxy real', () => {
    it('el proxy de gemini responde por el escritor compartido (UTF-8) y no lanza con socket cerrado', async () => {
        const routes = new Map<string, ProxyMiddlewareHandler>();
        const host: MiddlewareHost = {
            middlewares: {
                use(path: string, handler: ProxyMiddlewareHandler) {
                    routes.set(path, handler);
                },
            },
        };
        const plugin = createGeminiMiddleware({ env: {} }) as unknown as { configureServer(server: MiddlewareHost): void };
        plugin.configureServer(host);

        const handler = routes.get('/api/gemini/text');
        expect(handler, 'el proxy debe montar /api/gemini/text').toBeTruthy();

        const server = http.createServer((req, res) => {
            Promise.resolve(handler!(req, res, () => {
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
            const res = await fetch(`http://127.0.0.1:${port}/api/gemini/text`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            // La propiedad que rompia la copia: el Content-Type del dueno unico declara UTF-8.
            expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
            expect(await res.json()).toEqual({
                error: 'missing_prompt',
                detail: 'El campo "prompt" es obligatorio.',
            });
        } finally {
            await new Promise<void>((done) => server.close(() => done()));
        }
    });
});
