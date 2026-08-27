// ============================================================
// validate-proxy-stability.spec.ts
// Validación RUNTIME del Bug C: el proxy de IA nunca debe tumbar
// el servidor de Vite ante peticiones inválidas ni sockets cerrados.
//
// El crash reportado por el usuario mostraba:
//   POST /api/gemini/contract → "Failed to fetch"
//   (una unhandled rejection en el proxy derribaba Vite → ERR_CONNECTION_REFUSED)
//
// Qué valida este test (contra el servidor real, port 5175):
//   1. RÁFAGA de peticiones inválidas (body vacío / JSON roto / null) a TODOS
//      los endpoints del proxy → cada una DEBE completarse con un status HTTP
//      real (>= 400), nunca un fallo de conexión. Si el servidor se cayera, la
//      petición fallaría con "connection refused".
//   2. SOCKET CERRADO: el cliente aborta fetch() a mitad de petición (simula
//      navegación/recarga mientras la IA responde). El proxy debe soportar el
//      write sobre socket destruido SIN lanzar una unhandled rejection.
//   3. SALUD POST-ESTRÉS: GET / → HTTP 200 (el servidor sigue vivo).
//   4. La app carga sin errores de página tras el estrés del proxy.
// ============================================================
import { test, expect } from '@playwright/test';

const PROXY_ROUTES = [
    '/api/gemini/contract',
    '/api/gemini/summary',
    '/api/gemini/participant-eval',
    '/api/gemini/vision',
    '/api/gemini/text',
    '/api/workspace-image',
];

test('Bug C: el proxy de IA nunca tumba el servidor ante peticiones inválidas o sockets cerrados', async ({ page, request }) => {
    test.setTimeout(150000);

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
        pageErrors.push(err.message);
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // 1. Ráfaga de peticiones inválidas
    // ========================================
    const payloads = [
        { label: 'body vacío', data: '' },
        { label: 'JSON roto', data: '{ esto no es json valido' },
        { label: 'null literal', data: 'null' },
    ];

    const statuses: Array<{ route: string; label: string; status: number }> = [];
    for (const route of PROXY_ROUTES) {
        for (const p of payloads) {
            const resp = await request.post(route, {
                data: p.data,
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000,
            });
            const status = resp.status();
            statuses.push({ route, label: p.label, status });
            console.log(`[PROXY-STABILITY] POST ${route} (${p.label}) → HTTP ${status}`);

            // Una petición que "no responde" significa que el servidor se cayó.
            // Cualquier status HTTP (400/500...) prueba que el proceso sigue vivo.
            expect(
                status,
                `POST ${route} (${p.label}) debe completarse con un status HTTP real (el servidor no debe caerse)`
            ).toBeGreaterThan(0);
        }
    }

    // ========================================
    // 2. Sockets cerrados (cliente aborta a mitad de petición)
    // ========================================
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.evaluate(async () => {
        const abortRoutes = ['/api/gemini/contract', '/api/gemini/summary', '/api/gemini/vision', '/api/gemini/text'];
        for (const route of abortRoutes) {
            const controller = new AbortController();
            fetch(route, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: 'hola flu, aborta esta peticion', language: 'es' }),
                signal: controller.signal,
            }).catch(() => { /* esperado: abort del cliente */ });
            // Abortar ~30ms después de iniciar: el socket se cierra mientras el
            // handler del proxy aún procesa → sendJson escribe sobre socket destruido.
            setTimeout(() => controller.abort(), 30);
        }
    });

    // Dar tiempo al servidor para procesar los cierres de socket
    await page.waitForTimeout(800);

    // ========================================
    // 3. Salud post-estrés: el servidor sigue vivo
    // ========================================
    const health = await request.get('/');
    const healthStatus = health.status();
    console.log(`[PROXY-STABILITY] GET / (post-estrés) → HTTP ${healthStatus}`);
    expect(healthStatus, 'El servidor debe seguir vivo (GET / → 200) tras la ráfaga de peticiones inválidas').toBe(200);

    // ========================================
    // 4. La app carga sin errores de página
    // ========================================
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    expect(
        pageErrors,
        `No debe haber errores de página al cargar la app tras el estrés del proxy. Errores: ${pageErrors.join(' | ')}`
    ).toEqual([]);

    // ========================================
    // Resumen
    // ========================================
    const erroresEsperados = statuses.filter((s) => s.status >= 400).length;
    console.log(
        `[PROXY-STABILITY] ✅ Peticiones inválidas enviadas: ${statuses.length}` +
            ` (todas respondieron con status HTTP, ${erroresEsperados} con error controlado).` +
            ` Servidor vivo al final: SI.`
    );
});
