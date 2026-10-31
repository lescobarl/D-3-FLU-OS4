/**
 * Perfil anónimo por defecto derivado de `FLU_CONFIG.multiuser`.
 *
 * Dueño único de esa derivación: la consumen el hook de participantes y el reset
 * de validación. Si cada uno la calculara por su cuenta, el nombre y el rol del
 * perfil que nunca se borra podrían divergir.
 */
import { resolveKindRole } from './participantRegistry';

/** Nombre y rol del perfil anónimo configurado. */
export type AnonymousProfile = Readonly<{ name: string; role: string }>;

/**
 * Resuelve el perfil anónimo por defecto desde la sección `multiuser` de config.
 * @param config Sección `multiuser` de la configuración.
 * @returns Nombre y rol del perfil anónimo.
 */
export function resolveAnonymousProfile(config: Record<string, unknown>): AnonymousProfile {
    const skipDefaults = (config.skipDefaults as Record<string, unknown>) || {};
    const kind = String(skipDefaults.defaultKind || 'niño');
    const role =
        resolveKindRole(kind, (config.kindToRole as Record<string, string>) || {}) || 'Estudiante';
    return { name: String(skipDefaults.anonymousName || 'Anónimo'), role };
}
