#!/usr/bin/env node
/**
 * ANALIZADOR del debug.log de VOZ (sonda VozProbe). Cero dependencias, solo lectura.
 *
 * PARA QUE: en una corrida REAL (npm run dev + micro de verdad) el unico artefacto
 * que dice que paso es debug.log. Antes habia que cruzar a mano `asrRaw`/`asrFinal`/
 * `commit`/`row`/`identity`/`Match`. Esto lo cruza por TURNO y marca los defectos
 * reportados por el dueno:
 *   D1 cabeza perdida  -> la fila no contiene el texto que el ASR entrego
 *   D2 fila prematura  -> fila escrita con el texto de un interino (antes del final)
 *   D3 nombre perdido  -> la fila sale con etiqueta automatica habiendo un nombre
 *                         propio ya identificado en la sesion
 *   D4 latencia        -> ms desde asrFinal hasta la fila
 *
 * USO:
 *   node scripts/analiza-voz-log.mjs [ruta=debug.log]
 *   npm run voz:log
 *
 * El log se TRUNCA cada vez que arranca el dev server (src/server/geminiProxy.ts:851),
 * asi que un analisis = UN arranque del server = una sesion del dueno.
 */
import { readFileSync, existsSync } from 'node:fs';

const ruta = process.argv[2] || 'debug.log';
const UMBRAL_LATENCIA_MS = 1500;

if (!existsSync(ruta)) {
    console.log(`[voz:log] no existe ${ruta}. Arranca el dev server y habla en el portal.`);
    process.exit(1);
}

const lineas = readFileSync(ruta, 'utf8').split(/\r?\n/);
const LINEA = /^\[flu-client (\d\d:\d\d:\d\d)\.(\d\d\d)\]/;

/** Eventos VozProbe y trazas sueltas, en orden de aparicion. */
const eventos = [];
const matches = new Map();

for (const linea of lineas) {
    const m = LINEA.exec(linea);
    const t = m ? m[1] + '.' + m[2] : '';
    const idx = linea.indexOf('VozProbe ');
    if (idx >= 0) {
        const resto = linea.slice(idx + 'VozProbe '.length);
        const sp = resto.indexOf(' ');
        const tag = sp < 0 ? resto : resto.slice(0, sp);
        let data = null;
        try {
            data = JSON.parse(sp < 0 ? '{}' : resto.slice(sp + 1));
        } catch {
            data = null;
        }
        eventos.push({ t, tag, data, raw: linea.trim() });
        continue;
    }
    const match = /Match reason=([\w-]+)/.exec(linea);
    if (match) matches.set(match[1], (matches.get(match[1]) || 0) + 1);
}

const porTag = new Map();
for (const ev of eventos) porTag.set(ev.tag, (porTag.get(ev.tag) || 0) + 1);

console.log('============================================================');
console.log('ANALISIS DE VOZ - ' + ruta);
console.log('============================================================');
console.log('lineas totales : ' + lineas.length);
console.log('eventos VozProbe: ' + eventos.length);
console.log('  por tag      : ' + [...porTag.entries()].map(([k, v]) => k + '=' + v).join(' '));
if (matches.size) {
    console.log('  Match (worker): ' + [...matches.entries()].map(([k, v]) => k + '=' + v).join(' '));
}

