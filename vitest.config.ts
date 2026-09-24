import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { availableParallelism } from 'node:os';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    // JSX automático también para `.jsx` (componentes OS2 de src/voice): sin esto
    // esbuild transforma `.jsx` con el runtime clásico y exige `React` en ámbito,
    // a diferencia del app (vite.config.ts usa @vitejs/plugin-react). Alinea el
    // transform de tests con el de producción.
    esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
    test: {
        globals: true,
        // RENDIMIENTO (Constraint #5): el arranque de jsdom domina el tiempo
        // cuando la suite es grande. Por defecto corremos en 'node' (rápido,
        // sin globals de navegador). Solo los archivos que renderizan UI o
        // usan window/document/localStorage/speechSynthesis declaran
        // '// @vitest-environment jsdom' en su cabecera.
        environment: 'node',
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        exclude: ['tests/e2e/**', 'node_modules/**'],
        // 120s, no 15s (C61). MEDIDO: la suite mezcla guards de milisegundos con guards
        // que recorren el repo entero o lanzan subprocesos (git/npm/auditoria), y esos
        // tardan SEGUNDOS en limpio: hookDepsRatchet 11.4s, jsReferenceGuard 8.8s,
        // auditLedgerSync 5.8s, hygieneIndicators 4.6s, catchSilencioso 3.5s. Peor: su
        // latencia no crece lineal con la carga. MEDIDO tambien, no supuesto: en una
        // ejecucion con la suite completa en paralelo, viteConfigNodeLoadGuard (1.6s en
        // limpio) se paso de los 15s -> "Test timed out in 15000ms". Un factor ~10x. Con
        // 15s el fallo no era del guard, era del reloj: el detector era correcto y la
        // asercion pasaba. 120s da >10x sobre el guard mas lento medido y NO cuesta nada
        // en el camino feliz, porque un timeout es un techo, no una espera. Ademas este
        // proyecto ya usaba 120_000 para su guard mas pesado (hookDepsRatchet), asi que
        // ahora el techo global y el del caso peor coinciden en vez de contradecirse.
        testTimeout: 120_000,
        // RENDIMIENTO: pool 'forks' (default de vitest 3) resultó más rápido
        // que 'threads' en este proyecto (jsdom + three.js). Con 12 CPUs
        // lógicos, el cuello de botella es el arranque/transform de workers
        // (environment ~360-418s sumado vs tests ~16-20s), no la ejecución.
        // maxWorkers explícito aprovecha más CPUs sin saturar el wall-clock.
        pool: 'forks',
        // maxWorkers NO se fija a mano (antes: 10). Ese 10 estaba medido en una maquina de
        // 12 CPUs logicas, pero CI corre en ubuntu-latest (4 vCPU): 10 workers sobre 4 CPUs
        // se estorban entre si y el guard sincrono jsReferenceGuard (tsc checkJs sobre todo
        // src/) paso de ~9s a 70s. Con un test bloqueando el event loop >60s, vitest aborta
        // el RPC del worker y la corrida queda en rojo por 'Unhandled Error: Timeout calling
        // onTaskUpdate' AUNQUE los 330 ficheros y los 3239 tests pasen. Derivarlo del
        // hardware real mantiene 10 en la maquina del autor (12 CPUs -> 10, identico) y baja
        // a 3 en un runner de 4 vCPU.
        maxWorkers: Math.max(2, Math.min(10, availableParallelism() - 1)),
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
