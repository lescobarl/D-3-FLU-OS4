/**
 * COMANDO DE PREPARACIÓN DE VALIDACIÓN — SOLO DESARROLLO.
 *
 * Problema que resuelve: la base de participantes vive en IndexedDB del navegador
 * del dueño. Un agente que corre en la terminal no puede abrir el perfil de Chrome
 * (no hay puerto de depuración remota) ni ejecutar JavaScript en su pestaña. Este
 * módulo da una vía REAL y acotada: se abre la app con `?fluDev=<comando>` en el
 * MISMO perfil de Chrome (mismo origen → mismo IndexedDB) y la app ejecuta el
 * comando desde dentro.
 *
 * Comandos:
 *   • `prepare-validation` — invalida todos los vectores de voz vivos, da de baja
 *     lógica a los participantes (excepto el anónimo configurado), limpia su
 *     onboarding y el usuario activo, y ENCIENDE la grabación de sesión.
 *   • `reset-participants` — solo la limpieza de la base.
 *   • `recorder-on` — solo enciende la grabación.
 *
 * Reglas respetadas:
 *   • Borrado LÓGICO (`deleted: true`), nunca físico (AGENTS §1.7): se usa el
 *     registro como dueño de la escritura y su auditoría.
 *   • El nombre del anónimo y los roles salen de `FLU_CONFIG.multiuser`; nada
 *     hardcodeado.
 *   • Tras ejecutar, emite un `relayLog` con el resultado medido (queda en
 *     `debug.log`) y avisa por `BroadcastChannel` para que las demás pestañas
 *     recarguen su estado en memoria.
 */
import { FLU_CONFIG } from '../voice/lib/fluConfig.js';
import { fluDb } from '../core/db/fluDatabase';
import {
    createParticipantRegistry,
    resolveKindRole,
    type ParticipantRegistry,
} from '../core/multiuser/participantRegistry';
import { createOnboardingService } from '../core/onboarding/onboardingService';
import { DEFAULT_VOICE_CONFIG, STORAGE_KEYS } from '../core/config/appConfig';
import { localGet, localRemove } from '../core/storage/localStore';
import {
    enableSessionRecorder,
    getSessionRecordingStatus,
} from '../voice/lib/sessionRecorder.js';
import { flushLogs, relayLog } from './clientLogRelay';
import { logCaughtError } from './caughtError';

/** Canal entre pestañas del mismo origen: avisa que el estado debe recargarse. */
export const DEV_VALIDATION_CHANNEL = 'flu-dev-validation';

/** Parámetro de URL que dispara un comando de desarrollo. */
export const DEV_VALIDATION_PARAM = 'fluDev';

interface ResetResult {
    invalidated: number;
    removed: number;
    remaining: string[];
    activeUserCleared: boolean;
}

/**
 * Construye el registro de participantes con la MISMA configuración que
 * `useParticipants` (el hook sigue siendo el dueño del flujo de usuario).
 */
function createValidationRegistry(): { registry: ParticipantRegistry; anonymousName: string } {
    const config = (FLU_CONFIG.multiuser || {}) as Record<string, unknown>;
    const roles = Array.isArray(config.roles) ? (config.roles as readonly string[]) : [];
    const defaultVoice = { ...DEFAULT_VOICE_CONFIG, ...((config.defaultVoice as object) || {}) };
    const birthdayAdvanceDays = Number(config.birthdayAdvanceDays) || 7;
    const skipDefaults = (config.skipDefaults as Record<string, unknown>) || {};
    const anonymousName = String(skipDefaults.anonymousName || 'Anónimo');
    const anonymousKind = String(skipDefaults.defaultKind || 'niño');
    const anonymousRole =
        resolveKindRole(anonymousKind, (config.kindToRole as Record<string, string>) || {}) ||
        'Estudiante';

    const registry = createParticipantRegistry({
        db: fluDb.participants,
        config: {
            roles,
            defaultVoice,
            birthdayAdvanceDays,
            anonymous: { name: anonymousName, role: anonymousRole },
        },
        now: () => Date.now(),
    });
    return { registry, anonymousName };
}

