/**
 * contractMissingTranscriptGuard — el proxy `/api/gemini/contract` NUNCA genera
 * una respuesta del modelo sin transcript.
 *
 * Defecto medido (bug reportado por el dueño, 2026-10-02): con el cuerpo perdido
 * (petición sin body, `null` o sin `transcript`) el proxy respondía **200** y el
 * modelo contestaba un **saludo** («Soy FLU, tu asistente de voz. ¿En qué puedo
 * ayudarte hoy?»), que FLU hablaba como si fuera la respuesta a la pregunta real
 * («Okay Flow Platícame de los aviones»). Su hermano `/api/gemini/text` ya
 * rechaza el campo ausente con 400 `missing_prompt`; el contrato no tenía puerta.
 *
 * El guard pregunta DOS cosas (0.12):
 *   1) CONDUCTA (servidor HTTP real, ruta real): POST sin transcript → 400
 *      `missing_transcript` y NO se llega al modelo.
 *   2) ANTI-VACUIDAD: con transcript la puerta NO lo rechaza — un detector que
 *      rechazara todo pasaría la primera pregunta sin valer nada.
 *
 * PRUEBA DE DETECTOR (0.24): el clasificador marca la respuesta que producía el
 * defecto (200 + saludo) y no marca la respuesta correcta (400 missing_transcript).
 */
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGeminiMiddleware } from '../src/server/geminiProxy';
import type { MiddlewareHost, ProxyMiddlewareHandler } from '../src/server/httpJson';

/** Cuerpos que NO llevan transcript: el defecto medido (body ausente / vacío / sin campo). */
const BODIES_WITHOUT_TRANSCRIPT: readonly string[] = Object.freeze([
    '',
    'null',
    '{}',
    JSON.stringify({ intent: {}, speaker: 'Hablante 1', phase: 'SESION_ACTIVA' }),
    JSON.stringify({ transcript: '   ' }),
]);

/**
 * Clasificador falsable de la respuesta del proxy al defecto medido.
 * @param status Código HTTP devuelto por el proxy.
 * @param payload Cuerpo JSON parseado (o null).
 * @returns true SOLO si el proxy rechazó por transcript ausente.
 */
export function isMissingTranscriptRejected(status: number, payload: unknown): boolean {
    const body = (payload || {}) as Record<string, unknown>;
    return Number(status) === 400 && body.error === 'missing_transcript';
}

/** Monta el proxy real y devuelve una función que hace POST al endpoint. */
async function withContractProxy(): Promise<{
    post: (body: string, path?: string) => Promise<{ status: number; json: unknown }>;
    close: () => Promise<void>;
}> {
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
        Promise.resolve(
            handler(req, res, () => {
                res.statusCode = 404;
                res.end('sin ruta');
            }),
        ).catch(() => {
            res.statusCode = 500;
            res.end('fallo');
        });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;

    return {
        async post(body: string, path = '/api/gemini/contract') {
            const res = await fetch(`http://127.0.0.1:${port}${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
            });
            let json: unknown = null;
            try {
                json = await res.json();
            } catch {
                json = null;
            }
            return { status: res.status, json };
        },
        close: () => new Promise<void>((done) => server.close(() => done())),
    };
}

describe('contractMissingTranscriptGuard — la puerta del transcript en /api/gemini/contract', () => {
    it('PRUEBA DE DETECTOR: el detector marca el defecto (200 + saludo) y no la respuesta correcta', () => {
        expect(isMissingTranscriptRejected(200, { contract: { respuesta_voz: 'Soy FLU, tu asistente de voz. ¿En qué puedo ayudarte hoy?' } })).toBe(false);
        expect(isMissingTranscriptRejected(400, { error: 'missing_transcript', detail: 'x' })).toBe(true);
        expect(isMissingTranscriptRejected(400, { error: 'otro' })).toBe(false);
    });

    it('un cuerpo sin transcript se rechaza con 400 missing_transcript (no se llega al modelo)', async () => {
        const proxy = await withContractProxy();
        try {
            const offenders: string[] = [];
            for (const body of BODIES_WITHOUT_TRANSCRIPT) {
                const { status, json } = await proxy.post(body);
                if (!isMissingTranscriptRejected(status, json)) {
                    offenders.push(`body=${JSON.stringify(body).slice(0, 40)} → status=${status} body=${JSON.stringify(json).slice(0, 120)}`);
                }
            }
            expect(offenders, `El proxy generó respuesta sin transcript:\n  ${offenders.join('\n  ')}`).toEqual([]);
        } finally {
            await proxy.close();
        }
    });

    it('ANTI-VACUIDAD: con transcript la puerta NO rechaza (no vale rechazar todo)', async () => {
        const proxy = await withContractProxy();
        try {
            const { status, json } = await proxy.post(
                JSON.stringify({ transcript: 'Platícame de los aviones', language: 'es', phase: 'SESION_ACTIVA' }),
            );
            expect(isMissingTranscriptRejected(status, json), `La puerta rechazó un turno CON transcript: status=${status}`).toBe(false);
        } finally {
            await proxy.close();
        }
    });
});
