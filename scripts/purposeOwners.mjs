#!/usr/bin/env node
/**
 * purposeOwners.mjs — capa SEMANTICA: registro de PROPOSITOS con dueno unico.
 *
 * POR QUE EXISTE (P9.25, medido 2026-10-08): `duplicationGuard` mide un NOMBRE exacto
 * (`function downsample`) y `duplication.mjs` mide el ESQUELETO. Ninguno de los dos ve
 * "el MISMO proposito con OTRO algoritmo": tres funciones que cambian la tasa de
 * muestreo con algoritmos distintos no comparten ni nombre ni cuerpo, asi que las dos
 * barreras quedaban verdes con 3 remuestreadores vivos.
 *
 * SIN REDUCCION DISPONIBLE (7.7.e): unificarlos cambiaria la CONDUCTA — `tests/embeddingFrames.test.ts`
 * PINEA la decimacion (48000 -> 16000 da [0, 3, 6]) y el camino de ASR usa box. Por eso
 * este proposito se CIERRA COMO CLASIFICACION: un dueno declarado + las variantes con su
 * motivo, y la barrera impide una CUARTA implementacion por FORMA (no por nombre).
 *
 * UN DUENO de la logica: este modulo. Consumidor: tests/purposeOwnershipGuard.test.ts
 * (barrera dentro de `lint:guards`).
 */

/**
 * @typedef {{ file: string, symbol: string, motivo?: string }} PurposeMember
 * @typedef {{ id: string, proposito: string, dueno: PurposeMember, variantes: PurposeMember[],
 *             formas: Array<{ re: RegExp, forma: string }> }} Purpose
 */

/** @type {Purpose[]} */
export const PURPOSES = [
  {
    id: 'resample',
    proposito: 'Cambiar la tasa de muestreo de una senal de audio.',
    dueno: { file: 'src/voice/lib/asr/resample.js', symbol: 'downsample' },
    variantes: [
      {
        file: 'src/voice/lib/embeddingFrames.js',
        symbol: 'downsampleTo16k',
        motivo:
          'DECIMACION (toma 1 de cada N) para los embeddings de identidad de voz: su conducta esta PINNED por tests/embeddingFrames.test.ts ("remuestreo por decimacion": 48000->16000 da [0,3,6]; a tasa igual devuelve las muestras tal cual). Unificar al box cambiaria los valores y romperia una conducta validada.',
      },
      {
        file: 'src/voice/lib/pcmAudio.js',
        symbol: 'resampleLinear',
        motivo:
          'INTERPOLACION LINEAL para el PCM 16-bit mono que va al STT por streaming (resampleLinear -> encodePcmChunk -> micCaptureBridge). El camino de ASR on-device usa box; son dos calidades distintas por consumidor, no dos copias.',
      },
    ],
    formas: [
      { re: /function\s+(downsample)\b/, forma: 'downsample' },
      { re: /function\s+(downsampleTo\d+k)\b/, forma: 'downsampleToNk' },
      { re: /function\s+(resample[A-Za-z0-9]*)\b/, forma: 'resampleX' },
    ],
  },
];

/** Declarados de un proposito: dueño + variantes, como `file:symbol`. */
export function declaredOf(purpose) {
  return new Set([purpose.dueno, ...purpose.variantes].map((m) => `${m.file}:${m.symbol}`));
}

/**
 * Candidatos que cumplen un proposito, detectados por FORMA (no por nombre exacto).
 * @param {string} file ruta relativa
 * @param {string} source contenido
 * @param {Purpose} purpose
 * @returns {Array<{ purposeId: string, file: string, symbol: string, line: number, forma: string }>}
 */
export function purposeCandidatesIn(file, source, purpose) {
  const out = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { re, forma } of purpose.formas) {
      const m = re.exec(line);
      if (m && m[1]) out.push({ purposeId: purpose.id, file, symbol: m[1], line: index + 1, forma });
    }
  });
  return out;
}

/** Todos los candidatos de todos los propositos declarados. */
export function purposeCandidates(sources, purposes = PURPOSES) {
  return purposes.flatMap((p) => sources.flatMap(({ file, source }) => purposeCandidatesIn(file, source, p)));
}

/**
 * Contraste contra el registro.
 * - `undeclared`: candidatos reales que NO son el dueno ni una variante declarada.
 * - `missing`: propositos cuyo dueno NO aparece en el arbol (registro muerto).
 * - `cobertura`: por proposito, cuantas formas distintas del registro se materializan.
 */
export function evaluatePurposes(sources, purposes = PURPOSES) {
  const candidates = purposeCandidates(sources, purposes);
  const undeclared = [];
  const missing = [];
  const cobertura = {};
  for (const p of purposes) {
    const declared = declaredOf(p);
    const mine = candidates.filter((c) => c.purposeId === p.id);
    for (const c of mine) {
      if (!declared.has(`${c.file}:${c.symbol}`)) undeclared.push(c);
    }
    const owner = `${p.dueno.file}:${p.dueno.symbol}`;
    if (!mine.some((c) => `${c.file}:${c.symbol}` === owner)) missing.push(owner);
    cobertura[p.id] = new Set(mine.map((c) => c.forma)).size;
  }
  return { candidates, undeclared, missing, cobertura };
}

if (process.argv[1] && process.argv[1].endsWith('purposeOwners.mjs')) {
  const { readSources } = await import('./duplication.mjs');
  const sources = readSources('src');
  const { candidates, undeclared, missing, cobertura } = evaluatePurposes(sources);
  console.log(`[purposeOwners] propositos=${PURPOSES.length} candidatos=${candidates.length} sin-declarar=${undeclared.length}`);
  for (const p of PURPOSES) {
    console.log(`  ${p.id}: dueno=${p.dueno.file}:${p.dueno.symbol} variantes=${p.variantes.length} formas-cubiertas=${cobertura[p.id]}`);
  }
  for (const u of undeclared) console.log(`  SIN DECLARAR  ${u.file}:${u.symbol}:${u.line} (forma ${u.forma})`);
  for (const m of missing) console.log(`  DUENO AUSENTE  ${m}`);
}
