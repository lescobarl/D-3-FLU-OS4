// ============================================================
// useParticipants — Registro de participantes (Fase 3, A3/A4/A5/B9)
// ------------------------------------------------------------
// Hook que gestiona el registro de participantes del hogar/equipo
// sobre Dexie (fluDb.participants) vía participantRegistry.
//
// Cumple:
//   - Regla #1: NO HARDCODE — límites y voces desde FLU_CONFIG.multiuser
//   - Obligación #5: auditoría (la hace participantRegistry)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace participantRegistry)
//   - A3: etiqueta de hablante → participante
//   - A4: perfil de asistente asignado (profileId)
//   - A5: voz TTS resuelta por participante (defaultVoice desde config)
//   - B9: cumpleaños próximos (participantsWithBirthdayNear)
//   - DI: now inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb, type ParticipantRecord } from '../core/db/fluDatabase';
import {
  createParticipantRegistry,
  resolveKindRole,
  type ParticipantInput,
  type ParticipantPatch,
  type ParticipantRegistry,
  type RegisterResult,
  type ResolvedTtsVoice,
  type UpsertResult,
} from '../core/multiuser/participantRegistry';
import { DEFAULT_VOICE_CONFIG, STORAGE_KEYS } from '../core/config/appConfig';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseParticipantsOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface ParticipantsState {
  participants: ParticipantRecord[];
  loading: boolean;
}

export interface ParticipantsActions {
  refresh: () => Promise<void>;
  register: (input: ParticipantInput) => Promise<RegisterResult>;
  upsert: (id: string, patch: ParticipantPatch) => Promise<UpsertResult>;
  remove: (id: string) => Promise<boolean>;
  /** Siembra el perfil anónimo por defecto si aún no existe (idempotente). */
  seedAnonymous: () => Promise<ParticipantRecord | undefined>;
  /** Devuelve el perfil anónimo por defecto si existe. */
  findAnonymous: () => Promise<ParticipantRecord | undefined>;
  resolveParticipantBySpeakerLabel: (
    speakerLabel?: string,
  ) => Promise<ParticipantRecord | undefined>;
  participantsWithBirthdayNear: (reference?: number) => Promise<ParticipantRecord[]>;
  resolveTtsVoice: (participant?: ParticipantRecord) => ResolvedTtsVoice;
}

export interface UseParticipantsResult extends ParticipantsState, ParticipantsActions {
  service: ParticipantRegistry;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useParticipants({ now }: UseParticipantsOptions = {}): UseParticipantsResult {
  const config = (FLU_CONFIG as any).multiuser || {};
  const roles = Array.isArray(config.roles) ? (config.roles as readonly string[]) : [];
  // A5: la voz base por defecto nunca se hardcodea; se parte de
  // DEFAULT_VOICE_CONFIG (config central) y se fusiona la sección
  // multiuser de FLU_CONFIG si el usuario la personalizó.
  const defaultVoice = { ...DEFAULT_VOICE_CONFIG, ...((config.defaultVoice as object) || {}) };
  const birthdayAdvanceDays = Number(config.birthdayAdvanceDays) || 7;
  // Perfil anónimo por defecto (config-driven vía multiuser.skipDefaults):
  // siempre existe desde el primer arranque, es el default activo y NO se
  // puede eliminar. `role` se deriva del defaultKind vía kindToRole.
  const skipDefaults = (config.skipDefaults as Record<string, unknown>) || {};
  const anonymousName = String(skipDefaults.anonymousName || 'Anónimo');
  const anonymousKind = String(skipDefaults.defaultKind || 'niño');
  const anonymousRole =
    resolveKindRole(anonymousKind, (config.kindToRole as Record<string, string>) || {}) || 'Estudiante';
  const anonymous = { name: anonymousName, role: anonymousRole };

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<ParticipantRegistry | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createParticipantRegistry({
      db: fluDb.participants,
      config: { roles, defaultVoice, birthdayAdvanceDays, anonymous },
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [loading, setLoading] = useState(true);

  /** Recarga el registro desde IndexedDB (ordenado alfabéticamente). */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await service.list();
      setParticipants(all);
    } catch (err) {
      console.error('[useParticipants] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  /** Siembra el perfil anónimo por defecto si aún no existe (idempotente). */
  const seedAnonymous = useCallback(
    async (): Promise<ParticipantRecord | undefined> => {
      const seeded = await service.seedAnonymous();
      if (seeded) await refresh();
      return seeded;
    },
    [service, refresh],
  );

  /** Devuelve el perfil anónimo por defecto si existe. */
  const findAnonymous = useCallback(
    async (): Promise<ParticipantRecord | undefined> => service.findAnonymous(),
    [service],
  );

  // Carga inicial: garantiza que "Anónimo Estudiante" exista desde el primer
  // arranque (default activo, no eliminable) y luego refresca el listado.
  useEffect(() => {
    seedAnonymous()
      .catch(console.error)
      .finally(() => refresh().catch(console.error));
  }, [seedAnonymous, refresh]);

  /** Registra un participante y refresca el listado. */
  const register = useCallback(
    async (input: ParticipantInput): Promise<RegisterResult> => {
      const result = await service.register(input);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Actualiza un participante existente y refresca el listado. */
  const upsert = useCallback(
    async (id: string, patch: ParticipantPatch): Promise<UpsertResult> => {
      const result = await service.upsert(id, patch);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Elimina un participante y refresca el listado. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const removed = await service.remove(id);
      if (removed) {
        // Limpieza de estado huérfano (bug "usuarios borrados que reaparecen"):
        // al eliminar un participante también se borra su onboarding per-user
        // (Dexie v14 onboardingStates) y, si era el usuario activo, se limpia
        // ACTIVE_USER. Sin esto, en la siguiente carga el id eliminado seguía
        // activo y su onboarding completado hacía que el perfil reapareciera.
        try {
          await fluDb.onboardingStates.delete(id);
        } catch (err) {
          console.error('[useParticipants] onboarding cleanup error:', err);
        }
        try {
          if (typeof window !== 'undefined') {
            const active = window.localStorage.getItem(STORAGE_KEYS.ACTIVE_USER);
            if (active === id) window.localStorage.removeItem(STORAGE_KEYS.ACTIVE_USER);
          }
        } catch (err) {
          console.error('[useParticipants] active-user cleanup error:', err);
        }
        await refresh();
      }
      return removed;
    },
    [service, refresh],
  );

  /** A3: resuelve la etiqueta de hablante de la diarización. */
  const resolveParticipantBySpeakerLabel = useCallback(
    async (speakerLabel?: string): Promise<ParticipantRecord | undefined> =>
      service.resolveParticipantBySpeakerLabel(speakerLabel),
    [service],
  );

  /** B9: participantes con cumpleaños dentro de la antelación configurada. */
  const participantsWithBirthdayNear = useCallback(
    async (reference?: number): Promise<ParticipantRecord[]> =>
      service.participantsWithBirthdayNear(reference),
    [service],
  );

  /** A5: voz TTS resuelta para el participante (o la base del config). */
  const resolveTtsVoice = useCallback(
    (participant?: ParticipantRecord): ResolvedTtsVoice =>
      service.resolveTtsVoice(participant),
    [service],
  );

  return {
    service,
    participants,
    loading,
    refresh,
    register,
    upsert,
    remove,
    seedAnonymous,
    findAnonymous,
    resolveParticipantBySpeakerLabel,
    participantsWithBirthdayNear,
    resolveTtsVoice,
  };
}
