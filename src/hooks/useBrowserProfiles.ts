// ============================================================
// useBrowserProfiles — Punto 2: Navegador curado (Pizarrón)
// ------------------------------------------------------------
// Hook que gestiona los perfiles de navegador por participante
// (categorías curadas, allowlist, nivel de lectura, idioma,
// supervisión, tiles de inicio y límite diario) sobre Dexie
// (fluDb.browserProfiles) vía browserProfileService.
//
// Cumple:
//   - Regla #1: NO HARDCODE — catálogo y defaults desde
//     FLU_CONFIG.browser (fuente de verdad)
//   - Obligación #5: auditoría (la hace browserProfileService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace el service)
//   - Punto 2: manual (perfil guardado) > rol > default en la
//     sesión del Pizarrón-navegador curado
//   - DI: now inyectable para pruebas deterministas
// ============================================================
import { useCallback } from 'react';
import { refreshOnOk } from './refreshOnOk';
import { useProfileList } from './useProfileList';
import { FLU_CONFIG } from '../voice/api/config';
import { fluDb, type BrowserProfileRecord } from '../core/db/fluDatabase';
import {
  createBrowserProfileService,
  type BrowserProfileConfig,
  type BrowserProfileInput,
  type BrowserProfilePatch,
  type BrowserProfileService,
  type ResolvedBrowserProfile,
  type SaveResult,
} from '../core/browser/browserProfileService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseBrowserProfilesOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface BrowserProfilesState {
  profiles: BrowserProfileRecord[];
  loading: boolean;
}

export interface BrowserProfilesActions {
  refresh: () => Promise<void>;
  ensure: (participantId: string, participantName?: string) => Promise<SaveResult>;
  update: (
    participantId: string,
    patch: BrowserProfilePatch,
    participantName?: string,
    role?: string,
  ) => Promise<SaveResult>;
  reset: (participantId: string) => Promise<boolean>;
  resolveForSession: (
    participantId: string,
    opts?: { role?: string; name?: string },
  ) => Promise<ResolvedBrowserProfile>;
}

export interface UseBrowserProfilesResult extends BrowserProfilesState, BrowserProfilesActions {
  service: BrowserProfileService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useBrowserProfiles({ now }: UseBrowserProfilesOptions = {}): UseBrowserProfilesResult {
  // Punto 2: configuración desde FLU_CONFIG.browser (fuente de verdad).
  const config = (FLU_CONFIG.browser || {}) as BrowserProfileConfig;

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const { service, items: profiles, loading, refresh } = useProfileList<
    BrowserProfileRecord,
    BrowserProfileService
  >({
    create: (nowFn) =>
      createBrowserProfileService({
        // Adaptador de la tabla Dexie a BrowserProfilesDb: la clave física
        // y lógica es participantId (el id del registro ES el participante).
        db: {
          add: (record) => fluDb.browserProfiles.add(record),
          put: (record) => fluDb.browserProfiles.put(record),
          get: (id) => fluDb.browserProfiles.get(id),
          toArray: () => fluDb.browserProfiles.toArray(),
        },
        config,
        now: nowFn,
      }),
    now,
    errorLabel: 'useBrowserProfiles',
    list: (s) => s.list(),
  });

  /** Asegura el perfil de una persona (defaults de config) y refresca. */
  const ensure = useCallback(
    async (participantId: string, participantName?: string): Promise<SaveResult> => {
      return refreshOnOk(() => service.ensure(participantId, participantName), refresh);
    },
    [service, refresh],
  );

  /**
   * Actualiza un perfil y refresca. Se construye un BrowserProfileInput
   * explícito y se delega en ensure (crea o actualiza y persiste el nombre).
   */
  const update = useCallback(
    async (
      participantId: string,
      patch: BrowserProfilePatch,
      participantName?: string,
      role?: string,
    ): Promise<SaveResult> => {
      const input: BrowserProfileInput = {
        categories: patch.categories,
        allowlist: patch.allowlist,
        readingLevel: patch.readingLevel,
        language: patch.language,
        homeTiles: patch.homeTiles,
      };
      // El rol se reenvía para que ensure siembre los escalares desde los
      // defaults por rol cuando aún no existe registro (primer edit manual).
      return refreshOnOk(() => service.ensure(participantId, participantName, input, role), refresh);
    },
    [service, refresh],
  );

  /** Elimina el perfil de una persona y refresca. */
  const reset = useCallback(
    async (participantId: string): Promise<boolean> => {
      const ok = await service.reset(participantId);
      if (ok) await refresh();
      return ok;
    },
    [service, refresh],
  );

  /** Perfil resuelto para la sesión (manual > rol > default). No persiste. */
  const resolveForSession = useCallback(
    async (
      participantId: string,
      opts: { role?: string; name?: string } = {},
    ): Promise<ResolvedBrowserProfile> => service.resolveForSession(participantId, opts),
    [service],
  );

  return {
    service,
    profiles,
    loading,
    refresh,
    ensure,
    update,
    reset,
    resolveForSession,
  };
}
