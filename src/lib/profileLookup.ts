/**
 * profileLookup — búsqueda del perfil de un participante, dueño único.
 *
 * Antes cada panel resolvía `profiles.find(p => p.participantId === id)` por su
 * cuenta. El listado y la clave son datos del consumidor; la búsqueda es una.
 */

/**
 * Busca el perfil de un participante en un listado.
 * @param profiles Listado de perfiles.
 * @param participantId Id del participante.
 * @returns Perfil encontrado, o undefined.
 */
export function findProfileByParticipant<T extends { participantId?: string }>(
  profiles: readonly T[],
  participantId: string,
): T | undefined {
  return profiles.find((profile) => profile.participantId === participantId)
}
