// ============================================================
// useOnboarding — Primera configuración asistida (Fase 1, D1)
// ------------------------------------------------------------
// Estado determinista (onboardingFlow) persistido:
//  - Multiusuario (Fase 3): con participantId real, en Dexie
//    (tabla v14 onboardingStates) vía onboardingService.
//  - Legacy: sin participante activo (undefined/''/'default'),
//    se mantiene el comportamiento original basado en
//    STORAGE_KEYS (compatibilidad e2e).
// Habla el paso inicial al montar y reacciona a answer()/skip()/reset().
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { STORAGE_KEYS } from '../core/config/appConfig';
import {
  advanceOnboarding,
  createInitialState,
  finishOnboarding,
  initialSpeech,
  nameCaptureKey,
  progressInfo,
  type AdvanceResult,
  type OnboardingConfig,
  type OnboardingState,
  type OnboardingStep,
} from '../core/onboarding/onboardingFlow';
import { createNotificationService } from '../core/notifications/notificationService';
import { fluDb } from '../core/db/fluDatabase';
import {
  createOnboardingService,
  DEFAULT_ONBOARDING_USER,
  readLegacyOnboarding,
  type OnboardingService,
} from '../core/onboarding/onboardingService';

export interface UseOnboardingOptions {
  speak: (text: string, lang: string) => Promise<void>;
  language?: string;
  /**
   * Participante activo (multiusuario — Fase 3).
   * undefined / '' / 'default' → ruta legacy (localStorage).
   */
  participantId?: string;
}

export interface UseOnboardingResult {
  visible: boolean;
  ready: boolean;
  state: OnboardingState;
  config: OnboardingConfig;
  currentStep: OnboardingStep | undefined;
  progress: { current: number; total: number };
  answer: (text: string) => void;
  /**
   * Completa el onboarding de inmediato capturando únicamente el nombre
   * (ruta para perfiles EXISTENTES: se omite el paso "¿Niño o adulto?"
   * porque el kind/rol de un perfil ya guardado no se vuelve a preguntar).
   */
  completeWithName: (name: string) => void;
  skip: () => void;
  reset: () => void;
  /** Siembra el estado actual en el onboarding de un participante. */
  persistForParticipant: (participantId: string) => Promise<void>;
}

