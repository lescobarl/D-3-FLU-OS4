// ============================================================
// tests/mocks/ffmpeg.ts — stub de "@ffmpeg/ffmpeg" (ffmpeg.wasm)
// para el entorno de pruebas (vitest).
// ============================================================
// ffmpeg.wasm SÍ es una dependencia instalada (@ffmpeg/ffmpeg v0.12),
// pero en vitest (jsdom) no existe <canvas> ni el WebAssembly del core,
// por lo que tryLoadFFmpeg() debe degradar a null (guion/storyboard),
// tal y como ocurre en producción si el core no carga.
//
// API v0.12: `new FFmpeg()` + load({coreURL, wasmURL}) + exec().
// Este stub exporta FFmpeg: undefined → tryLoadFFmpeg retorna null.
// ============================================================

export const FFmpeg: unknown = undefined;

const stub = {
    FFmpeg: undefined as unknown,
};

export default stub;
