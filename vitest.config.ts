import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        exclude: ['tests/e2e/**', 'node_modules/**'],
        testTimeout: 15_000,
        // RENDIMIENTO: pool 'forks' (default de vitest 3) resultó más rápido
        // que 'threads' en este proyecto (jsdom + three.js). Con 12 CPUs
        // lógicos, el cuello de botella es el arranque/transform de workers
        // (environment ~360-418s sumado vs tests ~16-20s), no la ejecución.
        // maxWorkers explícito aprovecha más CPUs sin saturar el wall-clock.
        pool: 'forks',
        maxWorkers: 10,
        minWorkers: 2,
    },
    resolve: {
        // dedupe: fuerza a vitest a resolver 'three' SIEMPRE desde el
        // node_modules raíz, incluso cuando stats-gl (dependencia de drei)
        // lo importa desde su propio node_modules anidado (three@0.170.0).
        // Complementa el overrides de package.json (una sola copia de three).
        dedupe: ['three'],
        alias: [
            { find: '@avatar', replacement: `${ROOT}src/avatar` },
            { find: '@voice', replacement: `${ROOT}src/voice` },
            { find: '@components', replacement: `${ROOT}src/components` },
            { find: '@hooks', replacement: `${ROOT}src/hooks` },
            { find: '@lib', replacement: `${ROOT}src/lib` },
            { find: '@store', replacement: `${ROOT}src/store` },
            { find: '@services', replacement: `${ROOT}src/services` },
            { find: '@core', replacement: `${ROOT}src/core` },
            { find: '@types', replacement: `${ROOT}src/types` },
            // ffmpeg.wasm es una dependencia opcional (no instalada): el
            // código degrada a guion/storyboard. Stub únicamente para vitest.
            { find: '@ffmpeg/ffmpeg', replacement: `${ROOT}tests/mocks/ffmpeg.ts` },
        ],
    },
});