/**
 * Invalida vectores y da de baja lógica a todos los participantes salvo el
 * anónimo configurado. El vector se limpia ANTES de la baja para que incluso la
 * fila histórica quede sin un número viejo que pueda sembrar un nombre.
 *
 * @param registry registro dueño de la tabla de participantes
 * @param anonymousName nombre del perfil anónimo que no se elimina
 */
async function resetParticipantBase(
    registry: ParticipantRegistry,
    anonymousName: string,
): Promise<ResetResult> {
    // Modelo vacío ⇒ ninguna fila es comparable ⇒ se purga TODO vector, verificado o no.
    const invalidated = await registry.invalidateVoiceAnchors({ model: '' });
    const alive = await registry.list();
    const onboarding = createOnboardingService({ db: fluDb.onboardingStates });
    const removedIds: string[] = [];
    const remaining: string[] = [];
    const remainingIds: string[] = [];

    for (const participant of alive) {
        if (participant.name.toLowerCase() === anonymousName.toLowerCase()) {
            remaining.push(participant.name);
            remainingIds.push(participant.id);
            continue;
        }
        if (!(await registry.remove(participant.id))) {
            remaining.push(participant.name);
            remainingIds.push(participant.id);
            continue;
        }
        removedIds.push(participant.id);
        try {
            await onboarding.reset(participant.id);
        } catch (error) {
            logCaughtError('devValidationReset.onboardingReset', error, {
                participantId: participant.id,
            });
        }
    }

    let activeUserCleared = false;
    try {
        const active = localGet(STORAGE_KEYS.ACTIVE_USER);
        // Solo se limpia si apuntaba a una baja (o a un id que ya no existe);
        // el anónimo puede seguir siendo el usuario activo.
        if (active && !remainingIds.includes(active)) {
            localRemove(STORAGE_KEYS.ACTIVE_USER);
            activeUserCleared = true;
        }
    } catch (error) {
        logCaughtError('devValidationReset.activeUser', error);
    }

    return {
        invalidated,
        removed: removedIds.length,
        remaining,
        activeUserCleared,
    };
}

/**
 * Ejecuta un comando de preparación y deja el resultado en `debug.log`.
 *
 * @param command valor de `?fluDev=` (`prepare-validation`, `reset-participants`, `recorder-on`)
 * @returns true si el comando era conocido y se ejecutó
 */
export async function runDevValidationCommand(command: string | null): Promise<boolean> {
    if (!import.meta.env.DEV || !command) return false;

    try {
        let result: ResetResult | null = null;
        if (command === 'prepare-validation' || command === 'reset-participants') {
            const { registry, anonymousName } = createValidationRegistry();
            result = await resetParticipantBase(registry, anonymousName);
        }

        let recorderOn = false;
        if (command === 'prepare-validation' || command === 'recorder-on') {
            recorderOn = enableSessionRecorder();
        }

        relayLog('INFO', 'DevValidation', command, {
            ...(result || {}),
            recorderOn,
            recorder: getSessionRecordingStatus(),
        });
        flushLogs();

        // Quita el comando de la URL ANTES de avisar: si esta pestaña se recarga
        // por el aviso de otra, ya no vuelve a ejecutarlo (corta el bucle).
        if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', '/');
        }

        if (typeof BroadcastChannel !== 'undefined') {
            const channel = new BroadcastChannel(DEV_VALIDATION_CHANNEL);
            channel.postMessage({ type: 'reload', command });
            channel.close();
        }

        // Margen para que el relay entregue el resultado antes de navegar.
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (typeof window !== 'undefined') window.location.replace('/');
        return true;
    } catch (error) {
        logCaughtError('devValidationReset.run', error, { command });
        relayLog('ERROR', 'DevValidation', 'fallo', {
            command,
            message: error instanceof Error ? error.message : String(error),
        });
        flushLogs();
        return false;
    }
}
