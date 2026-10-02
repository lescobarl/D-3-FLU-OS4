// @vitest-environment jsdom
/**
 * fluDevConsole - el panel de dev del ingress del microfono (0%).
 *
 * POR QUE ESTE TEST: estas 219 lineas montan un panel flotante de diagnostico y
 * nadie las ejecutaba. Se prueban las conductas que importan: cuando se monta y
 * cuando no, que la linea NUEVA va ARRIBA con su reloj/numero/fuente/tipo, los
 * colores por tipo, el tope de lineas, la posicion guardada entre recargas
 * (sessionStorage) y el ARRASTRE con punteros (incluido el recorte a la ventana).
 * El modulo se recarga por prueba: guarda `panelReady` en estado de modulo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const POS_KEY = 'flu-dev-mic-log-pos';
const PANEL_ID = 'flu-dev-mic-log';
const BODY_ID = `${PANEL_ID}-body`;

type Modulo = typeof import('../src/voice/lib/fluDevConsole.js');

const cargar = async (): Promise<Modulo> => {
    vi.resetModules();
    return import('../src/voice/lib/fluDevConsole.js');
};

const ventana = () => window as unknown as { __FLU_DEV_CONSOLE_PANEL?: boolean };

/** Enciende el panel por el interruptor explicito de la ventana. */
const encender = () => {
    ventana().__FLU_DEV_CONSOLE_PANEL = true;
};

const panel = () => document.getElementById(PANEL_ID) as HTMLElement | null;

const cuerpo = () => document.getElementById(BODY_ID) as HTMLElement;

const linea = (mod: Modulo, seq: number, extra: Record<string, unknown> = {}) =>
    mod.appendFluMicLogLine({ seq, source: 'mic', kind: 'interim', published: `texto-${seq}`, ...extra });