// --- FLUJO: watchdog stall con voz y cierre tras stop -------------------------
// Dueño del análisis: este script. La línea base congela el antes y los límites
// que NO pueden volver a aparecer en una sesión real.
const aMs = (t) => {
    const [h, m, s] = String(t || '').split(':');
    return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
};
let baseline = null;
try {
    baseline = JSON.parse(readFileSync(new URL('./voz-flujo-baseline.json', import.meta.url), 'utf8'));
} catch {
    baseline = null;
}
const ventanaVoz = Number(baseline?.measurement?.stallVoiceWindowMs) || 0;
const prohibido = baseline?.forbiddenNow || {};
let stall = 0;
let stallConVoz = 0;
let mudo = 0;
let mudoConTexto = 0;
let mudoTemprano = 0;
let mudoTempranoConTexto = 0;
let mudoTempranoAntesDelCompas = 0;
const mudoTempranoPorLocucion = new Map();
let ultimaVoz = null;
let ultimoStop = null;
let ultimaCierreTrasStop = null;
let cierresTrasStop = 0;
let cierresConTextoTrasStop = 0;
let aperturasTrasStop = 0;
// Instante de apertura por locución: el cierre con texto tras el stop SOLO es
// defecto si la locución NACIÓ después del stop. La que ya estaba abierta se
// cierra con su final, que es el comportamiento aceptado (medido 2026-11-13
// 18:46:31: la locución 18ba5849 abrió a las 30.790, el stop llegó a las
// 31.474 y su final «cerrando» la cerró a las 31.683, 209 ms después: el stop
// espera el final de Chrome con la entrada cortada).
const aperturaPorLocucion = new Map();
// BAUTIZO SIN VOZ: el nombre se aplicó a UNA fila sobre la etiqueta de estado
// compartida (`Hablante X/XX`) porque la locución del comando no tenía `vozId`.
// Medido 2026-11-13 18:44:17.108: vozId="", filas=1, etiqueta="Hablante XX":
// las filas anteriores y posteriores de la voz conservaron «Hablante 1».
let bautizoEtiquetaCompartida = 0;
// La marca de solicitud del dueño es la que cuenta; en logs viejos (sin ella)
// se conserva el stop interno del reconocedor para no perder la medición.
const marcaStop = lineas.some((linea) => /\[REC\] stop: request/.test(linea))
    ? /\[REC\] stop: request/
    : /\[REC\] stop: finalizeRecognition/;
