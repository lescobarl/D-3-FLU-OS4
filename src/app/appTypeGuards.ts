/**
 * P6.6 - Guardas de tipo de la app (extraidas de App.tsx).
 *
 * isAIProvider se RE-EXPORTA: su dueno es sharedConfig.ts, donde vive el catalogo
 * AI_PROVIDERS. Estaba reimplementada aqui con la misma logica (la del dueno es
 * superset: acepta unknown y comprueba typeof); duplicacion real cazada por el
 * catch-all D0 y unificada en P7.20.
 */
export { isAIProvider } from '../core/config/sharedConfig';
