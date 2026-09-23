/**
 * P6.6 - applyConfigAction (extraido de App.tsx).
 *
 * Procesa la configuracion que llega por voz desde el contrato. Recibe todo
 * por contexto (ApplyConfigContext): no toca el estado del componente, solo
 * los setters que le pasa el llamante. App.tsx usa applyConfigAction.
 */

import { isBunnyComponent } from '../app/appTypeGuards';
import type { BunnyComponent } from '../avatar/types/bunny';
import { useEnhancedBranding } from '../core/branding/useEnhancedBranding';
import { AI_PROVIDERS, BRANDING_MODES, FLU_PROFILE_IDS, UI_LANGUAGES, VOICE_CONFIG_CATALOG } from '../core/config/voiceConfigCatalog';
import type { ConfigCatalogEntry } from '../core/config/voiceConfigCatalog';
import { useIntegrationStore } from '../store/integrationStore';
import type { AdvancedConfig, FluProfile, ImageConfig, PersonalityConfig, VoiceConfig } from '../types/bridge';
import type React from 'react';
import { v4 as uuidv4 } from 'uuid';
// ============================================================
// applyConfigAction — Procesa configuracion por voz desde Gemini
// ============================================================
// Se ejecuta al final de onContractResolved, después de todo lo demás.
// Si falla, no afecta el resto del contrato (try/catch en el caller).
// ============================================================
interface ApplyConfigContext {
    branding: ReturnType<typeof useEnhancedBranding>;
    languageRef: React.MutableRefObject<string>;
    setLanguage?: (lang: 'es' | 'en' | 'both') => void;
    setSessionRole?: (role: string) => void;
    handleTextApiKeyCommit?: (key: string) => void;
    handleTextModelCommit?: (model: string) => void;
    handleTextApiUrlCommit?: (url: string) => void;
    handleImageApiKeyCommit?: (key: string) => void;
    handleImageModelCommit?: (model: string) => void;
    handleImageApiUrlCommit?: (url: string) => void;
    handleOcrApiKeyCommit?: (key: string) => void;
    handleOcrModelCommit?: (model: string) => void;
    handleOcrApiUrlCommit?: (url: string) => void;
    setComponentColor?: (component: BunnyComponent, color: string) => void;
    resetComponentColors?: () => void;
    /** Aplicar configuración de voz (rate/volume) al integrationStore */
    setVoiceConfig?: (config: Partial<VoiceConfig>) => void;
    /** Establecer configuración de personalidad (setPersonality del integrationStore) */
    setPersonality?: (config: Partial<PersonalityConfig>) => void;
    /** Establecer configuración avanzada (setAdvancedConfig del integrationStore) */
    setAdvancedConfig?: (config: Partial<AdvancedConfig>) => void;
    /** Establecer configuración de imagen del avatar (setImageConfig del integrationStore) */
    setImageConfig?: (config: Partial<ImageConfig>) => void;
    /** Voces TTS instaladas (para la clave "voice") */
    voices?: SpeechSynthesisVoice[];
    /** Cambiar el proveedor de IA preferido */
    handleSetAiProvider?: (provider: string) => void;
    /** Activar/desactivar celebraciones por logros (branding) */
    setCelebrateAchievements?: (enabled: boolean) => void;
    /** Aplicar un perfil completo de FLU */
    applyProfile?: (profileId: FluProfile) => void;
    /** Limpiar caché y recargar (useConfigPersistence) */
    handleClearCache?: () => void;
    /** Palabras de activación actuales (ref fresca para onContractResolved memoizado) */
    wakeWordsRef: React.MutableRefObject<string>;
    setWakeWords?: (value: string) => void;
    /** Logs de depuración persistidos */
    setDebugLogsEnabled?: (enabled: boolean) => void;
}

// ============================================================
// Despachador de configuración por voz (data-driven)
// ============================================================
// VOICE_CONFIG_CATALOG es la ÚNICA fuente de verdad: la entrada
// (accion + clave) → handler → acción real. Añadir una opción al
// módulo de configuración = añadir una entrada al catálogo; aquí
// no hay que tocar nada más (sin hardcode, sin parches).
// ============================================================

/** Convierte un valor booleano lenient ("true"/"false"/"1"/"0"/"sí"/"no"). */
function parseBoolean(value: string): boolean | null {
    const v = value.trim().toLowerCase();
    const truthy = ['true', '1', 'yes', 'si', 'sí', 'on', 'activar', 'activa', 'encender', 'mostrar', 'visible'];
    const falsy = ['false', '0', 'no', 'off', 'desactivar', 'desactiva', 'apagar', 'ocultar', 'oculta', 'invisible'];
    if (truthy.includes(v)) return true;
    if (falsy.includes(v)) return false;
    return null;
}

