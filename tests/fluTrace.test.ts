// @vitest-environment jsdom
/**
 * fluTrace - la traza estructurada de diagnostico (0%).
 *
 * POR QUE ESTE TEST: `fluTrace.js` (253 lineas) es el unico registro de lo que
 * pasa dentro de la voz cuando algo va mal en dev, y nadie lo ejecutaba. Aqui se
 * prueban sus dos aparatos: el RING (que guarda, cuanto guarda y que recorta) y
 * el SANEADO (recortes, listas, nulos), mas el volcado al agente, que va en
 * DIFERIDO y por DELTAS. El modulo se recarga en cada prueba (`vi.resetModules`)
 * porque su estado (encendido, ring, contador enviado) es de modulo.
 *
 * HALLAZGO DECLARADO: con el ring LLENO, el delta que se envia queda VACIO. El
 * contador `sentEventCount` se iguala a la longitud del ring en cada envio, y el
 * ring recortado por delante vuelve a la misma longitud: `sentEventCount > length`
 * nunca se cumple, asi que los eventos nuevos no se reenvian (se pierden en dev).
 * Se documenta con la prueba del ring lleno, sin tocar el producto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localGet, localRemove, localSet } from '../src/core/storage/localStore.js';

const AGENTE_MS = 1_300; // por encima del agentSinkMs por defecto (1200)

type Modulo = typeof import('../src/voice/lib/fluTrace.js');

/** Modulo nuevo por prueba: el estado (ring, encendido, contador) es de modulo. */
const cargar = async (): Promise<Modulo> => {
    vi.resetModules();
    return import('../src/voice/lib/fluTrace.js');
};

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let fetchFalso: ReturnType<typeof vi.fn>;

const cuerpos = () => fetchFalso.mock.calls.map((c) => JSON.parse(String((c[1] as { body: string }).body)));

beforeEach(() => {
    localRemove('flu.trace');
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchFalso = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchFalso);
});

