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

const banderas = { D1: [], D2: [], D3: [], D4: [] };
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

console.log('');
console.log('--- BANDERAS ---');
for (const [id, lista] of Object.entries(banderas)) {
    console.log(`${id} (${lista.length})`);
    for (const item of lista) console.log('   ' + item);
}
const total = Object.values(banderas).reduce((n, l) => n + l.length, 0);
console.log('');
console.log(total === 0 ? 'RESULTADO: sin defectos medidos en este log.' : `RESULTADO: ${total} hallazgo(s) medido(s).`);