/** Puntero con `pointerId` (jsdom no trae PointerEvent). */
const puntero = (tipo: string, { id = 7, x = 0, y = 0, button = 0 } = {}) => {
    const evento = new MouseEvent(tipo, { button, clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperty(evento, 'pointerId', { value: id });
    return evento;
};

const conCaptura = (titulo: HTMLElement) => {
    const capturar = vi.fn();
    const soltar = vi.fn();
    const puerto = titulo as unknown as { setPointerCapture: unknown; releasePointerCapture: unknown };
    puerto.setPointerCapture = capturar;
    puerto.releasePointerCapture = soltar;
    return { capturar, soltar };
};

beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    delete ventana().__FLU_DEV_CONSOLE_PANEL;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('fluDevConsole - cuando se monta', () => {
    it('por defecto NO se monta: la config lo deja apagado', async () => {
        const mod = await cargar();

        expect(FLU_CONFIG.debug.micConsolePanel).toBe(false);
        expect(mod.isFluDevConsolePanelEnabled()).toBe(false);

        linea(mod, 1);

        expect(panel()).toBeNull();
    });

    it('el interruptor de la ventana manda sobre la config', async () => {
        const mod = await cargar();

        ventana().__FLU_DEV_CONSOLE_PANEL = false;
        expect(mod.isFluDevConsolePanelEnabled()).toBe(false);

        encender();
        expect(mod.isFluDevConsolePanelEnabled()).toBe(true);
    });

    it('el panel se crea UNA vez, con su etiqueta, su titulo y su cuerpo', async () => {        encender();
        const mod = await cargar();

        linea(mod, 1);
        linea(mod, 2);

        expect(document.querySelectorAll(`#${PANEL_ID}`)).toHaveLength(1);
        expect(panel()!.getAttribute('aria-label')).toBe('Flu mic log ingress');
        expect(panel()!.parentElement).toBe(document.body);
        expect(panel()!.style.position).toBe('fixed');
        expect(cuerpo()).not.toBeNull();
        expect(panel()!.firstElementChild).not.toBe(cuerpo());
    });
});

describe('fluDevConsole - las lineas', () => {
    it('la linea nueva va ARRIBA y lleva reloj, numero, fuente y tipo', async () => {
        encender();
        const mod = await cargar();

        linea(mod, 1);
        linea(mod, 2);

        const primera = cuerpo().firstElementChild as HTMLElement;
        const ultima = cuerpo().lastElementChild as HTMLElement;
        expect(primera.textContent).toMatch(/^\d{1,2}:\d{2}:\d{2} #2 \[mic\] interim texto-2$/);
        expect(ultima.textContent).toMatch(/#1 \[mic\] interim texto-1$/);
    });

    it('la nota se anade entre parentesis solo si hay texto publicado', async () => {
        encender();
        const mod = await cargar();

        linea(mod, 1, { published: 'hola', note: 'eco' });
        linea(mod, 2, { published: '', raw: 'crudo', note: 'nota' });
        linea(mod, 3, { published: '', raw: '', note: 'solo-nota' });

        const textos = [...cuerpo().children].map((n) => n.textContent);
        expect(textos[0]).toMatch(/solo-nota$/);
        expect(textos[1]).toMatch(/crudo$/);
        expect(textos[2]).toMatch(/hola \(eco\)$/);
    });

    it('el color lo decide el tipo de linea', async () => {
        encender();
        const mod = await cargar();

        linea(mod, 1, { kind: 'final' });
        linea(mod, 2, { kind: 'redundant' });
        linea(mod, 3, { kind: 'skip' });
        linea(mod, 4, { kind: 'blocked' });
        linea(mod, 5, { kind: 'interim' });

        const colores = [...cuerpo().children].map((n) => (n as HTMLElement).style.color);
        expect(colores[0]).toBe('');
        expect(colores[1]).toBe('rgb(170, 176, 184)');
        expect(colores[2]).toBe('rgb(170, 176, 184)');
        expect(colores[3]).toBe('rgb(184, 245, 195)');
        expect(colores[4]).toBe('rgb(184, 245, 195)');
    });

    it('el cuerpo se queda con las ULTIMAS lineas (tope de la config)', async () => {
        encender();
        const mod = await cargar();
        const tope = Number(FLU_CONFIG.debug.micConsoleMaxLines);

        for (let i = 1; i <= tope + 10; i += 1) {
            mod.appendFluMicLogLine({ seq: i, source: 'mic', kind: 'interim', published: `t${i}` });
        }

        expect(cuerpo().childNodes).toHaveLength(tope);
        expect(cuerpo().firstElementChild!.textContent).toMatch(new RegExp(`#${tope + 10} `));
        expect(cuerpo().lastElementChild!.textContent).toMatch(/#11 /);
    });

    it('apagado no escribe ni monta nada', async () => {
        ventana().__FLU_DEV_CONSOLE_PANEL = false;
        const mod = await cargar();

        linea(mod, 1);

        expect(panel()).toBeNull();
        expect(document.getElementById(BODY_ID)).toBeNull();
    });
});

describe('fluDevConsole - posicion guardada', () => {
    it('la posicion guardada se aplica al montar', async () => {
        encender();
        sessionStorage.setItem(POS_KEY, JSON.stringify({ left: 100, top: 50, width: 400, height: 250 }));
        const mod = await cargar();

        linea(mod, 1);

        expect(panel()!.style.left).toBe('100px');
        expect(panel()!.style.top).toBe('50px');
        expect(panel()!.style.bottom).toBe('auto');
        expect(panel()!.style.width).toBe('400px');
        expect(panel()!.style.height).toBe('250px');
    });

    it('una posicion sin sentido se ignora (y el tamano minimo se respeta)', async () => {
        encender();
        sessionStorage.setItem(POS_KEY, JSON.stringify({ left: 'x', top: null, width: 100, height: 50 }));
        const mod = await cargar();

        linea(mod, 1);

        expect(panel()!.style.left).toBe('12px');
        expect(panel()!.style.width).toBe('min(560px, 94vw)');
        expect(panel()!.style.height).toBe('300px');
    });

    it('una posicion con basura no rompe el montaje', async () => {
        encender();
        sessionStorage.setItem(POS_KEY, '{no-json');
        const mod = await cargar();

        linea(mod, 1);

        expect(panel()).not.toBeNull();
        expect(panel()!.style.left).toBe('12px');
    });
});

describe('fluDevConsole - arrastre', () => {
    const conPanelArrastrable = async () => {
        encender();
        const mod = await cargar();
        linea(mod, 1);
        const titulo = panel()!.firstElementChild as HTMLElement;
        const captura = conCaptura(titulo);
        return { mod, titulo, ...captura };
    };

    it('arrastrar mueve el panel y lo deja DENTRO de la ventana', async () => {
        const { titulo } = await conPanelArrastrable();

        const abajo = puntero('pointerdown', { x: 10, y: 10 });
        titulo.dispatchEvent(abajo);

        expect(abajo.defaultPrevented).toBe(true);
        // Al agarrar, el panel fija su posicion con el rect actual (0,0 en jsdom).
        expect(panel()!.style.left).toBe('0px');
        expect(panel()!.style.right).toBe('auto');
        expect(panel()!.style.bottom).toBe('auto');

        // Muy a la derecha/abajo: se recorta al borde de la ventana.
        titulo.dispatchEvent(puntero('pointermove', { x: 100_000, y: 100_000 }));
        expect(panel()!.style.left).toBe(`${window.innerWidth - 4}px`);
        expect(panel()!.style.top).toBe(`${window.innerHeight - 4}px`);

        // Muy a la izquierda/arriba: no sale por el borde contrario.
        titulo.dispatchEvent(puntero('pointermove', { x: -100_000, y: -100_000 }));
        expect(panel()!.style.left).toBe('0px');
        expect(panel()!.style.top).toBe('0px');
    });

    it('solo arrastra el boton principal', async () => {
        const { titulo } = await conPanelArrastrable();

        const secundario = puntero('pointerdown', { x: 10, y: 10, button: 2 });
        titulo.dispatchEvent(secundario);
        titulo.dispatchEvent(puntero('pointermove', { x: 300, y: 300 }));

        expect(secundario.defaultPrevented).toBe(false);
        expect(panel()!.style.left).toBe('12px');
    });

    it('un puntero distinto no mueve el panel', async () => {
        const { titulo } = await conPanelArrastrable();
        titulo.dispatchEvent(puntero('pointerdown', { id: 7, x: 10, y: 10 }));
        const trasAgarrar = panel()!.style.left;

        titulo.dispatchEvent(puntero('pointermove', { id: 9, x: 300, y: 300 }));

        expect(panel()!.style.left).toBe(trasAgarrar);

        // Con el MISMO puntero, en cambio, si se mueve.
        titulo.dispatchEvent(puntero('pointermove', { id: 7, x: 300, y: 300 }));
        expect(panel()!.style.left).not.toBe(trasAgarrar);
    });

    it('al soltar se suelta la captura y se guarda la posicion', async () => {
        const { titulo, capturar, soltar } = await conPanelArrastrable();

        titulo.dispatchEvent(puntero('pointerdown', { id: 7, x: 10, y: 10 }));
        expect(capturar).toHaveBeenCalledWith(7);

        titulo.dispatchEvent(puntero('pointerup', { id: 7, x: 20, y: 20 }));

        expect(soltar).toHaveBeenCalledWith(7);
        expect(Object.keys(JSON.parse(sessionStorage.getItem(POS_KEY)!)).sort()).toEqual([
            'height',
            'left',
            'top',
            'width',
        ]);
    });

    it('si soltar la captura falla, la posicion se guarda igual', async () => {
        const { titulo } = await conPanelArrastrable();
        (titulo as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {
            throw new Error('sin captura');
        };

        titulo.dispatchEvent(puntero('pointerdown', { x: 10, y: 10 }));
        titulo.dispatchEvent(puntero('pointercancel', { x: 10, y: 10 }));

        expect(sessionStorage.getItem(POS_KEY)).not.toBeNull();
    });

    it('el cambio de tamano tambien guarda la posicion', async () => {
        let observado: (() => void) | null = null;
        vi.stubGlobal('ResizeObserver', class {
            constructor(cb: () => void) {
                observado = cb;
            }

            observe() {
                /* nada: se dispara a mano */
            }
        });
        try {
            await conPanelArrastrable();

            expect(observado).not.toBeNull();
            (observado as unknown as () => void)();

            expect(sessionStorage.getItem(POS_KEY)).not.toBeNull();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('fluDevConsole - precedencia del interruptor', () => {
    // Se sustituye SOLO el bloque debug de la config para poder ver el otro lado:
    // con la config de fabrica apagada, el `false` explicito no se distingue
    // (ambos caminos dan false y la mutacion sobrevive). Aqui la config enciende.
    it('el false explicito de la ventana manda incluso si la config enciende el panel', async () => {
        vi.resetModules();
        vi.doMock('../src/voice/lib/fluConfig.js', async (importOriginal) => {
            const real = await importOriginal<typeof import('../src/voice/lib/fluConfig.js')>();
            return {
                ...real,
                FLU_CONFIG: { ...real.FLU_CONFIG, debug: { ...real.FLU_CONFIG.debug, micConsolePanel: true } },
            };
        });

        try {
            const mod = await import('../src/voice/lib/fluDevConsole.js');

            ventana().__FLU_DEV_CONSOLE_PANEL = false;
            expect(mod.isFluDevConsolePanelEnabled()).toBe(false);

            delete ventana().__FLU_DEV_CONSOLE_PANEL;
            expect(mod.isFluDevConsolePanelEnabled()).toBe(true);
        } finally {
            vi.doUnmock('../src/voice/lib/fluConfig.js');
        }
    });
});