/**
 * Aplica un valor numérico validando el rango del catálogo (entry.min/max)
 * y convirtiendo unidades de entrada (minutes/seconds) a ms si hace falta.
 * `apply` recibe el número ya validado para el store objetivo.
 */
function applyNumberConfig(
    entry: ConfigCatalogEntry,
    raw: string,
    apply: (n: number) => void,
): boolean {
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) {
        console.warn(`[applyConfigAction] Valor numérico inválido para "${entry.clave}":`, raw);
        return false;
    }
    let value = parsed;
    if (entry.inputUnit === 'minutes') value = value * 60_000;
    else if (entry.inputUnit === 'seconds') value = value * 1_000;
    if (entry.min !== undefined && value < entry.min) {
        console.warn(`[applyConfigAction] "${entry.clave}" fuera de rango (min ${entry.min}):`, value);
        return false;
    }
    if (entry.max !== undefined && value > entry.max) {
        console.warn(`[applyConfigAction] "${entry.clave}" fuera de rango (max ${entry.max}):`, value);
        return false;
    }
    apply(value);
    return true;
}

/**
 * Despacha una acción de configuración del contrato a la acción real,
 * usando el catálogo como fuente de verdad (sin switches hardcodeados).
 */
export async function applyConfigAction(
    configAction: { accion: string; componente: string; clave: string; valor: string; subvalor?: string; meta?: Record<string, unknown> },
    ctx: ApplyConfigContext,
): Promise<void> {
    const { accion, clave, valor, subvalor } = configAction;

    const entry = VOICE_CONFIG_CATALOG.find((e) => e.accion === accion && e.clave === clave);
    if (!entry) {
        console.warn('[applyConfigAction] Clave sin entrada en catálogo:', accion, clave);
        return;
    }
    if (entry.handler === 'unsupported') {
        console.info('[applyConfigAction] Opción no soportada por voz, omitida:', clave, entry.motivoNoSoportado ?? '');
        return;
    }

    switch (entry.handler) {
        // --------------------------------------------------------
        // BRANDING (set_branding) — useSeasonalBranding
        // --------------------------------------------------------
        case 'brandingActiveSeason': {
            // Cambiar temporada activa (fuerza modo manual automáticamente)
            await ctx.branding.seasonalActions.setMode('manual');
            await ctx.branding.seasonalActions.setActiveSeason(valor);
            break;
        }
        case 'brandingMode': {
            // Modo: auto | manual | disabled
            if ((BRANDING_MODES as readonly string[]).includes(valor)) {
                await ctx.branding.seasonalActions.setMode(valor as 'auto' | 'manual' | 'disabled');
            } else {
                console.warn('[applyConfigAction] Modo branding inválido:', valor);
            }
            break;
        }
        case 'brandingBirthday': {
            // Cumpleaños: "YYYY-MM-DD"
            await ctx.branding.seasonalActions.setBirthday(valor || null);
            break;
        }
        case 'brandingCelebrateAchievements': {
            const enabled = parseBoolean(valor);
            if (enabled !== null) {
                await ctx.setCelebrateAchievements?.(enabled);
            } else {
                console.warn('[applyConfigAction] Booleano inválido para celebrateAchievements:', valor);
            }
            break;
        }
        case 'brandingCustomEvent': {
            // Festividad personalizada: valor "nombre|MM-DD|paleta", subvalor "add"|"remove"
            const mode = subvalor?.trim().toLowerCase();
            const parts = valor.split('|').map((s) => s.trim());
            if (mode === 'add' || mode === 'agregar' || mode === 'añade' || mode === 'añadir') {
                const [name = '', mmdd = '', palette = 'cumpleanos'] = parts;
                const m = mmdd.match(/^(\d{1,2})-(\d{1,2})$/);
                if (!name || !m) {
                    console.warn('[applyConfigAction] Festividad personalizada inválida (esperaba "nombre|MM-DD|paleta"):', valor);
                    break;
                }
                const id = `custom-${uuidv4()}`;
                await ctx.branding.seasonalActions.addCustomEvent({ id, name, month: Number(m[1]), day: Number(m[2]), palette });
            } else if (mode === 'remove' || mode === 'quitar' || mode === 'eliminar') {
                const targetName = parts[0] || '';
                const events = ctx.branding.config.customEvents ?? [];
                const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
                const match = events.find((e) => norm(e.name) === norm(targetName));
                if (match) {
                    await ctx.branding.seasonalActions.removeCustomEvent(match.id);
                } else {
                    console.warn('[applyConfigAction] Festividad personalizada no encontrada:', targetName);
                }
            } else {
                console.warn('[applyConfigAction] customEvent requiere subvalor "add"|"remove":', subvalor);
            }
            break;
        }

        // --------------------------------------------------------
        // TEXTO / IMAGEN (set_config) — useConfigPersistence
        // --------------------------------------------------------
        case 'textApiKey':
            ctx.handleTextApiKeyCommit?.(valor);
            break;
        case 'textModel':
            ctx.handleTextModelCommit?.(valor);
            break;
        case 'textApiUrl':
            ctx.handleTextApiUrlCommit?.(valor);
            break;
        case 'imageApiKey':
            ctx.handleImageApiKeyCommit?.(valor);
            break;
        case 'imageModel':
            ctx.handleImageModelCommit?.(valor);
            break;
        case 'imageApiUrl':
            ctx.handleImageApiUrlCommit?.(valor);
            break;
        case 'ocrApiKey':
            ctx.handleOcrApiKeyCommit?.(valor);
            break;
        case 'ocrModel':
            ctx.handleOcrModelCommit?.(valor);
            break;
        case 'ocrApiUrl':
            ctx.handleOcrApiUrlCommit?.(valor);
            break;

        // --------------------------------------------------------
        // GENERAL (set_config)
        // --------------------------------------------------------
        case 'language': {
            if ((UI_LANGUAGES as readonly string[]).includes(valor)) {
                ctx.setLanguage?.(valor as 'es' | 'en' | 'both');
            } else {
                console.warn('[applyConfigAction] Idioma inválido:', valor);
            }
            break;
        }
        case 'sessionRole':
            ctx.setSessionRole?.(valor);
            break;

        // --------------------------------------------------------
        // VOZ (set_config → setVoiceConfig)
        // --------------------------------------------------------
        case 'voiceSpeed': {
            // Velocidad TTS: el catálogo admite 0.1-10.0 pero se acota al
            // rango seguro del slider de la UI (0.5-2.0).
            const speed = Number.parseFloat(valor);
            if (!Number.isNaN(speed) && speed >= 0.1 && speed <= 10.0) {
                const clamped = Math.min(2.0, Math.max(0.5, speed));
                ctx.setVoiceConfig?.({ rate: clamped });
            }
            break;
        }
        case 'voiceNumber': {
            applyNumberConfig(entry, valor, (n) => {
                ctx.setVoiceConfig?.({ [entry.clave]: n } as Partial<VoiceConfig>);
            });
            break;
        }
        case 'voice': {
            // Match por voiceURI exacto → nombre exacto → coincidencia parcial.
            const voices = ctx.voices ?? [];
            const target = valor.trim();
            if (!target) break;
            const exact = voices.find((v) => v.voiceURI === target || v.name === target);
            const partial = !exact
                ? voices.find(
                      (v) =>
                          v.name.toLowerCase().includes(target.toLowerCase()) ||
                          v.voiceURI.toLowerCase().includes(target.toLowerCase()),
                  )
                : undefined;
            const selected = exact ?? partial;
            if (selected) {
                ctx.setVoiceConfig?.({ voiceURI: selected.voiceURI, voiceName: selected.name });
            } else {
                console.warn('[applyConfigAction] Voz no encontrada (¿voces aún cargándose?):', target);
            }
            break;
        }

        // --------------------------------------------------------
        // PERSONALIDAD (set_config → setPersonality)
        // --------------------------------------------------------
        case 'personalityTraits': {
            const trait = valor.trim();
            if (!trait) break;
            const current = useIntegrationStore.getState().config.personality?.traits ?? [];
            const mode = subvalor?.trim().toLowerCase();
            let next: string[];
            if (mode === 'add' || mode === 'agregar' || mode === 'añadir') {
                next = current.includes(trait) ? current : [...current, trait];
            } else if (mode === 'remove' || mode === 'quitar' || mode === 'eliminar') {
                next = current.filter((t) => t !== trait);
            } else {
                console.warn('[applyConfigAction] traits requiere subvalor "add"|"remove":', subvalor);
                break;
            }
            ctx.setPersonality?.({ traits: next } as Partial<PersonalityConfig>);
            break;
        }
        case 'personalitySelect': {
            if (entry.opciones && !entry.opciones.includes(valor)) {
                console.warn(`[applyConfigAction] Valor inválido para "${entry.clave}":`, valor);
                break;
            }
            ctx.setPersonality?.({ [entry.clave]: valor } as Partial<PersonalityConfig>);
            break;
        }
        case 'personalityText': {
            ctx.setPersonality?.({ [entry.clave]: valor } as Partial<PersonalityConfig>);
            break;
        }
        case 'personalityNumber': {
            applyNumberConfig(entry, valor, (n) => {
                ctx.setPersonality?.({ [entry.clave]: n } as Partial<PersonalityConfig>);
            });
            break;
        }

        // --------------------------------------------------------
        // AVANZADO (set_config → setAdvancedConfig)
        // Claves del catálogo == campos de AdvancedConfig.
        // --------------------------------------------------------
        case 'advancedNumber': {
            applyNumberConfig(entry, valor, (n) => {
                ctx.setAdvancedConfig?.({ [entry.clave]: n } as Partial<AdvancedConfig>);
            });
            break;
        }

        // --------------------------------------------------------
        // IMAGEN DEL AVATAR (set_config → setImageConfig)
        // Claves del catálogo == campos de ImageConfig.
        // --------------------------------------------------------
        case 'imageBoolean': {
            const enabled = parseBoolean(valor);
            if (enabled !== null) {
                ctx.setImageConfig?.({ [entry.clave]: enabled } as Partial<ImageConfig>);
            } else {
                console.warn(`[applyConfigAction] Booleano inválido para "${entry.clave}":`, valor);
            }
            break;
        }

        // --------------------------------------------------------
        // COLORES DEL AVATAR (set_config → BunnyStore)
        // --------------------------------------------------------
        case 'avatarColor': {
            // Formato: "component:color" (ej. "Bunny_pants:#8B4513")
            const [component, color] = valor.split(':');
            if (component && color && isBunnyComponent(component)) {
                ctx.setComponentColor?.(component, color);
            } else {
                console.warn('[applyConfigAction] avatarColor requiere "componente:color":', valor);
            }
            break;
        }
        case 'avatarComponentColor': {
            const map: Record<string, BunnyComponent> = {
                pantsColor: 'Bunny_pants',
                bodyColor: 'Bunny_body',
                faceColor: 'Bunny_face',
            };
            const component = map[entry.clave];
            if (component) {
                ctx.setComponentColor?.(component, valor);
            }
            break;
        }
        case 'resetAvatarColors': {
            ctx.resetComponentColors?.();
            break;
        }

        // --------------------------------------------------------
        // MOTOR IA / PERFIL (set_config)
        // --------------------------------------------------------
        case 'aiProvider': {
            if ((AI_PROVIDERS as readonly string[]).includes(valor)) {
                ctx.handleSetAiProvider?.(valor);
            } else {
                console.warn('[applyConfigAction] Proveedor IA inválido:', valor);
            }
            break;
        }
        case 'applyProfile': {
            if ((FLU_PROFILE_IDS as readonly string[]).includes(valor)) {
                ctx.applyProfile?.(valor as FluProfile);
            } else {
                console.warn('[applyConfigAction] Perfil inválido:', valor);
            }
            break;
        }
        case 'wakeWords': {
            const word = valor.trim();
            if (!word) break;
            const mode = subvalor?.trim().toLowerCase();
            const current = (ctx.wakeWordsRef?.current ?? '')
                .split('\n')
                .map((w) => w.trim())
                .filter(Boolean);
            let next: string[];
            if (mode === 'add' || mode === 'agregar' || mode === 'añadir') {
                next = current.includes(word) ? current : [...current, word];
            } else if (mode === 'remove' || mode === 'quitar' || mode === 'eliminar') {
                next = current.filter((w) => w !== word);
            } else {
                console.warn('[applyConfigAction] wakeWords requiere subvalor "add"|"remove":', subvalor);
                break;
            }
            ctx.setWakeWords?.(next.join('\n'));
            break;
        }
        case 'debugLogs': {
            const enabled = parseBoolean(valor);
            if (enabled !== null) {
                ctx.setDebugLogsEnabled?.(enabled);
            } else {
                console.warn('[applyConfigAction] Booleano inválido para debugLogs:', valor);
            }
            break;
        }
        case 'clearCache': {
            ctx.handleClearCache?.();
            break;
        }

        default:
            console.warn('[applyConfigAction] Handler no implementado:', entry.handler);
    }
}
