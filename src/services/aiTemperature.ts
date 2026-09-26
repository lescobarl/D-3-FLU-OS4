// ============================================================
// aiTemperature.ts — Dueño único de la temperatura de creatividad configurada.
//
// ANTES (medido): cada adapter resolvía la creatividad por su cuenta y de una
// fuente DISTINTA — `gemini.ts` leía `integrationStore.advancedConfig.creativity`
// (lo que escribe el configurador) y `deepseek.ts` leía la clave local
// `flu-creativity`, que SOLO escribía la restauración de backup. Resultado: el
// ajuste llegaba a un motor y no al otro, en silencio.
//
// La fuente canónica es el configurador (integrationStore), y esto es lo que
// aplica el resto del repo para las mismas claves (`backupSystem` ya restaura
// "a integrationStore (fuente canónica)").
//
// Este módulo NO decide el default de cada motor: devuelve `undefined` cuando no
// hay valor configurado, y cada adapter aplica el suyo. Así no se inventa un
// default compartido que no existía.
// ============================================================
import { useIntegrationStore } from '../store/integrationStore';
import { logCaughtError } from '../lib/caughtError';

/**
 * Creatividad configurada por el usuario, o `undefined` si no hay ninguna.
 * Vive aquí y solo aquí: cualquier motor que necesite temperatura la recibe por
 * `AIRequestOptions.temperature`, no la relee por su cuenta.
 */
export function resolveConfiguredTemperature(): number | undefined {
    try {
        const state = useIntegrationStore.getState();
        const value = state?.advancedConfig?.creativity;
        if (value !== undefined && value !== null) {
            return value;
        }
    } catch (err) {
        logCaughtError('[catch] src/services/aiTemperature.ts', err);
        // Store no disponible (p. ej. entorno de test sin DOM).
    }
    return undefined;
}
