/**
 * intervalLifecycle.ts — DUENO UNICO del ciclo de vida por intervalo de los servicios
 * de autonomia: `start`/`stop`/`updateConfig`, con el intervalo como DATO.
 *
 * POR QUE EXISTE (P9.35): AutoOptimizationSystem, BackupSystem, DecisionEngine y
 * HealthMonitor repetian el MISMO cuerpo de `stop`/`updateConfig` (y `start` en dos de
 * ellos) cambiando solo el campo del id y la clave del intervalo. Un solo dueno; cada
 * servicio aporta su `tick`.
 */
import { logCaughtError } from '../../lib/caughtError';

/** Ejecuta un tick asincrono y registra el fallo con su contexto (sin bucle de reintento). */
export function fireAndForget(work: () => Promise<unknown>, context: string): void {
    work().catch((error) => logCaughtError(context, error));
}

/** Config minima del ciclo de vida. */
export interface IntervalLifecycleConfig {
    /** Si es `false`, `start` no arranca (los servicios que no lo declaran usan su propio arranque). */
    enabled?: boolean;
    verboseLogging?: boolean;
}

/** Servicio con un intervalo de trabajo periodico. */
export abstract class IntervalLifecycle<C extends IntervalLifecycleConfig> {
    protected config: C;
    /** Id del intervalo vivo; lo posee la base (antes era un campo por servicio). */
    protected intervalId: number | null = null;

    private readonly intervalKey: keyof C;

    protected constructor(config: C, intervalKey: keyof C) {
        this.config = config;
        this.intervalKey = intervalKey;
    }

    /** Arranca el intervalo si esta habilitado y no hay uno vivo. */
    start(): void {
        if (this.intervalId !== null || this.config.enabled === false) return;
        this.intervalId = window.setInterval(() => this.tick(), Number(this.config[this.intervalKey]));
    }

    /** Detiene el intervalo (idempotente). */
    stop(): void {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /** Fusiona la config y reinicia si cambio el intervalo. */
    updateConfig(newConfig: Partial<C>): void {
        this.config = { ...this.config, ...newConfig };
        if (this.intervalId !== null && newConfig[this.intervalKey]) {
            this.stop();
            this.start();
        }
    }

    /** Un tick del servicio. */
    protected abstract tick(): void;
}
