// ============================================================
// applyEnvironment.ts — Aplica un AMBIENTE de forma integral
// ============================================================
// Función central que materializa un Ambiente del catálogo
// (environmentRegistry.ts) sobre los sistemas EXISTENTES:
//
//   1. Tema visual  → variables CSS `--flu-*` en documentElement
//                     + atributo `data-ambiente` (base: refactor A1).
//   2. Voz/personalidad → applyProfile(perfil base) + overrides
//                     por datos (rasgos/tone/customInstructions/
//                     proactividad) vía setPersonality.
//   3. Conversación → mensaje de sistema con las instrucciones
//                     del rol.
//
// NO toca pestañas ni decoración 3D aquí: la decoración se
// resuelve reactivamente en SeasonalDecoration (precedencia
// ambiente > temporada) y la visibilidad de pestañas en App.tsx,
// ambos leyendo `activeAmbienteId` del environmentStore.
// La visibilidad de la gorra/pelo del avatar la controla ÚNICAMENTE
// el perfil activo (useAvatarVoiceSync → imageConfig), no el ambiente.
//
// Sin hardcode: toda decisión se lee del catálogo. Agregar un
// oficio = agregar una entrada en ENVIRONMENTS.
// ============================================================

import {
    DEFAULT_AMBIENTE_ID,
    ENVIRONMENT_CSS_VAR_KEYS,
    getAmbiente,
    getDefaultAmbiente,
    getEnvironmentCssVars,
    type EnvironmentDefinition,
} from './environmentRegistry';
import { useEnvironmentStore } from '../../store/environmentStore';
import { useIntegrationStore } from '../../store/integrationStore';

// -----------------------------------------------------------
// Helpers de tema visual (CSS vars + data-ambiente)
// -----------------------------------------------------------

/**
 * Inyecta las variables CSS `--flu-*` del ambiente en documentElement
 * y limpia las claves que el ambiente no define (para que caigan al
 * valor base definido en A1/App.css). Aplica `data-ambiente` (vacío
 * para `asistente` = estado por defecto).
 */
export function applyEnvironmentThemeVars(ambienteId: string): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const vars = getEnvironmentCssVars(ambienteId);

    for (const key of ENVIRONMENT_CSS_VAR_KEYS) {
        const value = vars[key];
        if (value !== undefined && value !== '') {
            root.style.setProperty(`--${key}`, value);
        } else {
            // Sin override → vuelve al valor base de :root (A1).
            root.style.removeProperty(`--${key}`);
        }
    }

    // data-ambiente: vacío para el ambiente por defecto.
    root.dataset.ambiente = ambienteId === DEFAULT_AMBIENTE_ID ? '' : ambienteId;
}

/**
 * Limpia todos los overrides de ambiente del documentElement,
 * devolviendo el documento al estado base (asistente).
 */
export function cleanupEnvironmentThemeVars(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const key of ENVIRONMENT_CSS_VAR_KEYS) {
        root.style.removeProperty(`--${key}`);
    }
    root.dataset.ambiente = '';
}

// -----------------------------------------------------------
// Aplicación del ambiente
// -----------------------------------------------------------

/**
 * Aplica un Ambiente de punta a punta sobre los sistemas existentes.
 *
 * @param ambienteId Id del ambiente a activar (id inválido → default).
 * @returns La definición aplicada (siempre una válida del catálogo).
 */
export function applyEnvironment(ambienteId: string): EnvironmentDefinition {
    // Resolver ambiente con fallback seguro al default.
    const ambiente = getAmbiente(ambienteId) ?? getDefaultAmbiente();

    // 1. Persistir la selección (fuente de verdad reactiva).
    useEnvironmentStore.getState().setActiveAmbienteId(ambiente.id);

    // 2. Tema visual (variables CSS + data-ambiente).
    applyEnvironmentThemeVars(ambiente.id);

    // 3. Voz / personalidad.
    const integration = useIntegrationStore.getState();

    // 3a. Perfil base del rol (reutiliza FLU_PROFILES existente).
    integration.applyProfile(ambiente.voz.perfil);

    // 3b. Overrides por datos: rasgos/tono/instrucciones del rol.
    const personalityOverride: {
        name?: string;
        traits?: string[];
        tone?: EnvironmentDefinition['voz']['tone'];
        customInstructions?: string;
        proactivity?: number;
    } = { name: 'FLU' };

    if (ambiente.voz.rasgos.length > 0) {
        personalityOverride.traits = [...ambiente.voz.rasgos];
    }
    if (ambiente.voz.tone !== undefined) {
        personalityOverride.tone = ambiente.voz.tone;
    }
    if (ambiente.voz.instrucciones.trim() !== '') {
        personalityOverride.customInstructions = ambiente.voz.instrucciones;
    }
    if (typeof ambiente.contenido.proactividad === 'number') {
        personalityOverride.proactivity = ambiente.contenido.proactividad;
    }

    integration.setPersonality(personalityOverride);

    // 4. Mensaje de sistema con el rol (si el ambiente define uno).
    if (ambiente.voz.instrucciones.trim() !== '') {
        integration.addSystemMessage(
            `🌍 Ambiente "${ambiente.nombre}" activado — ${ambiente.voz.instrucciones}`
        );
    }

    return ambiente;
}

/**
 * Regresa FLU a su estado base (`asistente`): restaura tema, perfil
 * de voz por defecto y pestañas completas.
 */
export function resetEnvironment(): EnvironmentDefinition {
    // 1. Volver a la selección por defecto.
    useEnvironmentStore.getState().resetAmbiente();

    // 2. Limpiar overrides de tema del documento.
    cleanupEnvironmentThemeVars();

    // 3. Restaurar perfil base de voz/personalidad.
    const integration = useIntegrationStore.getState();
    integration.applyProfile(getDefaultAmbiente().voz.perfil);

    // 4. Registrar el regreso en la conversación.
    integration.addSystemMessage('🌍 Volviendo al modo Asistente.');

    return getDefaultAmbiente();
}
