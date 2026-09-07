import { defineConfig, loadEnv, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';
import { createGeminiMiddleware } from './src/server/geminiProxy';
import { createBrowserProxy } from './src/server/browserProxy';
import { createSearchProxy } from './src/server/searchProxy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const ROOT_NM = path.resolve(ROOT, 'node_modules');

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    // El bundle de configuración de Vite NO expone las variables de .env a
    // import.meta.env (y process.env se define a {} abajo), por lo que el
    // proxy del servidor no podía ver la key de texto. loadEnv() la carga
    // desde .env y createGeminiMiddleware({ env }) la usa como respaldo
    // server-side cuando el cliente no envía apiKey.
    const env = loadEnv(mode, ROOT, '');
    return {
        plugins: [
            react({
                // Include JSX files from voice directory in the Babel transform
                include: [
                    '**/*.tsx',
                    '**/*.ts',
                    '**/*.jsx',
                    '**/*.js',
                    path.resolve(ROOT, 'src/voice/**/*.jsx'),
                    path.resolve(ROOT, 'src/voice/**/*.js'),
                ],
            }),
            // Gemini API proxy middleware
            createGeminiMiddleware({ env }),
            // Browser lectura curada proxy middleware (/api/browser/fetch)
            createBrowserProxy({ env }),
            // Buscador web + IA proxy middleware (/api/search/web)
            createSearchProxy({ env }),
        ],
        resolve: {
            // dedupe: fuerza a Vite/vitest a resolver 'three' SIEMPRE desde el
            // node_modules raíz, incluso cuando stats-gl (dependencia de drei)
            // lo importa desde su propio node_modules anidado (three@0.170.0).
            // Sin esto aparece "THREE.WARNING: Multiple instances of Three.js
            // being imported." y se rompe la identidad de clases de THREE.
            dedupe: ['three'],
            alias: {
                // Local aliases for clean imports
                '@avatar': path.resolve(ROOT, 'src/avatar'),
                '@voice': path.resolve(ROOT, 'src/voice'),
                '@components': path.resolve(ROOT, 'src/components'),
                '@hooks': path.resolve(ROOT, 'src/hooks'),
                '@lib': path.resolve(ROOT, 'src/lib'),
                '@store': path.resolve(ROOT, 'src/store'),
                '@services': path.resolve(ROOT, 'src/services'),
                '@core': path.resolve(ROOT, 'src/core'),
                '@types': path.resolve(ROOT, 'src/types'),
                // Force single React instance (prevents "Invalid hook call" from duplicate React)
                'react': path.resolve(ROOT_NM, 'react'),
                'react-dom': path.resolve(ROOT_NM, 'react-dom'),
                'react/jsx-runtime': path.resolve(ROOT_NM, 'react/jsx-runtime'),
                'react/jsx-dev-runtime': path.resolve(ROOT_NM, 'react/jsx-dev-runtime'),
                // Force single R3F instance
                '@react-three/fiber': path.resolve(ROOT_NM, '@react-three/fiber'),
                '@react-three/drei': path.resolve(ROOT_NM, '@react-three/drei'),
                // Force single Three.js instance
                'three': path.resolve(ROOT_NM, 'three'),
                // Force @huggingface/transformers to use the browser/web build
                '@huggingface/transformers': path.resolve(ROOT_NM, '@huggingface/transformers/dist/transformers.web.js'),
            },
        },
        define: {
            'process.env': '({})',
            'process.platform': '"browser"',
            'process.arch': '"x64"',
            'process.pid': 'Date.now()',
            'process.stdout': '({ write: () => {} })',
            'process.release': '({ name: "browser" })',
            'process.versions': '({ node: "0.0.0" })',
        },
        // Exclude @huggingface/transformers from dependency pre-bundling
        optimizeDeps: {
            exclude: ['@huggingface/transformers'],
        },
        server: {
            port: 5173,
            // Auto-open SOLO en dev manual; Playwright levanta su propio server
            // (PLAYWRIGHT_SERVER=1) y no debe abrir pestañas del navegador.
            open: process.env.PLAYWRIGHT_SERVER === '1' ? false : true,
            // ffmpeg.wasm (videoAssembler) puede necesitar aislamiento cruzado (SAB)
            // con COOP+COEP; pero COEP=require-corp BLOQUEA cargar imágenes
            // cross-origin (Pollinations) que no mandan CORP → "No se pudo cargar la
            // imagen" aunque la URL abra en el navegador. El ensamblado mp4 ya
            // funcionó sin estas cabeceras, así que se mantiene SOLO COOP (no bloquea
            // imágenes) y se retira COEP.
            headers: {
                'Cross-Origin-Opener-Policy': 'same-origin',
            },
            // Proxy same-origin para la búsqueda de música en línea (Deezer).
            // La API de Deezer NO envía CORS: un fetch directo desde el
            // navegador sería bloqueado. Este proxy reescribe /api/deezer →
            // https://api.deezer.com con cambio de origen (changeOrigin).
            proxy: {
                '/api/deezer': {
                    target: 'https://api.deezer.com',
                    changeOrigin: true,
                    rewrite: (p) => p.replace(/^\/api\/deezer/, ''),
                },
            },
        },
        preview: {
            headers: {
                'Cross-Origin-Opener-Policy': 'same-origin',
            },
        },
        build: {
            rollupOptions: {
                external: [
                    '@huggingface/transformers',
                    'zustand',
                    'three',
                    'react',
                    'react-dom',
                    'react/jsx-runtime',
                    'react/jsx-dev-runtime',
                    '@react-three/fiber',
                    '@react-three/drei',
                ],
            },
        },
    };
});
