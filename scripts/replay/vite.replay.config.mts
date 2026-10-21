/**
 * Config MINIMA de Vite para el runner de replay (`npm run replay`).
 *
 * POR QUE EXISTE: el `vite.config.ts` de la APP define `process.arch`/`process.platform`
 * para el bundle del navegador; al cargarlo `vite-node` intenta ASIGNAR esas propiedades
 * del `process` real (read-only en Node moderno) y el runner no arranca. El replay corre
 * en Node con el `import.meta.env` de Vite, sin plugins ni defines de cliente.
 */
import { defineConfig } from 'vite'

export default defineConfig({
  // Sin `define`: el runner es Node, usa el `process` real y el `import.meta.env` de Vite.
  define: {},
  // Sin plugins de React/JSX: el replay solo importa modulos de logica.
  plugins: [],
})
