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
import { useCallback, useEffect, useState } from 'react';
import { useServiceRef } from './useServiceRef';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb, type ParticipantRecord } from '../core/db/fluDatabase';
import {
  createParticipantRegistry,
  PARTICIPANTS_CHANGED_CHANNEL,
  resolveKindRole,
  type ParticipantInput,
  type ParticipantPatch,
  type ParticipantRegistry,
  type ParticipantRegisterResult,
  type ResolvedTtsVoice,
  type UpsertResult,
} from '../core/multiuser/participantRegistry';
import { DEFAULT_VOICE_CONFIG, STORAGE_KEYS } from '../core/config/appConfig';
import { createOnboardingService } from '../core/onboarding/onboardingService';
import { logCaughtError } from '../lib/caughtError';
import { localGet, localRemove, localSetSafe } from '../core/storage/localStore';
import { voiceVectorModel } from '../voice/lib/speakerDirectory';
import { speakerIdToDefaultName } from '../voice/lib/conversationRow.js';
import { useIntegrationStore } from '../store/integrationStore';

/** Gateway único de la tabla onboardingStates (C44: un solo escritor). */
const onboardingGateway = createOnboardingService({ db: fluDb.onboardingStates });

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
  register: (input: ParticipantInput) => Promise<ParticipantRegisterResult>;
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
  const config = FLU_CONFIG.multiuser || {};
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
  const service = useServiceRef<ParticipantRegistry>(() => createParticipantRegistry({ db: fluDb.participants, config: { roles, defaultVoice, birthdayAdvanceDays, anonymous }, now: now || (() => Date.now()), }));

  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [loading, setLoading] = useState(true);

  /** Recarga el registro desde IndexedDB (ordenado alfabéticamente). */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await service.list();
      setParticipants(all);
    } catch (err) {
      logCaughtError('[useParticipants] refresh error', err);
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
  // arranque (default activo, no eliminable), limpia las anclas de voz que no son
  // evidencia (sin verificar, o de otro modelo|dtype) y refresca el listado.
  useEffect(() => {
    seedAnonymous()
      // HIGIENE (mandato 2026-10-18): un vector sin verificar o de otro modelo|dtype es
      // basura — sembraba el nombre equivocado. Se borra el ANCLA, jamás al participante.
      .then(() => service.invalidateVoiceAnchors({ model: voiceVectorModel() }))
      .catch((e) => logCaughtError('src/hooks/useParticipants.ts: seedAnonymous', e))
      .finally(() => refresh().catch((e) => logCaughtError('src/hooks/useParticipants.ts: refresh', e)));
  }, [seedAnonymous, refresh, service]);

  // REPARACION UNICA (2026-10-21): el eco de FLU creo "Luis Registrado" con un vector
  // medido y lo escribio en la base; el rename por clave lo propago a filas de otras
  // voces. La creacion ya esta cerrada (stopwords + ventana de eco + no-reanclaje), pero
  // los DATOS viejos siguen. Esta migracion se ejecuta UNA vez:
  //   1) borra el participante cuyo nombre es " <base> Registrado" si existe <base>;
  //   2) invalida el ancla de <base> (pudo ser re-anclada por el eco);
  //   3) devuelve las filas con ese nombre a la etiqueta de su voz (nunca a otro nombre).
  // No borra al participante base ni filas; no toca otras voces.
  useEffect(() => {
    const KEY = 'flu-identity-confirmation-repair-2026-10-21';
    if (typeof window === 'undefined') return;
    if (localGet(KEY) === '1') return;
    const baseOf = (name: string): string => {
      const match = String(name || '').trim().match(/^(.*\S)\s+(registrado|registrada|registered)$/i);
      return match ? match[1].trim() : '';
    };
    const run = async () => {
      const all = await service.list();
      const byName = new Map(all.map((p) => [String(p.name || '').trim().toLowerCase(), p]));
      const duplicates = all.filter((p) => {
        const base = baseOf(p.name);
        return Boolean(base) && byName.has(base.toLowerCase()) && base.toLowerCase() !== String(p.name || '').trim().toLowerCase();
      });
      for (const duplicate of duplicates) {
        const base = byName.get(baseOf(duplicate.name).toLowerCase());
        if (!base) continue;
        await service.remove(duplicate.id);
        // NO se toca el ancla del participante base: no hay evidencia de que ESTA
        // concreta estuviera contaminada y borrarla destruiria una identidad valida.
        // La creacion de anclas por eco ya esta cerrada; aqui solo se retira el
        // participante duplicado y se limpia el nombre que se le pego a las filas.
        const store = useIntegrationStore.getState();
        const epoch = Number(store.conversationEpoch);
        for (const entry of store.conversationHistory) {
          if (entry.role !== 'user') continue;
          if (Number(entry.epoch) !== epoch) continue;
          if (String(entry.speakerName || '').trim() !== String(duplicate.name || '').trim()) continue;
          const fallback = speakerIdToDefaultName(String(entry.speakerId || ''));
          if (fallback && fallback !== entry.speakerName) store.setEntrySpeakerName(entry.id, fallback);
        }
      }
      localSetSafe(KEY, '1', 'src/hooks/useParticipants.ts: confirmation-name repair');
      if (duplicates.length) await refresh();
    };
    run().catch((error) => logCaughtError('src/hooks/useParticipants.ts: confirmation-name repair', error));
  }, [refresh, service]);

  // REGISTRO VIVO ENTRE PESTANAS: si OTRA pestana de la app registra un participante o
  // fija su ancla («ok flu soy luis» en /conversation), esta sesion refresca la base y
  // sus clusters de diarizacion se re-siembran con el ancla nueva (dueno del canal:
  // `participantRegistry`, misma constante). Sin esto la sesion ya abierta seguia con
  // 0 anclas toda la prueba y la voz conocida caia a «Hablante N» (medido 2026-10-20).
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(PARTICIPANTS_CHANGED_CHANNEL);
    const onChanged = () => {
      refresh().catch((e) => logCaughtError('src/hooks/useParticipants.ts: cross-tab refresh', e));
    };
    channel.addEventListener('message', onChanged);
    return () => {
      channel.removeEventListener('message', onChanged);
      channel.close();
    };
  }, [refresh]);

  /** Registra un participante y refresca el listado. */
  const register = useCallback(
    async (input: ParticipantInput): Promise<ParticipantRegisterResult> => {
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
          // Borrado lógico vía gateway (C44: un solo escritor de onboardingStates).
          await onboardingGateway.reset(id);
        } catch (err) {
          logCaughtError('[useParticipants] onboarding cleanup error', err);
        }
        try {
          if (typeof window !== 'undefined') {
            const active = localGet(STORAGE_KEYS.ACTIVE_USER);
            if (active === id) localRemove(STORAGE_KEYS.ACTIVE_USER);
          }
        } catch (err) {
          logCaughtError('[useParticipants] active-user cleanup error', err);
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
