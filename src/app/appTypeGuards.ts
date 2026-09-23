/**
 * P6.6 - Guardas de tipo de la app (extraidas de App.tsx).
 *
 * BUNNY_COMPONENTS es la fuente runtime de la guarda (Record tipado: el
 * compilador obliga a listar todos los miembros) y las dos guardas son
 * predicados puros. BUNNY_COMPONENTS se queda privado.
 */

import type { BunnyComponent } from '../avatar/types/bunny';
import { AI_PROVIDERS } from '../core/config/voiceConfigCatalog';
import type { AIProvider } from '../services/aiServiceFactory';
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

export function isAIProvider(value: string): value is AIProvider {
    return (AI_PROVIDERS as readonly string[]).includes(value);
}
