/**
 * configSnapshot.ts — DUENO UNICO de la copia defensiva del config de un servicio.
 *
 * POR QUE EXISTE (auditoria 2026-10-09): los cuatro servicios de autonomia devolvian el
 * MISMO getConfig(): X { return { ...this.config } } cambiando solo el tipo (P9.41). Aqui
 * vive la copia una vez; cada servicio la envuelve.
 */

/**
 * Copia superficial del config (el llamante no puede mutar el estado del servicio).
 * @param config config declarado por el servicio
 * @returns una copia con las mismas claves
 */
export function snapshotConfig<C extends object>(config: C): C {
    return Object.assign({}, config) as C;
}