export function useOnboarding({
  speak,
  language = 'es',
  participantId,
}: UseOnboardingOptions): UseOnboardingResult {
  const config = ((FLU_CONFIG as any).onboarding || { enabled: false, steps: [] }) as OnboardingConfig;
  const lang = language === 'en' ? 'en' : 'es';
  const isPerUser =
    participantId !== undefined && participantId !== '' && participantId !== DEFAULT_ONBOARDING_USER;

  // Servicio (lazy singleton) — solo se usa en la ruta per-user.
  const serviceRef = useRef<OnboardingService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createOnboardingService({ db: fluDb.onboardingStates });
  }

  const [state, setState] = useState<OnboardingState>(() =>
    isPerUser ? createInitialState() : readLegacyOnboarding(),
  );
  // La ruta legacy está lista de inmediato; la per-user espera al load().
  const [ready, setReady] = useState<boolean>(() => !isPerUser);

  // Cargar el estado del participante al montar/cambiar de participante.
  useEffect(() => {
    if (!isPerUser || !participantId) return;
    let cancelled = false;
    setReady(false);
    serviceRef.current
      ?.load(participantId)
      .then((loaded) => {
        if (cancelled) return;
        setState(loaded);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setState(createInitialState());
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isPerUser, participantId]);

  // Transición a la ruta legacy (sin participante activo — p. ej. al tocar
  // "Crear perfil nuevo"): relee el estado legacy de localStorage para no
  // heredar el estado per-user del participante anterior y dejar visible el
  // onboarding de la persona que está entrando.
  useEffect(() => {
    if (isPerUser) return;
    setState(readLegacyOnboarding());
    setReady(true);
  }, [isPerUser]);

  const persistState = useCallback(
    (next: OnboardingState) => {
      if (isPerUser) {
        if (participantId) serviceRef.current?.save(participantId, next).catch(() => undefined);
        return;
      }
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETED, String(next.completed));
      window.localStorage.setItem(
        STORAGE_KEYS.ONBOARDING_STEP,
        JSON.stringify({ stepIndex: next.stepIndex, captured: next.captured }),
      );
    },
    [isPerUser, participantId],
  );

  // Hablar el saludo inicial al montar (una sola vez) cuando esté listo.
  useEffect(() => {
    if (!ready || !config.enabled || state.completed) return;
    speak(initialSpeech(config.steps, lang, state.captured), lang).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const handleAction = useCallback(async (result: AdvanceResult) => {
    if (result.action.type !== 'requestNotifications') return;
    const notifConfig = (FLU_CONFIG as any).notifications || {};
    const service = createNotificationService({ config: notifConfig });
    try {
      const permission = await service.requestPermission();
      service.setChannel(permission === 'granted' ? 'both' : 'toast');
    } catch {
      service.setChannel('toast');
    }
  }, []);

  const answer = useCallback(
    (text: string) => {
      if (state.completed || !config.enabled) return;
      const result = advanceOnboarding(state, config.steps, text, lang);
      setState(result.state);
      persistState(result.state);
      // Persistir el nombre capturado en la clave de almacenamiento
      // config-driven (config.nameKey → STORAGE_KEYS.USER_NAME).
      // Solo en la ruta legacy: en la per-user el nombre vive en el
      // registro Dexie de ese participante (captured), no en global.
      if (!isPerUser && typeof window !== 'undefined' && config.nameKey) {
        const nameKey = nameCaptureKey(config.steps);
        const name = nameKey ? result.state.captured[nameKey] : undefined;
        if (name) window.localStorage.setItem(config.nameKey, name);
      }
      if (result.action.type === 'requestNotifications') {
        handleAction(result);
      }
      if (result.speech) {
        speak(result.speech, lang).catch(() => undefined);
      }
    },
    [state, config, lang, speak, persistState, handleAction, isPerUser],
  );

  /**
   * Atajo para perfiles existentes: captura el nombre y marca el onboarding
   * completado sin avanzar por los pasos restantes (kind/complete). El rol de
   * un participante ya registrado NO se deriva de la pregunta "¿Niño o
   * adulto?", por lo que esa pregunta es redundante cuando el usuario eligió
   * un perfil que ya existe.
   */
  const completeWithName = useCallback(
    (name: string) => {
      if (state.completed || !config.enabled) return;
      const nameKey = nameCaptureKey(config.steps);
      const trimmed = String(name || '').trim();
      if (!nameKey || !trimmed) return;
      const next: OnboardingState = {
        ...state,
        captured: { ...state.captured, [nameKey]: trimmed },
        stepIndex: config.steps.length,
        completed: true,
      };
      setState(next);
      persistState(next);
      // Ruta legacy: persistir también el nombre capturado en la clave global
      // (misma lógica que answer()).
      if (!isPerUser && typeof window !== 'undefined' && config.nameKey) {
        window.localStorage.setItem(config.nameKey, trimmed);
      }
    },
    [state, config, persistState, isPerUser],
  );

  const skip = useCallback(() => {
    if (state.completed) return;
    // "Omitir" solo marca el onboarding como completado. El perfil anónimo por
    // defecto (Anónimo/Estudiante) ya existe como semilla desde el primer
    // arranque (participantRegistry.seedAnonymous) y es el default activo, por
    // lo que aquí NO se crea ni se captura nada.
    const next = finishOnboarding(state);
    setState(next);
    persistState(next);
  }, [state, persistState]);

  const reset = useCallback(() => {
    const next = createInitialState();
    if (isPerUser) {
      if (participantId) serviceRef.current?.reset(participantId).catch(() => undefined);
    } else if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETED);
      window.localStorage.removeItem(STORAGE_KEYS.ONBOARDING_STEP);
      if (config.nameKey) window.localStorage.removeItem(config.nameKey);
    }
    setState(next);
    speak(initialSpeech(config.steps, lang, next.captured), lang).catch(() => undefined);
  }, [config, lang, speak, isPerUser, participantId]);

  /** Siembra el estado actual (ej. completado) para otro participante. */
  const persistForParticipant = useCallback(
    (id: string): Promise<void> => {
      if (!id || id === DEFAULT_ONBOARDING_USER) return Promise.resolve();
      return serviceRef.current?.save(id, state).catch(() => undefined) ?? Promise.resolve();
    },
    [state],
  );

  const visible = ready && config.enabled === true && !state.completed;
  const currentStep = config.steps[state.stepIndex];
  const progress = progressInfo(state, config.steps);

  return {
    visible,
    ready,
    state,
    config,
    currentStep,
    progress,
    answer,
    completeWithName,
    skip,
    reset,
    persistForParticipant,
  };
}
