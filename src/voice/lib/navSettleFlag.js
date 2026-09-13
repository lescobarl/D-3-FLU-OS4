// ============================================================
// navSettleFlag — estado compartido del asentamiento de navegación.
// ------------------------------------------------------------
// `useNavigationCommands.scheduleNavSettle` recibe la misma locución varias
// veces (parcial → completo) y ejecuta la ÚLTIMA cuando el turno se asienta.
// Mientras hay un settle pendiente, una captura que extiende a la anterior es
// una CORRECCIÓN, no una re-emisión: el dedup de `processCapture` NO debe
// descartarla (si la descarta, se ejecuta el parcial y la búsqueda sale
// truncada). Esta bandera comunica ese estado sin acoplar los hooks.
// ============================================================
let pending = false;

export function setNavSettlePending(value) {
    pending = Boolean(value);
}

export function isNavSettlePending() {
    return pending;
}
