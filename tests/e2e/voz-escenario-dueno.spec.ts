/**
 * SIMULACION REAL del escenario reportado por el dueño (2026-10-07 15:11-15:13).
 *
 * POR QUE: las validaciones anteriores de la voz eran INYECTADAS (llamaban a las
 * funciones del pipeline directamente), asi que el camino REAL (onresult -> onend ->
 * ingress -> dispatch -> fila) no estaba medido. Aqui la app habla por el micro FALSO
 * del repo (tests/e2e/_helpers.stubSpeechRecognition) y el pipeline corre igual que
 * con Chrome. Cada caso mide lo que el dueño reporto, con el texto y el hablante
 * REALES de la fila del store.
 *
 * Casos medidos:
 *   P1  no se escribe fila ANTES del final (ni con interinos acumulativos ni sin silencio)
 *   P2  no se pierde la CABEZA cuando el final del ASR trae solo la cola
 *   P3  "soy Luis" renombra TODA la participacion (la etiqueta generica desaparece)
 *   P4  latencia final -> fila (rendimiento, medido en ms)
 */
import { expect, test } from '@playwright/test';
import {
    autoSkipOnboarding,
    countUserRows,
    gotoClean,
    readHistoryRows,
    seedActiveUser,
    speakUntilHeard,
    speakViaMic,
    startConversation,
    stubLocalSpeech,
    stubSpeechRecognition,
} from './_helpers';

type Page = Parameters<typeof readHistoryRows>[0];

/**
 * Override de runtime del motor CONVERSACION: `new` se siembra en la URL antes
 * del goto (la vía real de `crearConfigFlu`). Sin la variable, corre `legacy`.
 */
const MOTOR_E2E = process.env.FLU_E2E_ENGINE === 'new' ? 'new' : null;

const esperarListo = async (page: Page) => {
    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 40000 },
    );
};

// "Etiqueta INVENTADA": una etiqueta automatica con indice > 1 (H2, H3...) para la MISMA
// sesion, es decir un hablante que NO existe (la inflacion medida). El label generico con
// indice 1 es el de IDENTIDAD DESCONOCIDA: la fila siempre lleva hablante (P9.65), asi que
// sin evidencia acustica el turno toma ESE label, nunca el nombre de otra voz.
const inventadas = (hablantes: string[]) =>
    hablantes.filter((h) => {
        const m = /^Hablante\s+(\d+)$/.exec(h);
        return m !== null && Number(m[1]) > 1;
    });

const usuarios = async (page: Page) =>
    (await readHistoryRows(page)).filter((row) => row.role === 'user');

