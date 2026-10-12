import { useRef } from 'react';

/**
 * PUENTE de la sesion de IDENTIDAD (clusters vivos + hablante primario).
 *
 * POR QUE EXISTE: el registro del nombre propio tiene UN dueno
 * (`registerSpeakerIdentity`) y lo llaman DOS rutas: el commit del stream (tiene los
 * refs del hook) y el COMANDO de voz (`handleNavigationCommand`, que NO los tiene).
 * Sin el puente, la ruta del comando registraba a medias: no cosia las etiquetas de la
 * MISMA voz (sin clusters) ni fijaba el primario. Ese era el "caso 3/4" vivo.
 *
 * REGLA (7.7.c, un dominio un almacen): aqui NO hay estado propio. Es un PUNTERO a los
 * refs del hook, que se publican en cada render. El dueno de los refs sigue siendo el
 * hook; el consumidor del comando solo LEE la MISMA instancia (no hay segundo almacen
 * que pueda divergir).
 *
 * POR QUE VIVE EN src/app (y no en el god-file): el trinquete de tamano de
 * useFluVoiceAssistant.js no admite crecer (regla 7.6: recorta esas N lineas donde toca).
 */
export interface IdentitySessionRefs {
  /** Clusters vivos de hablante (el cosido de "misma voz" los necesita). */
  speakerClustersRef: { current: unknown[] };
  /** Hablante primario de la sesion (su dueno de precedencia es `setSessionPrimarySpeaker`). */
  sessionPrimarySpeakerRef: { current: string };
  /** Escritor unico de los clusters (el renombre por VOZ lo necesita). */
  setClusters: (clusters: unknown[]) => void;
  /**
   * P9.79: PUERTO a la BASE de participantes. Lo rellena la app (el hook solo publica
   * los refs de sesion) y lo consume el registro del nombre: la voz que dice su nombre
   * ENTRA en la base, no solo en las filas. Sin esto el nombre quedaba ligado a las
   * filas y el panel (que lee Dexie) no lo mostraba.
   */
  registerParticipant?: (name: string, speakerLabel?: string) => void | Promise<unknown>;
}

/**
 * Crea el puente vacio. El hook de voz lo RELLENA al montar
 * (`identitySession.current = { speakerClustersRef, sessionPrimarySpeakerRef }`).
 *
 * @returns ref mutable cuyo `.current` son los refs vivos (o null antes del primer render)
 */
export function useIdentitySessionRef() {
  return useRef<IdentitySessionRefs | null>(null);
}
