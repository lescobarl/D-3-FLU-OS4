// ============================================================
// scripts/sync-ffmpeg-core.mjs — autohospeda ffmpeg.wasm core
// ============================================================
// Copia el core single-threaded de @ffmpeg/core (dist/esm) a
// public/ffmpeg/ para que la app cargue ffmpeg.wasm 100% local
// (sin CDN ni servidor externo) vía import.meta.env.BASE_URL.
//
// IMPORTANTE: se usa el build ESM (dist/esm), no UMD. La clase
// FFmpeg v0.12 arranca un worker de tipo `module` que hace
// `await import(coreURL).default`; el build UMD no exporta
// `default` y falla con "failed to import ffmpeg-core.js".
//
// Se ejecuta como postinstall y manualmente con `npm run sync:ffmpeg`.
// ============================================================

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIR = join(ROOT, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const OUT_DIR = join(ROOT, 'public', 'ffmpeg');

const FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

function main() {
    if (!existsSync(CORE_DIR)) {
        console.warn('[sync-ffmpeg-core] @ffmpeg/core no está instalado; omite la copia.');
        return;
    }
    mkdirSync(OUT_DIR, { recursive: true });
    for (const file of FILES) {
        const src = join(CORE_DIR, file);
        if (!existsSync(src)) {
            console.warn(`[sync-ffmpeg-core] No se encontró ${file}; omite.`);
            continue;
        }
        copyFileSync(src, join(OUT_DIR, file));
        console.log(`[sync-ffmpeg-core] Copiado public/ffmpeg/${file}`);
    }
}

main();