for (const linea of lineas) {
    const m = LINEA.exec(linea);
    if (!m) continue;
    const t = aMs(m[1] + '.' + m[2]);
    if (/VozProbe vozMedida/.test(linea) && /"motivo":"ok"/.test(linea)) ultimaVoz = t;
    if (/\[WD\] rebuild kind=stall/.test(linea)) {
        stall += 1;
        // Señal exacta: el propio watchdog publica la evidencia que usó.
        // En logs viejos sin el campo se conserva la aproximación temporal.
        if (/hasRecentSpeech=true/.test(linea)) stallConVoz += 1;
        else if (
            !/hasRecentSpeech=/.test(linea) &&
            ultimaVoz !== null &&
            t - ultimaVoz <= ventanaVoz
        ) {
            stallConVoz += 1;
        }
    }
    if (/\[WD\] rebuild kind=mudo/.test(linea)) {
        mudo += 1;
        // El rebuild `mudo` solo es legítimo con la locución abierta VACÍA: con
        // texto estaría cortando una frase que Chrome ya estaba oyendo.
        if (/sinTextoEnAbierta=false/.test(linea)) mudoConTexto += 1;
        // MUDO TEMPRANO: una vez por locución (candado del consumidor). Se
        // cuenta por `locucionId`, que el propio log publica.
        if (/mudoTemprano=true/.test(linea)) {
            mudoTemprano += 1;
            if (/sinTextoEnAbierta=false/.test(linea)) mudoTempranoConTexto += 1;
            // COMPÁS DEL AUDIO PROPIO: el mudo temprano solo es legítimo cuando
            // ESTA locución acumuló el compás del respaldo. Medido 18:44:08.183:
            // locucionMs=43 (43 ms) y el rebuild cortó el comando que Chrome
            // estaba oyendo; la fila cerró sin `vozId` y el nombre no alcanzó a
            // las filas de la voz. En logs viejos (sin locucionMs) no se mide.
            const locucionMs = Number(/locucionMs=(\d+)/.exec(linea)?.[1]);
            const compas = Number(baseline?.measuredMudoTemprano?.compasRespaldoMs) || 4200;
            if (Number.isFinite(locucionMs) && locucionMs < compas) mudoTempranoAntesDelCompas += 1;
            const id = /locucionId=(\S+)/.exec(linea)?.[1] || '-';
            mudoTempranoPorLocucion.set(id, (mudoTempranoPorLocucion.get(id) || 0) + 1);
        }
    }
    if (marcaStop.test(linea)) {
        ultimoStop = t;
        ultimaCierreTrasStop = null;
        cierresTrasStop = 0;
        cierresConTextoTrasStop = 0;
        aperturasTrasStop = 0;
    }
    if (/conversacion\.nombre\.renombrado/.test(linea)) {
        // La etiqueta compartida (`Hablante X/XX`) NO es una voz: renombrar solo
        // su fila deja fuera a las demás participaciones de la misma voz. Un
        // bautizo legítimo exige `vozId` medido y la etiqueta de esa voz.
        if (/"vozId":""/.test(linea) && /"etiqueta":"Hablante\s+X+\b/.test(linea)) {
            bautizoEtiquetaCompartida += 1;
        }
    }
    if (/conversacion\.locucion\.abierta/.test(linea)) {
        const id = /"locutionId":"([^"]+)"/.exec(linea)?.[1] || '';
        if (id) aperturaPorLocucion.set(id, t);
        if (ultimoStop !== null && t >= ultimoStop) aperturasTrasStop += 1;
    }
    if (/conversacion\.locucion\.cerrada/.test(linea) && ultimoStop !== null && t >= ultimoStop) {
        ultimaCierreTrasStop = t;
        cierresTrasStop += 1;
        const id = /"locutionId":"([^"]+)"/.exec(linea)?.[1] || '';
        const abrioTrasStop = aperturaPorLocucion.has(id) && aperturaPorLocucion.get(id) >= ultimoStop;
        if (abrioTrasStop && /"descarte":null/.test(linea)) cierresConTextoTrasStop += 1;
    }
}
const cierreTrasStopMs =
    ultimoStop !== null && ultimaCierreTrasStop !== null
        ? Math.round(ultimaCierreTrasStop - ultimoStop)
        : null;