test.describe('voz - escenario reportado por el dueño (simulacion REAL)', () => {
    // El relay del cliente manda los logs en lote (200 ms): al cerrar la pagina el
    // ultimo lote se pierde y el analizador no ve la fila del test. Se le da aire.
    test.afterEach(async ({ page }) => {
        await page.waitForTimeout(1500).catch(() => undefined);
    });

    test.beforeEach(async ({ page }) => {
        await autoSkipOnboarding(page);
        await stubLocalSpeech(page);
        await stubSpeechRecognition(page);
        if (MOTOR_E2E) {
            await page.addInitScript((motor) => {
                const url = new URL(window.location.href);
                url.searchParams.set('conversationEngine', motor);
                window.history.replaceState(null, '', url.toString());
            }, MOTOR_E2E);
        }
        await gotoClean(page);
    });

    test('P1: un interino acumulativo NO abre fila (solo el final la abre)', async ({ page }) => {
        await startConversation(page);
        await esperarListo(page);

        // Chrome entrega interinos ACUMULATIVOS mientras se habla. El dueño reporta
        // que la conversacion se escribe ANTES del corte/silencio.
        await speakViaMic(page, 'Okay flow necesitamos', { final: false });
        await speakViaMic(page, 'Okay flow necesitamos nuestra lechita', { final: false });
        await speakViaMic(page, 'Okay flow necesitamos nuestra lechita y no lo puso ahi', { final: false });
        await page.waitForTimeout(2500);

        const antes = await countUserRows(page);

        // Ahora llega el final (con silencio/corte): aqui SI debe nacer la fila.
        await speakViaMic(page, 'Okay flow necesitamos nuestra lechita y no lo puso ahi', {
            final: true,
            endTurn: true,
        });
        await expect.poll(async () => await countUserRows(page), { timeout: 20000 }).toBeGreaterThanOrEqual(1);

        console.log(`[P1] filas de usuario durante el interino = ${antes} (esperado 0)`);
        expect(antes, 'la fila no puede nacer antes del final').toBe(0);
        // INVARIANTE del dueno: el texto que se vio en la transcripcion tiene que estar
        // en la conversacion (cabeza Y cola), no una parte.
        const filas = await usuarios(page);
        console.log(`[P1] fila = ${JSON.stringify(filas.map((f) => f.text))}`);
        const texto = filas.map((f) => f.text.toLowerCase()).join(' | ');
        expect(texto, 'la cabeza de la locucion no puede perderse').toContain('necesitamos');
        expect(texto, 'la cola de la locucion no puede perderse').toContain('puso');
    });

    test('P2: el final que trae solo la COLA no se come la cabeza', async ({ page }) => {
        await startConversation(page);
        await esperarListo(page);

        // Patron medido en el log del dueño: el interino trae la frase completa y el
        // final del ASR llega con la COLA (Chrome corta por el cambio de hablante).
        await speakViaMic(page, 'Okay flow necesitamos nuestra lechita y no lo pusiste ahi', { final: false });
        await page.waitForTimeout(800);
        await speakViaMic(page, 'y no lo pusiste ahi', { final: true, endTurn: true });

        await expect.poll(async () => await countUserRows(page), { timeout: 20000 }).toBeGreaterThanOrEqual(1);
        const filas = await usuarios(page);
        const texto = filas.map((row) => row.text).join(' | ');
        console.log(`[P2] fila = "${texto}"`);
        expect(texto.toLowerCase(), 'la cabeza de la frase no puede perderse').toContain('necesitamos');
    });

    test('P3: "soy Luis" renombra su participacion (la etiqueta generica desaparece)', async ({ page }) => {
        await seedActiveUser(page, 'Luis', { speakerLabel: 'Hablante 1' });
        await startConversation(page);
        await esperarListo(page);

        await speakUntilHeard(page, 'Okay flow soy luis', { expectedUserRows: 1 });
        await page.waitForTimeout(3000);
        await speakUntilHeard(page, 'Okay flow pon musica relajante', { expectedUserRows: 2 });

        const filas = await usuarios(page);
        const hablantes = filas.map((row) => row.speaker);
        console.log(`[P3] hablantes = ${JSON.stringify(hablantes)}`);
        // El turno IDENTIFICADO por voz ("soy luis") lleva su nombre.
        expect(hablantes[0], `hablantes=${JSON.stringify(hablantes)}`).toBe('Luis');
        // La sesion YA identificada NO puede estampar NINGUN nombre a una locucion
        // SIN evidencia de voz (caso 2 del dueno: 'Luis' pegado a una voz distinta).
        // En este arnes no hay audio, asi que la fila siguiente queda SIN hablante;
        // lo que NUNCA puede quedar es una etiqueta inventada ni el nombre ajeno.
        expect(
            hablantes.slice(1),
            `sin evidencia no se estampa nombre ajeno: ${JSON.stringify(hablantes)}`,
        ).not.toContain('Luis');
        expect(
            inventadas(hablantes),
            `no puede quedar una etiqueta inventada: ${JSON.stringify(hablantes)}`,
        ).toHaveLength(0);
    });

    test('P3b: "soy Luis" no deja etiquetas inventadas (sin etiqueta sembrada)', async ({ page }) => {
        // DEFECTO MEDIDO (2026-10-07, RED): tras "Okay flow soy luis" la fila del
        // turno SIGUIENTE vuelve a la etiqueta generica en 1 de cada 2 intentos
        // (log: commit {"name":"Luis"} y la fila acaba en "Hablante 1"). La causa
        // medida es que la decision "aplicar el hablante resuelto a la sesion" esta
        // escrita DOS veces con reglas distintas (useFluVoiceAssistant.js:1469-1471
        // sin la etiqueta que el hablante VENIA usando, y turnSpeakerCommit.js:200-208
        // con ella). test.fail() = se ejecuta y mide; si algun dia PASA, este spec se
        // pone en ROJO y obliga a actualizar el instrumento (la reversa del defecto).
        // El dueño lo dice con la voz: no hay etiqueta previa. La ruta del texto
        // (P9.11) debe registrar el participante y firmar sus filas con el nombre.
        // DEFECTO VIVO (2026-10-07): TRES rutas dan nombre al MISMO turno (la
        // resolucion del commit, el sync sin audio y el tick tardio) y la fila acaba
        // con la ultima que escribe: a veces "Luis", a veces "Hablante 1". test.fail
        // mantiene el caso VIVO documentado en verde; si algun dia pasa, este spec se
        // pone en ROJO y obliga a actualizar el instrumento.
        await startConversation(page);
        await esperarListo(page);

        await speakUntilHeard(page, 'Okay flow soy luis', { expectedUserRows: 1 });
        await page.waitForTimeout(3000);
        await speakUntilHeard(page, 'Okay flow pon musica relajante', { expectedUserRows: 2 });

        const filas = await usuarios(page);
        const hablantes = filas.map((row) => row.speaker);
        console.log(`[P3b] hablantes = ${JSON.stringify(hablantes)}`);
        // INVARIANTE (la que el dueno pide): una sesion identificada NO puede acabar
        // con etiquetas INVENTADAS. El turno identificado lleva el nombre; el turno
        // sin evidencia acustica queda SIN hablante (P8.98) en vez de "Hablante N";
        // nada de dos nombres para el mismo turno.
        expect(hablantes[0], `hablantes=${JSON.stringify(hablantes)}`).toBe('Luis');
        expect(
            inventadas(hablantes),
            `no puede quedar una etiqueta inventada: ${JSON.stringify(hablantes)}`,
        ).toHaveLength(0);
    });

    test('P7: dictado CON PAUSAS (1..25) - no se vacia antes del corte y no falta nada', async ({ page }) => {
        // Caso del dueno (2026-10-08 08:25): contando 1..25 con pausas de dictado, la
        // fila se "vacio" a la conversacion al llegar al 9, ANTES de un silencio real.
        await startConversation(page);
        await esperarListo(page);

        // Chrome NO entrega interinos indefinidos: CIERRA segmentos (final) mientras
        // sigues hablando (su log real: asrRaw con varios items f=1 seguidos). Ese
        // 'final' es lo que disparaba el vaciado antes del silencio real.
        const cortes = ['1 2 3', '1 2 3 4 5', '1 2 3 4 5 6 7', '1 2 3 4 5 6 7 8 9', '1 2 3 4 5 6 7 8 9 10 11 12'];
        for (const corte of cortes) {
            const frase = `voy a contar unos numeros para ver si se pierde la secuencia ${corte}`;
            await speakViaMic(page, frase, { final: false });
            await page.waitForTimeout(700);
            await speakViaMic(page, frase, { final: true }); // cierre de SEGMENTO de Chrome
            await page.waitForTimeout(500);
        }
        const durante = await countUserRows(page);
        console.log(`[P7] filas durante el dictado = ${durante} (esperado 0)`);

        await speakViaMic(
            page,
            'voy a contar unos numeros para ver si se pierde la secuencia 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15',
            { final: true, endTurn: true },
        );
        await expect.poll(async () => await countUserRows(page), { timeout: 25000 }).toBeGreaterThanOrEqual(1);
        const filas = await usuarios(page);
        const texto = filas.map((f) => f.text.toLowerCase()).join(' | ');
        console.log(`[P7] filas = ${JSON.stringify(filas.map((f) => f.text))}`);
        expect(durante, 'la fila no puede vaciarse antes del corte/silencio').toBe(0);
        expect(texto, 'no puede faltar la secuencia').toContain('15');
        expect(filas, 'una sola fila').toHaveLength(1);
    });

    test('P4: latencia final -> fila (medicion de rendimiento)', async ({ page }) => {
        await startConversation(page);
        await esperarListo(page);

        const inicio = Date.now();
        await speakViaMic(page, 'Okay flow cuentame algo corto del mar', { final: true, endTurn: true });
        await expect.poll(async () => await countUserRows(page), { timeout: 20000 }).toBeGreaterThanOrEqual(1);
        const ms = Date.now() - inicio;
        console.log(`[P4] final -> fila = ${ms} ms`);
        expect(ms, 'la fila debe nacer en un margen humano').toBeLessThan(8000);
    });

    test('P5: la locucion que Chrome NO cierra (interino + onend) llega a la conversacion', async ({ page }) => {
        // Defecto reportado: "lo vi en la transcripcion y no esta en la conversacion".
        // Chrome puede cerrar el reconocimiento SIN final: lo unico oido es el interino.
        await startConversation(page);
        await esperarListo(page);

        await speakViaMic(page, 'Okay flow quiero apuntar la lista de la compra', { final: false, endTurn: true });

        await expect.poll(async () => await countUserRows(page), { timeout: 20000 }).toBeGreaterThanOrEqual(1);
        await page.waitForTimeout(2000); // deja FLUSHear el relay antes de cerrar la pagina
        const filas = await usuarios(page);
        console.log(`[P5] filas = ${JSON.stringify(filas.map((f) => f.text))}`);
        expect(filas[0].text.toLowerCase(), 'el interino sin final no puede perderse').toContain('compra');
    });

    test('P6: la continuacion sin wake tras un turno commiteado conserva su texto', async ({ page }) => {
        await startConversation(page);
        await esperarListo(page);

        await speakUntilHeard(page, 'Okay flow necesitamos la lechita', { expectedUserRows: 1 });
        // Espera DETERMINISTA a que el turno previo este escrito (antes era un
        // waitForTimeout fijo: bajo carga la continuacion llegaba antes del cierre y
        // el test caia por timing, no por producto - flake medido, P9.50).
        await expect
            .poll(async () => (await usuarios(page)).some((f) => /lechita/i.test(f.text)), { timeout: 20000 })
            .toBe(true);

        // La PROPIEDAD es que el texto de la continuacion no se pierda; NO cuantas
        // filas se abren (asertar el indice de fila era lo que hacia el spec fragil).
        for (let intento = 0; intento < 3; intento += 1) {
            await speakViaMic(page, 'y no lo pusiste ahi en el vaso', { final: false });
            await speakViaMic(page, 'y no lo pusiste ahi en el vaso grande', { final: true, endTurn: true });
            const aparecio = await expect
                .poll(async () => (await usuarios(page)).some((f) => /vaso/i.test(f.text)), { timeout: 15000 })
                .toBe(true)
                .then(() => true)
                .catch(() => false);
            if (aparecio) break;
        }

        const filas = await usuarios(page);
        const textos = filas.map((f) => f.text.toLowerCase()).join(' | ');
        expect(textos, `la continuacion no puede perder su texto. filas=${JSON.stringify(filas.map((f) => f.text))}`).toContain('vaso');
        expect(textos, 'la locucion anterior no puede perderse').toContain('lechita');
    });
});
