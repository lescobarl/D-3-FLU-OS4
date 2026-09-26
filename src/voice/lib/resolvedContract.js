/**
 * Construcción del contrato RESUELTO de un turno (extraído de
 * useFluVoiceAssistant, god-file con trinquete de tamaño). Función PURA.
 *
 * Regla única de idempotencia con los fast-path deterministas: si el Árbitro ya
 * aplicó configuración / juego / ambiente en este turno, se ANULA esa parte del
 * contrato tardío del modelo para no duplicar el efecto; si no hubo fast-path, se
 * conserva la resolución determinista sobre la del modelo.
 */
export function buildResolvedContract({ contract, lateStateful, fastPathConfig, fastGame, fastEnv }) {
    return {
        ...contract.contract,
        respuesta_voz: contract.contract.respuesta_voz,
        navegacion: contract?.contract?.navegacion || {
            comando: null,
            destino: null,
            parametros: {},
        },
        // Idempotencia fast-path de configuración: se anula el contrato tardío si el
        // Árbitro ya aplicó la configuración (evita el doble efecto).
        configuracion: fastPathConfig?.accion
            ? null
            : lateStateful.config?.accion
                ? lateStateful.config
                : contract?.contract?.configuracion,
        // Idempotencia de juego: si el fast-path ya despachó (start/turn/end) se anula
        // el `juego` tardío; la voz del turno la habló el motor local.
        juego: fastGame?.gameId ? null : contract?.contract?.juego ?? null,
        // Idempotencia de ambiente: si el fast-path ya despachó (activar/reset) se anula
        // el `ambiente` tardío (ni rebranding ni bienvenida duplicados).
        ambiente: fastEnv?.tipo
            ? null
            : lateStateful.env?.tipo
                ? lateStateful.env
                : contract?.contract?.ambiente ?? null,
    }
}
