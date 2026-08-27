// ============================================================
// src/services/ffmpegOptional.ts — stub de "@ffmpeg/ffmpeg"
// (ffmpeg.wasm v0.12) para el ensamblado de video (F4).
// ============================================================
// ffmpeg.wasm es una dependencia REAL instalada (@ffmpeg/ffmpeg) y su
// core se autohospeda en public/ffmpeg/ (scripts/sync-ffmpeg-core.mjs),
// por lo que dev/build resuelven el paquete real y este stub ya no se
// referencia desde vite.config.ts.
//
// Se conserva únicamente como referencia/documentación de la API v0.12:
//   class FFmpeg { load({coreURL, wasmURL}); exec(args); writeFile;
//   readFile; deleteFile } + toBlobURL de @ffmpeg/util.
// ============================================================

export const FFmpeg: unknown = undefined;

const stub = {
    FFmpeg: undefined as unknown,
};

export default stub;
