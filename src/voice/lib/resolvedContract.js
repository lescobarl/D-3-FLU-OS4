import { isCatalogLevelGameAction } from './gameCommands.js'

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
    // UN TURNO, UN DUENO DE LA VOZ. Los fast-path de juego y ambiente traen
    // `respuesta_voz: ''` porque el motor local (juegos/ambientes) habla el turno
    // el mismo. Si se conserva la `respuesta_voz` del modelo, el turno tiene DOS
    // duenos: el motor canta la carta nueva y el LLM, que no ve el mazo, dice la
    // suya (inventada o repetida). Defecto medido (log del dueno 2026-09-28
    // 22:19:39 y 22:19:56, loteria activa): la MISMA carta dos veces -> sintoma
    // "cada 2 turnos de nueva carta no hace nada". Mismo criterio que
    // `resolveDeterministicCourtesySpeech`, que ya devuelve '' para juego/ambiente.
    // Configuracion NO entra aqui: su accion no habla sola, asi que conserva la
    // respuesta del modelo como confirmacion verbal.
    const fastPathOwnsSpeech = Boolean(
        fastGame?.gameId || isCatalogLevelGameAction(fastGame) || fastEnv?.tipo,
    )
    return {
        ...contract.contract,
        respuesta_voz: fastPathOwnsSpeech ? '' : contract.contract.respuesta_voz,
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
