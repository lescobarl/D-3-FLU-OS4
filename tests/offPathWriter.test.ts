// ============================================================
// Guard - la persistencia no bloquea la voz (escritor fuera de camino)
// ------------------------------------------------------------
// Causa raíz: el turno resolvía la respuesta y acto seguido `await saveSessionState`
// escribía ANTES de hablar: el usuario esperaba al disco para OÍR algo ya listo.
// Prueba de MUTACIÓN (el detector no es decorativo): si el escritor volviera a
// esperar la escritura, el caso "no bloquea" falla por tiempo; si dejara de
// serializar, el caso "orden de llamada" falla.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createOffPathWriter } from '../src/voice/lib/offPathWriter';

type Escritura = { id?: number; retardo?: number; falla?: boolean; valor?: string };

describe('createOffPathWriter', () => {
    it('no bloquea: write() devuelve sin esperar a la escritura', async () => {
        let liberar: () => void = () => {};
        const puerta = new Promise<void>((resolve) => {
            liberar = resolve;
        });
        const writer = createOffPathWriter(() => puerta);

        const t0 = Date.now();
        writer.write({ id: 1 });
        const transcurrido = Date.now() - t0;

        expect(transcurrido).toBeLessThan(50);
        liberar();
        await writer.flush();
    });

    it('mantiene el ORDEN de llamada aunque las escrituras tarden distinto', async () => {
        const escritas: number[] = [];
        const writer = createOffPathWriter(async (payload: Escritura) => {
            // La primera tarda más: si no serializara, se adelantaría la segunda.
            await new Promise((resolve) => setTimeout(resolve, payload.retardo ?? 0));
            escritas.push(payload.id as number);
        });

        writer.write({ id: 1, retardo: 30 });
        writer.write({ id: 2, retardo: 0 });
        await writer.flush();

        expect(escritas).toEqual([1, 2]);
    });

    it('evalúa el payload al LLAMAR, no al ejecutarse', async () => {
        let instantanea = 'a';
        const vistas: string[] = [];
        const writer = createOffPathWriter(async (payload: Escritura) => {
            vistas.push(payload.valor as string);
        });

        writer.write({ valor: instantanea });
        instantanea = 'b';
        writer.write({ valor: instantanea });
        await writer.flush();

        expect(vistas).toEqual(['a', 'b']);
    });

    it('un fallo se reporta y NO rompe la cadena', async () => {
        const errores: string[] = [];
        const escritas: number[] = [];
        const writer = createOffPathWriter(
            async (payload: Escritura) => {
                if (payload.falla) throw new Error('disco');
                escritas.push(payload.id as number);
            },
            (error: Error) => errores.push(error.message),
        );

        writer.write({ id: 1, falla: true });
        writer.write({ id: 2 });
        await writer.flush();

        expect(errores).toEqual(['disco']);
        expect(escritas).toEqual([2]);
    });

    it('sin onError tampoco propaga el fallo al llamante', async () => {
        const writer = createOffPathWriter(async () => {
            throw new Error('disco');
        });
        writer.write({});
        await expect(writer.flush()).resolves.toBeUndefined();
    });
});
