/**
 * P6.6 - Guardas de tipo de la app (extraidas de App.tsx).
 *
 * BUNNY_COMPONENTS es la fuente runtime de la guarda (Record tipado: el
 * compilador obliga a listar todos los miembros). BUNNY_COMPONENTS se queda
 * privado.
 */

import type { BunnyComponent } from '../avatar/types/bunny';
/**
 * Miembros válidos de BunnyComponent. El Record tipado obliga a listar todos
 * los componentes del tipo: es la fuente runtime del guard (sin lista paralela
 * sin tipar) y mantiene el parámetro real de ctx.setComponentColor.
 */
const BUNNY_COMPONENTS: Record<BunnyComponent, true> = {
    Bunny_full: true,
    Bunny_body: true,
    Bunny_cap: true,
    Bunny_pants: true,
    Bunny_face: true,
    Bunny_eyes: true,
    Bunny_glasses: true,
    Bunny_ears: true,
};

export function isBunnyComponent(value: string): value is BunnyComponent {
    return Object.prototype.hasOwnProperty.call(BUNNY_COMPONENTS, value);
}

// isAIProvider se RE-EXPORTA: su dueno es sharedConfig.ts, donde vive el catalogo
// AI_PROVIDERS. Estaba reimplementada aqui con la misma logica (la del dueno es
// superset: acepta unknown y comprueba typeof); duplicacion real cazada por el
// catch-all D0 y unificada en P7.20.
export { isAIProvider } from '../core/config/sharedConfig';
