// ============================================================
// navSettleFlag — estado compartido del asentamiento de navegación.
// ------------------------------------------------------------
// `useNavigationCommands.scheduleNavSettle` recibe la misma locución varias
// veces (parcial → completo) y ejecuta la ÚLTIMA cuando el turno se asienta.
// Mientras hay un settle pendiente, una captura que extiende a la anterior es
// una CORRECCIÓN, no una re-emisión: el dedup de `processCapture` NO debe
// descartarla (si la descarta, se ejecuta el parcial y la búsqueda sale
// truncada). Esta bandera comunica ese estado sin acoplar los hooks.
//
// DEFECTO MEDIDO (dueño, 2026-10-12 21:16): el asentamiento se apagaba SOLO desde su
// `setTimeout`, así que un temporizador retardado (pestaña en segundo plano, bucle
// pesado) dejaba la bandera ENCENDIDA: `processCapture` descartaba TODAS las capturas y
// FLU quedaba congelado sin transcribir ni responder — y al vaciarse, "ponía todo de un
// solo golpe" y la respuesta llegaba minutos tarde (medido: respuesta del turno 21:16:59
// a las 21:37:48). La bandera NO puede sobrevivir a su propio plazo: ahora lleva VENCE y
// se apaga sola al cumplirlo, aunque el temporizador nunca llegue.
// ============================================================

import { FLU_CONFIG } from './fluConfig.js';

/** Vence (epoch ms) del asentamiento en vuelo; 0 = no hay asentamiento. */
let pendingUntilMs = 0;

/** Plazo por defecto: el MISMO que usa el temporizador del asentamiento (config). */
function getSettlePlazoMs() {
    return Number(FLU_CONFIG?.timing?.searchCommandSettleMs) || 2800;
}

/**
 * Enciende/apaga el asentamiento en vuelo.
 *
 * @param value `true` = hay un asentamiento pendiente.
 * @param ttlMs Plazo REAL del asentamiento (el mismo que su temporizador). Con `true` es
 *   obligatorio: es el único modo de que la bandera no pueda colgar el pipeline.
 */
export function setNavSettlePending(value, ttlMs = 0) {
    const ttl = Number(ttlMs) || Number(getSettlePlazoMs()) || 0;
    pendingUntilMs = value ? Date.now() + ttl : 0;
}

/** ¿Hay un asentamiento pendiente VIGENTE? Uno vencido no bloquea nada. */
export function isNavSettlePending() {
    return pendingUntilMs > 0 && Date.now() < pendingUntilMs;
}