console.log('');
console.log('--- FLUJO (watchdog/stop) ---');
console.log('stall rebuilds         : ' + stall + ' (con voz: ' + stallConVoz + ')');
console.log('mudo rebuilds          : ' + mudo + ' (con texto en la abierta: ' + mudoConTexto + ')');
const maxMudoTempranoPorLocucion = Math.max(0, ...mudoTempranoPorLocucion.values());
console.log(
    'mudo temprano          : ' +
        mudoTemprano +
        ' (por locucion max: ' +
        maxMudoTempranoPorLocucion +
        ', con texto: ' +
        mudoTempranoConTexto +
        ', antes del compas: ' +
        mudoTempranoAntesDelCompas +
        ')',
);
console.log(
    'cierre tras stop       : ' +
        (cierreTrasStopMs === null ? '?' : cierreTrasStopMs + 'ms') +
        ' cerradas=' +
        cierresTrasStop +
        ' con_texto=' +
        cierresConTextoTrasStop +
        ' abiertas_nuevas=' +
        aperturasTrasStop,
);
console.log(
    'bautizo sin voz         : ' +
        bautizoEtiquetaCompartida +
        ' (nombre aplicado a UNA fila de etiqueta compartida)',
);
if (baseline) {
    const fallos = [];
    if (stallConVoz > Number(prohibido.stallConVoz ?? 0)) {
        fallos.push('stallConVoz=' + stallConVoz + ' > ' + (prohibido.stallConVoz ?? 0));
    }
    if (mudoConTexto > Number(prohibido.rebuildMudoConTexto ?? 0)) {
        fallos.push('rebuildMudoConTexto=' + mudoConTexto + ' > ' + (prohibido.rebuildMudoConTexto ?? 0));
    }
    const topeTemprano = Number(prohibido.rebuildMudoTempranoPorLocucion ?? 1);
    if (maxMudoTempranoPorLocucion > topeTemprano) {
        fallos.push(
            'rebuildMudoTempranoPorLocucion=' +
                maxMudoTempranoPorLocucion +
                ' > ' +
                topeTemprano,
        );
    }
    if (mudoTempranoConTexto > 0) {
        fallos.push('rebuildMudoTempranoConTexto=' + mudoTempranoConTexto + ' > 0');
    }
    if (mudoTempranoAntesDelCompas > Number(prohibido.mudoTempranoAntesDelCompas ?? 0)) {
        fallos.push(
            'mudoTempranoAntesDelCompas=' +
                mudoTempranoAntesDelCompas +
                ' > ' +
                (prohibido.mudoTempranoAntesDelCompas ?? 0),
        );
    }
    if (bautizoEtiquetaCompartida > Number(prohibido.bautizoEtiquetaCompartida ?? 0)) {
        fallos.push(
            'bautizoEtiquetaCompartida=' +
                bautizoEtiquetaCompartida +
                ' > ' +
                (prohibido.bautizoEtiquetaCompartida ?? 0),
        );
    }
    if (cierresConTextoTrasStop > Number(prohibido.locucionesConTextoTrasStop ?? 0)) {
        fallos.push(
            'locucionesConTextoTrasStop=' +
                cierresConTextoTrasStop +
                ' > ' +
                (prohibido.locucionesConTextoTrasStop ?? 0),
        );
    }
    if (cierreTrasStopMs !== null && cierreTrasStopMs > Number(prohibido.cierreTrasStopMs ?? 0)) {
        fallos.push('cierreTrasStopMs=' + cierreTrasStopMs + ' > ' + (prohibido.cierreTrasStopMs ?? 0));
    }
    if (fallos.length) {
        console.log('BARRERA FLUJO: ROJO -> ' + fallos.join(' | '));
        process.exitCode = 1;
    } else {
        console.log('BARRERA FLUJO: VERDE');
    }
}

/** Palabras normalizadas para comparar texto sin acentos ni puntuacion. */
const palabras = (s) =>
    String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

const turnos = [];
const filas = [];

for (const ev of eventos) {
    if (ev.tag === 'asrFinal' && ev.data) turnos.push({ asr: ev.data, t: ev.t });
    if (ev.tag === 'commit' && ev.data) {
        const t = turnos[turnos.length - 1] || { asr: null, t: ev.t };
        t.commit = ev.data;
        t.commitT = ev.t;
    }
    if (ev.tag === 'row' && ev.data) {
        // La sonda imprime el nombre de ENTRADA y el EFECTIVO: el veredicto es el
        // efectivo (lo que quedo en la fila), no lo que el que llama pretendia.
        if (ev.data.efectivo !== undefined) ev.data = { ...ev.data, speaker: ev.data.efectivo };
        const turnId = ev.data.turnId;
        const objetivo = [...turnos].reverse().find((x) => x.commit && x.commit.turn === turnId);
        filas.push(ev.data);
        if (!objetivo) continue;
        // Un turno escribe VARIAS veces la fila (added/replaced/reused); la segunda
        // suele llevar el hablante vacio. Se guarda la ultima escritura con hablante
        // (la informativa) y, aparte, la ultima de cualquier tipo.
        const spk = String(ev.data.speaker || '').trim();
        if (spk || !objetivo.row) objetivo.row = ev.data;
        objetivo.rowT = ev.t;
        objetivo.rowUltima = ev.data;
    }
    if (ev.tag === 'identity' && ev.data) {
        const objetivo = [...turnos].reverse().find((x) => x.commit && !x.identity);
        if (objetivo) objetivo.identity = ev.data;
    }
}

const ms = (a, b) => {
    if (!a || !b) return null;
    const s = (x) => {
        const [h, m, rest] = x.split(':');
        return ((Number(h) * 60 + Number(m)) * 60 + Number(rest)) * 1000;
    };
    return Math.round(s(b) - s(a));
};

