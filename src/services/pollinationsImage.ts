/**
 * Resultado de imagen resuelto por Pollinations (sin clave de API).
 *
 * Dueño único de la forma `image_url + trace` que comparten los adaptadores de
 * texto: DeepSeek y Gemini la usan tal cual en vez de reconstruirla cada uno.
 */
import { buildPollinationsUrl } from '../core/config/appConfig';
import { POLLINATIONS_DEFAULTS } from '../core/config/sharedConfig';

/** Traza de una imagen resuelta por URL. */
export interface PollinationsImageTrace {
    readonly [clave: string]: unknown;
    readonly provider: string;
    readonly model: string;
    readonly kind: 'url';
    readonly source: 'pollinations_ai';
    readonly hasImage: boolean;
    readonly prompt: string;
    readonly language: string;
}

/** Resultado de imagen listo para el consumidor del adaptador. */
export interface PollinationsImageResult {
    readonly image_url: string;
    readonly trace: PollinationsImageTrace;
}

/**
 * Construye la respuesta de imagen de Pollinations para un prompt.
 * @param prompt Texto ya resuelto de la petición.
 * @param language Idioma activo de la petición.
 * @returns URL de la imagen y su traza.
 */
export function buildPollinationsImageResult(prompt: string, language: string): PollinationsImageResult {
    return {
        image_url: buildPollinationsUrl(prompt),
        trace: {
            provider: POLLINATIONS_DEFAULTS.ID,
            model: POLLINATIONS_DEFAULTS.ID,
            kind: 'url',
            source: 'pollinations_ai',
            hasImage: true,
            prompt,
            language,
        },
    };
}
