// ============================================================
// Client Log Relay — envía logs del frontend al servidor
// ============================================================
// Roo (assistant) lee estos logs desde la terminal del servidor
// para depurar sin acceso al navegador.
//
// Control centralizado vía FLU_CONFIG.debug.relayToServer.
// Se apaga desde fluConfig.js o desde la consola:
//   window.__fluClientLog.enable(false)
// ============================================================

import { FLU_CONFIG } from '../voice/lib/fluConfig';

type LogLevel = 'LOG' | 'INFO' | 'WARN' | 'ERROR';

let enabled = true;
let pending: Array<{ level: LogLevel; tag: string; message: string; data?: unknown }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function syncEnabled(): boolean {
    return FLU_CONFIG.debug?.relayToServer !== false;
}

/**
 * Reporta un fallo del PROPIO relay: consola y nada mas.
 * Deliberadamente NO usa `logCaughtError`: esa via reenvia por el relay
 * (caughtError.ts:42-43 -> relayLog), de modo que un fallo de entrega se convertia en
 * una entrada nueva que reintentaba la entrega que acababa de fallar: bucle infinito.
 */
function reportOwnFailure(e: unknown): void {
    try {
        console.error('[catch] src/lib/clientLogRelay.ts', e);
    } catch {
        /* ignorado: la consola no esta disponible en este contexto */
    }
}

function flush() {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
        // Always send as array so server handler can iterate uniformly
        // Sending single object vs array causes server-side parsing failures
        // for batched entries, losing all relayLog diagnostics.
        fetch('/__flu_client_log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
        }).catch((e: unknown) => reportOwnFailure(e));
    } catch (e) {
        reportOwnFailure(e);
    }
}

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
    }, 200);
}

/**
 * Enviar un log al servidor.
 * @param level - Nivel del log
 * @param tag - Etiqueta (ej: 'BunnyViewer', 'AvatarVoiceSync')
 * @param message - Mensaje descriptivo
 * @param data - Datos opcionales (objeto)
 */
export function relayLog(level: LogLevel, tag: string, message: string, data?: unknown): void {
    if (!enabled) return;
    if (!syncEnabled()) return;
    pending.push({ level, tag, message, data });
    scheduleFlush();
}

/**
 * Activar/desactivar el relay de logs.
 * @param on - true para activar, false para desactivar
 */
export function setRelayEnabled(on: boolean): void {
    enabled = on;
}

/**
 * Forzar envío inmediato de logs pendientes.
 */
export function flushLogs(): void {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    flush();
}

// Exponer control en window para调试 desde consola del navegador (solo DEV)
if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__fluClientLog = {
        enable: (on: boolean) => setRelayEnabled(on),
        flush: flushLogs,
        status: () => ({ enabled, relayToServer: syncEnabled() }),
    };
}
