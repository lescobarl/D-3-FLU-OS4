/**
 * Migracion UNICA del sufijo de confirmacion pegado a un nombre (`Luis Registrado`).
 *
 * POR QUE ES UN MODULO Y NO UN `useEffect`: la migracion toca DOS duenos (la base de
 * participantes y las filas del historial). La regla vive aqui, con los duenos
 * inyectados por puertos; el hook solo la dispara una vez. Antes el `useEffect` del
 * hook borraba participantes y reescribia filas con acceso directo al store.
 */
import { baseNameWithoutConfirmationSuffix } from '../../lib/confirmationSuffix';

export interface RepairParticipant {
  id: string;
  name?: string;
}

export interface RepairRow {
  id: string;
  speakerId?: string;
  speakerName?: string;
}

export interface ConfirmationNameRepairPorts {
  listParticipants: () => Promise<RepairParticipant[]>;
  removeParticipant: (id: string) => Promise<unknown>;
  /** Filas del usuario del epoch VIGENTE (el dueño decide el filtro). */
  userRowsOfCurrentEpoch: () => RepairRow[];
  /** Escritura del nombre de la fila (dueño: el store del historial). */
  setRowSpeakerName: (id: string, name: string) => void;
  /** Etiqueta de respaldo de una voz (dueño: conversationRow). */
  fallbackNameForSpeakerId: (speakerId: string) => string;
}

export interface ConfirmationNameRepairResult {
  removed: number;
  rowsRenamed: number;
}

/**
 * Borra el participante duplicado (`"<base> <sufijo>"` cuando existe `"<base>"`) y
 * devuelve sus filas a la etiqueta de su voz. No toca al participante base ni otras
 * voces. Idempotente por construccion: si no hay duplicados no cambia nada.
 */
export async function repairConfirmationNameDuplicates(
  ports: ConfirmationNameRepairPorts,
): Promise<ConfirmationNameRepairResult> {
  const all = await ports.listParticipants();
  const byName = new Map(
    all.map((participant) => [String(participant.name || '').trim().toLowerCase(), participant]),
  );
  const duplicates = all.filter((participant) => {
    const base = baseNameWithoutConfirmationSuffix(participant.name);
    if (!base) return false;
    const name = String(participant.name || '').trim().toLowerCase();
    return byName.has(base.toLowerCase()) && base.toLowerCase() !== name;
  });

  let rowsRenamed = 0;
  for (const duplicate of duplicates) {
    await ports.removeParticipant(duplicate.id);
    const objetivo = String(duplicate.name || '').trim();
    for (const row of ports.userRowsOfCurrentEpoch()) {
      if (String(row.speakerName || '').trim() !== objetivo) continue;
      const fallback = ports.fallbackNameForSpeakerId(String(row.speakerId || ''));
      if (fallback && fallback !== row.speakerName) {
        ports.setRowSpeakerName(row.id, fallback);
        rowsRenamed += 1;
      }
    }
  }

  return { removed: duplicates.length, rowsRenamed };
}