const banderas = { D1: [], D2: [], D3: [], D4: [], D5: [], D6: [] };
let nombrePropio = '';

console.log('');
console.log('--- TURNOS ---');
for (const t of turnos) {
    const asr = t.asr || {};
    const c = t.commit || {};
    const row = t.row || {};
    const id = t.identity || {};
    const lat = ms(t.commitT || t.t, t.rowT);
    console.log(
        [
            't=' + (c.turn ?? '?'),
            'asr=' + JSON.stringify(asr.text || ''),
            'wake=' + (asr.wake === true),
            'commit{pre=' + (c.preReady === true) + ' src=' + (c.src || '-') + ' name=' + JSON.stringify(c.name || '') +
                ' sticky=' + JSON.stringify(c.sticky || '') + ' repl=' + (c.replace === true) + '}',
            'row{' + (row.action || '-') + ' spk=' + JSON.stringify(row.speaker || '') + '}',
            'id{clusters=' + (id.clusters ?? '?') + ' resolved=' + JSON.stringify(id.resolved || '') + '}',
            'lat=' + (lat === null ? '?' : lat + 'ms'),
        ].join(' '),
    );

    if (row.action === 'added' || row.action === 'replaced' || row.action === 'reused') {
        const esperado = palabras(asr.text);
        const escrito = palabras(row.text);
        if (esperado.length && escrito.length) {
            const set = new Set(escrito);
            const perdidas = esperado.filter((p) => !set.has(p));
            if (perdidas.length) banderas.D1.push(`t=${c.turn} faltan=[${perdidas.join(' ')}] row="${row.text}"`);
            if (escrito.length < esperado.length && esperado.slice(0, escrito.length).join(' ') === escrito.join(' ')) {
                banderas.D2.push(`t=${c.turn} la fila es PREFIJO del asrFinal (escrita con el interino) row="${row.text}"`);
            }
        }
    }

    if (typeof row.speaker === 'string' && /^Hablante\s+\d+$/.test(row.speaker.trim()) && nombrePropio) {
        banderas.D3.push(`t=${c.turn} fila="${row.text}" sale "${row.speaker}" con la sesion identificada como "${nombrePropio}"`);
    }
    if (c.src === 'wake-intro' && typeof c.name === 'string' && c.name && !/^Hablante\s+\d+$/.test(c.name)) {
        nombrePropio = c.name;
    }
    if (lat !== null && lat > UMBRAL_LATENCIA_MS) {
        banderas.D4.push(`t=${c.turn} final->fila ${lat}ms`);
    }
}

console.log('');
console.log('--- FILAS DE USUARIO ---');
const conteoHab = new Map();
for (const f of filas) {
    const spk = String(f.speaker || '(vacio)');
    conteoHab.set(spk, (conteoHab.get(spk) || 0) + 1);
    console.log(`  ${f.action || '-'} spk=${spk} txt="${String(f.text || '').slice(0, 90)}"`);
}
console.log('  hablantes: ' + [...conteoHab.entries()].map(([k, v]) => `${k}=${v}`).join(' '));

// --- D5: palabras del ASR FINAL que NO aparecen en NINGUNA fila (perdida global) ---
const asrFinalWords = [];
for (const ev of eventos) {
    if (ev.tag === 'asrRaw' && ev.data && Array.isArray(ev.data.items)) {
        for (const item of ev.data.items) {
            if (item && item.f === 1 && item.t) asrFinalWords.push(...palabras(item.t));
        }
    }
    if (ev.tag === 'asrFinal' && ev.data && ev.data.text) asrFinalWords.push(...palabras(ev.data.text));
}
const rowWords = new Set();
for (const f of filas) for (const w of palabras(f.text)) rowWords.add(w);
const RUIDO = new Set(['okay', 'ok', 'flow', 'flu', 'oye', 'hey', 'the', 'and']);
const perdidas = [...new Set(asrFinalWords)].filter((w) => !rowWords.has(w) && !RUIDO.has(w) && w.length > 2);
if (perdidas.length) {
    banderas.D5.push(
        `palabras del ASR FINAL que no estan en ninguna fila (${perdidas.length}): ${perdidas.slice(0, 60).join(' ')}`,
    );
}