afterEach(() => {
    info.mockRestore();
    warn.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('fluTrace - encendido y freno', () => {
    it('en dev arranca encendida y marca la ventana para el agente', async () => {
        const mod = await cargar();

        expect(mod.initFluTrace()).toBe(true);
        expect((window as unknown as { __FLU_LISTEN_DEBUG?: boolean }).__FLU_LISTEN_DEBUG).toBe(true);
        expect(mod.isFluTraceEnabled()).toBe(true);
        expect(info).toHaveBeenCalled();
    });

    it('el flag de almacen manda: 0 la apaga y 1 la enciende', async () => {
        localSet('flu.trace', '0');
        const mod = await cargar();

        expect(mod.initFluTrace()).toBe(false);
        mod.fluTrace('stream', 'apagada');
        expect(mod.getFluTraceSnapshot().count).toBe(0);

        expect(mod.enableFluTrace()).toBe(true);
        expect(localGet('flu.trace')).toBe('1');
        mod.fluTrace('stream', 'encendida');
        expect(mod.getFluTraceSnapshot().count).toBe(1);

        expect(mod.disableFluTrace()).toBe(false);
        expect(localGet('flu.trace')).toBe('0');
        mod.fluTrace('stream', 'otra');
        expect(mod.getFluTraceSnapshot().count).toBe(1);
    });

    it('apagar NO borra lo ya trazado (solo deja de grabar)', async () => {
        const mod = await cargar();
        mod.initFluTrace();
        mod.fluTrace('log', 'antes');

        mod.disableFluTrace();

        const foto = mod.getFluTraceSnapshot();
        expect(foto.count).toBe(1);
        expect(foto.enabled).toBe(false);
        expect(foto.events[0].event).toBe('antes');
    });
});

describe('fluTrace - lo que guarda cada fila', () => {
    it('la fila lleva marca de tiempo, categoria y evento', async () => {
        const mod = await cargar();
        mod.initFluTrace();

        mod.fluTrace('stream', 'interim', { texto: 'hola' });

        const fila = mod.getFluTraceSnapshot().events[0];
        expect(typeof fila.t).toBe('number');
        expect(String(fila.iso)).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
        expect(fila.category).toBe('stream');
        expect(fila.event).toBe('interim');
        expect(fila.texto).toBe('hola');
    });

    it('los textos se colapsan y se recortan a 200', async () => {
        const mod = await cargar();
        mod.initFluTrace();

        mod.fluTrace('log', 'x', { texto: 'a\n  b   c', largo: 'y'.repeat(300) });

        const fila = mod.getFluTraceSnapshot().events[0];
        expect(fila.texto).toBe('a b c');
        expect(String(fila.largo)).toHaveLength(201);
        expect(String(fila.largo).startsWith('y'.repeat(200))).toBe(true);
    });

    it('la captura tiene mas margen que el resto (400)', async () => {
        const mod = await cargar();
        mod.initFluTrace();

        mod.fluTrace('recognition', 'final', { capture: 'z'.repeat(500) });

        expect(String(mod.getFluTraceSnapshot().events[0].capture)).toHaveLength(401);
    });

    it('los nulos se caen, las listas se cortan a 12 y los objetos pasan tal cual', async () => {
        const mod = await cargar();
        mod.initFluTrace();

        mod.fluTrace('command', 'x', {
            vacio: null,
            indefinido: undefined,
            lista: Array.from({ length: 20 }, (_, i) => i),
            ctx: { profundo: true },
            bandera: false,
        });

        const fila = mod.getFluTraceSnapshot().events[0];
        expect(Object.hasOwn(fila, 'vacio')).toBe(false);
        expect(Object.hasOwn(fila, 'indefinido')).toBe(false);
        expect(fila.lista).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        expect((fila.ctx as { profundo: boolean }).profundo).toBe(true);
        expect(fila.bandera).toBe(false);
    });

    it('sin datos la fila sigue siendo valida', async () => {
        const mod = await cargar();
        mod.initFluTrace();

        mod.fluTrace('skip', 'sin-datos');
        mod.fluTrace('skip', 'con-basura', null as never);

        expect(mod.getFluTraceSnapshot().count).toBe(2);
    });
});

describe('fluTrace - el ring', () => {
    it('guarda los ULTIMOS: recorta por delante al llegar al tope', async () => {
        const mod = await cargar();
        mod.initFluTrace();
        const tope = mod.getFluTraceSnapshot().max;

        for (let i = 0; i < tope + 3; i += 1) mod.fluTrace('stream', `e${i}`);

        const foto = mod.getFluTraceSnapshot();
        expect(tope).toBeGreaterThan(100);
        expect(foto.count).toBe(tope);
        expect(foto.events[0].event).toBe('e3');
        expect(foto.events.at(-1)!.event).toBe(`e${tope + 2}`);
    });

    it('clearFluTrace vacia el ring', async () => {
        const mod = await cargar();
        mod.initFluTrace();
        mod.fluTrace('log', 'a');
        mod.fluTrace('log', 'b');

        mod.clearFluTrace();

        expect(mod.getFluTraceSnapshot().count).toBe(0);
        expect(mod.getFluTraceSnapshot().events).toEqual([]);
    });
});

describe('fluTrace - resumen y sesion', () => {
    it('el resumen cuenta por categoria/evento y ordena de mas a menos', async () => {
        const mod = await cargar();
        mod.initFluTrace();
        mod.fluTrace('stream', 'interim');
        mod.fluTrace('stream', 'final');
        mod.fluTrace('stream', 'interim');
        mod.fluTrace('stream', 'interim');

        const { summary } = mod.getFluTraceSnapshot();

        expect(summary.total).toBe(4);
        expect(summary.top[0]).toBe('stream/interim:3');
        expect(summary.top[1]).toBe('stream/final:1');
    });

    it('el resumen corta a 24 entradas', async () => {
        const mod = await cargar();
        mod.initFluTrace();
        for (let i = 0; i < 30; i += 1) mod.fluTrace('log', `evento-${i}`);

        expect(mod.getFluTraceSnapshot().summary.top).toHaveLength(24);
    });

    it('la sesion la aporta el proveedor y se sanea como el resto', async () => {
        const mod = await cargar();
        mod.initFluTrace();
        mod.setFluTraceSessionProvider(() => ({ texto: 's'.repeat(300), n: 1 }));

        const session = mod.getFluTraceSnapshot().session as Record<string, unknown>;

        expect(session.n).toBe(1);
        expect(String(session.texto)).toHaveLength(201);
    });

    it('sin proveedor la sesion va vacia y soltarlo tambien lo deja vacio', async () => {
        const mod = await cargar();
        mod.initFluTrace();

        expect(mod.getFluTraceSnapshot().session).toEqual({});

        mod.setFluTraceSessionProvider(() => ({ a: 1 }));
        mod.setFluTraceSessionProvider(null as never);
        expect(mod.getFluTraceSnapshot().session).toEqual({});
    });

    it('un proveedor que revienta no rompe el volcado', async () => {
        const mod = await cargar();
        mod.initFluTrace();
        mod.setFluTraceSessionProvider(() => {
            throw new Error('sesion rota');
        });

        expect(mod.getFluTraceSnapshot().session).toEqual({ sessionError: true });
    });

    it('la foto trae tambien la fecha de exportacion y el tope', async () => {
        const mod = await cargar();
        mod.initFluTrace();

        const foto = mod.getFluTraceSnapshot();

        expect(new Date(foto.exportedAt).toString()).not.toBe('Invalid Date');
        expect(foto.max).toBeGreaterThan(0);
    });
});

describe('fluTrace - volcado al agente (diferido y por deltas)', () => {
    it('no envia nada hasta que pasa el intervalo, y entonces manda el delta', async () => {
        vi.useFakeTimers();
        const mod = await cargar();
        mod.initFluTrace();

        mod.fluTrace('stream', 'uno');
        mod.fluTrace('stream', 'dos');
        mod.fluTrace('stream', 'tres');
        expect(fetchFalso).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(AGENTE_MS);

        expect(fetchFalso).toHaveBeenCalledTimes(1);
        const [url, opciones] = fetchFalso.mock.calls[0];
        expect(url).toBe('/__flu_agent_trace');
        expect((opciones as { method: string }).method).toBe('POST');
        const cuerpo = cuerpos()[0];
        expect(cuerpo.delta).toBe(true);
        expect(cuerpo.count).toBe(3);
        expect(cuerpo.events.map((e: { event: string }) => e.event)).toEqual(['uno', 'dos', 'tres']);
    });

    it('varios eventos seguidos comparten un unico envio', async () => {
        vi.useFakeTimers();
        const mod = await cargar();
        mod.initFluTrace();
        mod.fluTrace('stream', 'a');

        await vi.advanceTimersByTimeAsync(AGENTE_MS / 2);
        mod.fluTrace('stream', 'b');
        mod.fluTrace('stream', 'c');
        await vi.advanceTimersByTimeAsync(AGENTE_MS);

        expect(fetchFalso).toHaveBeenCalledTimes(1);
        expect(cuerpos()[0].events).toHaveLength(3);
    });

    it('tras un envio, el siguiente lleva SOLO los nuevos', async () => {
        vi.useFakeTimers();
        const mod = await cargar();
        mod.initFluTrace();
        mod.fluTrace('stream', 'viejo');
        await vi.advanceTimersByTimeAsync(AGENTE_MS);

        mod.fluTrace('stream', 'nuevo-1');
        mod.fluTrace('stream', 'nuevo-2');
        await vi.advanceTimersByTimeAsync(AGENTE_MS);

        expect(fetchFalso).toHaveBeenCalledTimes(2);
        const segundo = cuerpos()[1];
        expect(segundo.events.map((e: { event: string }) => e.event)).toEqual(['nuevo-1', 'nuevo-2']);
        expect(segundo.delta).toBe(true);
    });

    it('un envio lleva como maximo las ultimas 50 filas', async () => {
        vi.useFakeTimers();
        const mod = await cargar();
        mod.initFluTrace();
        for (let i = 0; i < 60; i += 1) mod.fluTrace('stream', `e${i}`);

        await vi.advanceTimersByTimeAsync(AGENTE_MS);

        const enviados = cuerpos()[0].events;
        expect(enviados).toHaveLength(50);
        expect(enviados[0].event).toBe('e10');
        expect(enviados.at(-1).event).toBe('e59');
    });

    it('HALLAZGO: con el ring lleno el delta sale VACIO (los nuevos no se envian)', async () => {
        vi.useFakeTimers();
        const mod = await cargar();
        mod.initFluTrace();
        const tope = mod.getFluTraceSnapshot().max;
        for (let i = 0; i < tope; i += 1) mod.fluTrace('stream', `e${i}`);
        await vi.advanceTimersByTimeAsync(AGENTE_MS);

        for (let i = 0; i < 2; i += 1) mod.fluTrace('stream', `nuevo-${i}`);
        await vi.advanceTimersByTimeAsync(AGENTE_MS);

        expect(fetchFalso).toHaveBeenCalledTimes(2);
        expect(cuerpos()[1].events).toEqual([]);
    });

    it('un endpoint que falla solo avisa, no revienta', async () => {
        vi.useFakeTimers();
        fetchFalso.mockRejectedValue(new Error('sin agente'));
        const mod = await cargar();
        mod.initFluTrace();

        mod.fluTrace('stream', 'uno');
        await vi.advanceTimersByTimeAsync(AGENTE_MS);
        await vi.advanceTimersByTimeAsync(1);

        expect(warn).toHaveBeenCalled();
    });
});

describe('fluTrace - superficie de desarrollo', () => {
    it('mountFluTraceDev cuelga la api en la ventana', async () => {
        const mod = await cargar();
        mod.initFluTrace();

        mod.mountFluTraceDev();

        const api = (window as unknown as {
            __fluDev: {
                trace: {
                    enabled: () => boolean;
                    events: () => unknown[];
                    snapshot: () => { count: number };
                    clear: () => void;
                    enable: unknown;
                    disable: unknown;
                    dump: unknown;
                    download: unknown;
                };
            };
        }).__fluDev.trace;
        expect(api.enabled()).toBe(true);
        mod.fluTrace('log', 'a');
        expect(api.events()).toHaveLength(1);
        expect(api.snapshot().count).toBe(1);
        api.clear();
        expect(api.events()).toEqual([]);
        expect(typeof api.enable).toBe('function');
        expect(typeof api.disable).toBe('function');
        expect(typeof api.dump).toBe('function');
        expect(typeof api.download).toBe('function');
    });

    it('dumpFluTrace registra el resumen y devuelve la misma foto', async () => {
        const mod = await cargar();
        mod.initFluTrace();
        mod.fluTrace('log', 'a');

        const foto = mod.dumpFluTrace();

        expect(foto.count).toBe(1);
        expect(info).toHaveBeenCalledWith('[Flu][trace] dump', foto.summary);
    });

    it('downloadFluTrace crea el enlace, lo pulsa, revoca la url y respeta el nombre', async () => {
        const mod = await cargar();
        mod.initFluTrace();
        mod.fluTrace('log', 'a');
        const puerto = URL as unknown as { createObjectURL: unknown; revokeObjectURL: unknown };
        const previos = { crear: puerto.createObjectURL, revocar: puerto.revokeObjectURL };
        const crear = vi.fn(() => 'blob:trace');
        const revocar = vi.fn();
        puerto.createObjectURL = crear;
        puerto.revokeObjectURL = revocar;
        let descargado = '';
        const pulsa = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            descargado = this.download;
        });

        try {
            const foto = mod.downloadFluTrace('mi-traza.json');
            expect(descargado).toBe('mi-traza.json');

            const porDefecto = mod.downloadFluTrace();
            expect(descargado).toMatch(/^flu-trace-.*\.json$/);
            expect(porDefecto.max).toBe(foto.max);
        } finally {
            pulsa.mockRestore();
            puerto.createObjectURL = previos.crear;
            puerto.revokeObjectURL = previos.revocar;
        }

        expect(pulsa).not.toHaveBeenCalled();
        expect(crear).toHaveBeenCalledTimes(2);
        expect(revocar).toHaveBeenCalledTimes(2);
    });
});
