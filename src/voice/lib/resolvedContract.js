import { isCatalogLevelGameAction } from './gameCommands.js'

/**
 * Construcción del contrato RESUELTO de un turno (extraído de
 * useFluVoiceAssistant, god-file con trinquete de tamaño). Función PURA.
 *
 * Regla única de idempotencia con los fast-path deterministas: si el Árbitro ya
 * aplicó configuración / juego / ambiente / música en este turno, se ANULA esa parte del
 * contrato tardío del modelo para no duplicar el efecto; si no hubo fast-path, se
 * conserva la resolución determinista sobre la del modelo.
 */
/**
 * Regla UNICA de idempotencia de los dominios de estado del fast-path (configuracion,
 * juego, ambiente, musica). Vivia COPIADA en los TRES sitios que arman el contrato
 * resuelto de un turno (esta funcion y las dos ramas de la captura del hook): al anadir
 * musica habia que tocar los tres y el que se olvidara dejaba DOS duenos del efecto.
 */
export function estadoFastPathIdempotente({ fastPathConfig, fastGame, fastEnv, lateStateful, contract }) {
    const delModelo = contract?.contract
    return {
        configuracion: fastPathConfig?.accion
            ? null
            : lateStateful?.config?.accion
                ? lateStateful.config
                : delModelo?.configuracion,
        juego: fastGame?.gameId ? null : delModelo?.juego ?? null,
        ambiente: fastEnv?.tipo
            ? null
            : lateStateful?.env?.tipo
                ? lateStateful.env
                : delModelo?.ambiente ?? null,
        musica: lateStateful?.music?.accion ? null : delModelo?.musica ?? null,
    }
}
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
    // respuesta del modelo como confirmacion verbal. MUSICA SI entra (P8.55): su
    // dueno determinista ya dice la frase del turno (musicActionSpeech) y el
    // modelo, sin saber que la orden era un control, respondia "Alto." a "alto".
    const fastPathOwnsSpeech = Boolean(
        fastGame?.gameId || isCatalogLevelGameAction(fastGame) || fastEnv?.tipo || lateStateful?.music?.accion,
    )
    return {
        ...contract.contract,
        respuesta_voz: fastPathOwnsSpeech ? '' : contract.contract.respuesta_voz,
        navegacion: contract?.contract?.navegacion || {
            comando: null,
            destino: null,
            parametros: {},
        },
        ...estadoFastPathIdempotente({ fastPathConfig, fastGame, fastEnv, lateStateful, contract }),
    }
}
