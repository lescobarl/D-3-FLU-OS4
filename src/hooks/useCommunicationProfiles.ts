// ============================================================
// useCommunicationProfiles — Personalización profunda (FASE P)
// ------------------------------------------------------------
// Hook que gestiona los perfiles de comunicación por persona
// (nivel de explicación + tono) sobre Dexie
// (fluDb.communicationProfiles) vía communicationProfileService.
//
// Cumple:
//   - Regla #1: NO HARDCODE — niveles, tonos y TTS desde
//     FLU_CONFIG.personalization (fuente de verdad)
//   - Obligación #5: auditoría (la hace communicationProfileService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace el service)
//   - FASE P: manual > auto > default en cada turno
//   - DI: now inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb, type CommunicationProfileRecord } from '../core/db/fluDatabase';
import { logCaughtError } from '../lib/caughtError';
import {
  createCommunicationProfileService,
  type CommunicationProfileConfig,
  type CommunicationProfileService,
  type ManualProfilePatch,
  type ResolvedCommunicationProfile,
} from '../core/personalization/communicationProfileService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseCommunicationProfilesOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface CommunicationProfilesState {
  profiles: CommunicationProfileRecord[];
  loading: boolean;
}

export interface CommunicationProfilesActions {
  refresh: () => Promise<void>;
  ensure: (
    participantId: string,
    participantName?: string,
  ) => Promise<CommunicationProfileRecord>;
  setManual: (
    participantId: string,
    patch: ManualProfilePatch,
    participantName?: string,
  ) => Promise<CommunicationProfileRecord>;
  resetPerson: (participantId: string) => Promise<boolean>;
  applyObservation: (
    participantId: string,
    text: string,
    participantName?: string,
  ) => Promise<CommunicationProfileRecord | null>;
  resolveForTurn: (participantId: string) => Promise<ResolvedCommunicationProfile>;
}

export interface UseCommunicationProfilesResult
  extends CommunicationProfilesState,
    CommunicationProfilesActions {
  service: CommunicationProfileService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useCommunicationProfiles({
  now,
}: UseCommunicationProfilesOptions = {}): UseCommunicationProfilesResult {
  // FASE P: configuración desde FLU_CONFIG.personalization (fuente de verdad).
  const config = (FLU_CONFIG.personalization || {}) as CommunicationProfileConfig;

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<CommunicationProfileService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createCommunicationProfileService({
      // Adaptador de la tabla Dexie a CommunicationProfilesDb: la clave
      // lógica es participantId (el id físico es un UUIDv4).
      db: {
        add: (record) => fluDb.communicationProfiles.add(record),
        put: (record) => fluDb.communicationProfiles.put(record),
        getByParticipant: (participantId) =>
          fluDb.communicationProfiles.where('participantId').equals(participantId).first(),
        toArray: () => fluDb.communicationProfiles.toArray(),
      },
      config,
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  const [profiles, setProfiles] = useState<CommunicationProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);

  /** Recarga los perfiles desde IndexedDB (ordenados por nombre). */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await service.list();
      setProfiles(all);
    } catch (err) {
      logCaughtError('[useCommunicationProfiles] refresh error', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  /** Asegura el perfil de una persona y refresca el listado. */
  const ensure = useCallback(
    async (participantId: string, participantName?: string): Promise<CommunicationProfileRecord> => {
      const record = await service.ensure(participantId, participantName);
      await refresh();
      return record;
    },
    [service, refresh],
  );

  /** Fija manualmente el nivel/tono de una persona y refresca el listado. */
  const setManual = useCallback(
    async (
      participantId: string,
      patch: ManualProfilePatch,
      participantName?: string,
    ): Promise<CommunicationProfileRecord> => {
      const record = await service.setManual(participantId, patch, participantName);
      await refresh();
      return record;
    },
    [service, refresh],
  );

  /** Quita las preferencias manuales de una persona y refresca el listado. */
  const resetPerson = useCallback(
    async (participantId: string): Promise<boolean> => {
      const ok = await service.resetPerson(participantId);
      if (ok) await refresh();
      return ok;
    },
    [service, refresh],
  );

  /** Aplica una observación (texto de la persona) y refresca si hubo señal. */
  const applyObservation = useCallback(
    async (
      participantId: string,
      text: string,
      participantName?: string,
    ): Promise<CommunicationProfileRecord | null> => {
      const record = await service.applyObservation(participantId, text, participantName);
      if (record) await refresh();
      return record;
    },
    [service, refresh],
  );

  /** Perfil resuelto para un turno (manual > auto > default). No persiste. */
  const resolveForTurn = useCallback(
    async (participantId: string): Promise<ResolvedCommunicationProfile> =>
      service.resolveForTurn(participantId),
    [service],
  );

  return {
    service,
    profiles,
    loading,
    refresh,
    ensure,
    setManual,
    resetPerson,
    applyObservation,
    resolveForTurn,
  };
}