// --- D5b: interinos (f=0) que NUNCA llegaron a una fila (texto visto y no conversado) ---
const interimWords = [];
for (const ev of eventos) {
    if (ev.tag === 'asrRaw' && ev.data && Array.isArray(ev.data.items)) {
        for (const item of ev.data.items) {
            if (item && item.f === 0 && item.t) interimWords.push(...palabras(item.t));
        }
    }
}
const perdidasInterim = [...new Set(interimWords)].filter((w) => !rowWords.has(w) && !RUIDO.has(w) && w.length > 3);
if (perdidasInterim.length) {
    banderas.D5.push(
        `INTERINOS que no llegaron a ninguna fila (${perdidasInterim.length}): ${perdidasInterim.slice(0, 60).join(' ')}`,
    );
}

// --- D6: la fila no lleva el nombre que el COMMIT resolvio ---
for (const t of turnos) {
    const c = t.commit || {};
    const row = t.row || {};
    const cn = String(c.name || '').trim();
    const rs = String(row.speaker || '').trim();
    if (cn && rs && cn.toLowerCase() !== rs.toLowerCase()) {
        banderas.D6.push(`t=${c.turn} commit.name="${cn}" pero la fila quedo "${rs}" (txt="${String(row.text || '').slice(0, 60)}")`);
    }
}

console.log('');
console.log('--- BANDERAS ---');
for (const [id, lista] of Object.entries(banderas)) {
    console.log(`${id} (${lista.length})`);
    for (const item of lista) console.log('   ' + item);
}
const total = Object.values(banderas).reduce((n, l) => n + l.length, 0);
console.log('');

// ---- SEPARACION (Fase 0): cosenos por turno contra CADA cluster de la sesion ----
const conPares = eventos.filter((ev) => ev.tag === 'identity' && ev.data && Array.isArray(ev.data.pares) && ev.data.pares.length);
if (conPares.length) {
    const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const mejores = conPares.map((ev) => Number(ev.data.pares[0]?.sim) || 0);
    const segundos = conPares.map((ev) => Number(ev.data.pares[1]?.sim) || 0);
    const ms = conPares.map((ev) => Number(ev.data.ms) || 0);
    const rms = conPares.map((ev) => Number(ev.data.rms) || 0);
    const alLimite = conPares.filter((ev) => (Number(ev.data.pares[0]?.sim) || 0) - (Number(ev.data.pares[1]?.sim) || 0) < 0.05);
    console.log('');
    console.log('--- SEPARACION (Fase 0) ---');
    console.log('  sondas con pares : ' + conPares.length + '  (ms mediana=' + mediana(ms) + ', rms mediana=' + mediana(rms) + ')');
    console.log('  mejor sim        : mediana=' + mediana(mejores).toFixed(3) + ' min=' + Math.min(...mejores).toFixed(3));
    console.log('  competidor (2o)  : mediana=' + mediana(segundos).toFixed(3) + ' max=' + Math.max(...segundos).toFixed(3));
    console.log('  margen mediana   : ' + (mediana(mejores) - mediana(segundos)).toFixed(3));
    console.log('  al limite (<0.05): ' + alLimite.length + alLimite.slice(0, 3).map((ev) => ' t=' + ev.data.turn + ' [' + (ev.data.pares || []).map((p) => p.label + '=' + p.sim).join(', ') + ']').join(''));
}
console.log(total === 0 ? 'RESULTADO: sin defectos medidos en este log.' : `RESULTADO: ${total} hallazgo(s) medido(s).`);
