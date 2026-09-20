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
import { createNotificationService, type NotificationChannel } from '../core/notifications/notificationService';
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
  /**
   * Notificación de completado (fuente única de la transición): se invoca
   * EXACTAMENTE cuando el onboarding pasa de NO completado a completado
   * (answer / completeWithName / skip), con el estado resultante. Permite al
   * llamador registrar/activar al participante en el mismo flujo que completa,
   * sin carreras de efectos (Bug #1: el participante nuevo no se activaba ni
   * aparecía en el selector porque el efecto de completado se cancelaba al
   * refrescar la lista de participantes).
   */
  onCompleted?: (state: OnboardingState) => void;
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
  persistForParticipant: (participantId: string, state?: OnboardingState) => Promise<void>;
}

export function useOnboarding({
  speak,
  language = 'es',
  participantId,
  onCompleted,
}: UseOnboardingOptions): UseOnboardingResult {
  const config = (FLU_CONFIG.onboarding || { enabled: false, steps: [] }) as OnboardingConfig;
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

  // Ref del estado más reciente: persistForParticipant se invoca desde flujos
  // que acaban de transicionar (p. ej. onCompleted), cuando `state` del render
  // todavía es el estado ANTERIOR. La semilla bajo el id del participante debe
  // usar el estado transicionado, NO el del closure.
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  // Ref para invocar onCompleted con el valor más reciente sin depender de
  // closures (mismo patrón que useOnboardingVoiceCapture.onFinalRef).
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

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

  // Fuente única de la transición a completado: notifica al llamador con el
  // estado resultante solo cuando se pasa de NO completado a completado.
  const notifyCompleted = (next: OnboardingState): void => {
    if (next.completed && !state.completed) {
      onCompletedRef.current?.(next);
    }
  };

  // Hablar el saludo inicial al montar (una sola vez) cuando esté listo.
  useEffect(() => {
    if (!ready || !config.enabled || state.completed) return;
    speak(initialSpeech(config.steps, lang, state.captured), lang).catch(() => undefined);
  }, [ready]);

  const handleAction = useCallback(async (result: AdvanceResult) => {
    if (result.action.type !== 'requestNotifications') return;
    const notifConfig = FLU_CONFIG.notifications || {};
    const notifChannel: NotificationChannel =
      notifConfig.channel === 'none' || notifConfig.channel === 'voice' || notifConfig.channel === 'both'
        ? notifConfig.channel
        : 'toast';
    const service = createNotificationService({ config: { ...notifConfig, channel: notifChannel } });
    try {
      const permission = await service.requestPermission();
      service.setChannel(permission === 'granted' ? 'both' : 'toast');
    } catch {
        console.warn('[catch] src/hooks/useOnboarding.ts');
      service.setChannel('toast');
    }
  }, []);

  const answer = useCallback(
    (text: string) => {
      if (state.completed || !config.enabled) return;
      const result = advanceOnboarding(state, config.steps, text, lang);
      setState(result.state);
      persistState(result.state);
      notifyCompleted(result.state);
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
    [state, config, lang, speak, persistState, handleAction, isPerUser, notifyCompleted],
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
      notifyCompleted(next);
      // Ruta legacy: persistir también el nombre capturado en la clave global
      // (misma lógica que answer()).
      if (!isPerUser && typeof window !== 'undefined' && config.nameKey) {
        window.localStorage.setItem(config.nameKey, trimmed);
      }
    },
    [state, config, persistState, isPerUser, notifyCompleted],
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
    notifyCompleted(next);
  }, [state, persistState, notifyCompleted]);

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

  /** Siembra el onboarding de un participante con un estado dado (o el más
      reciente conocido). Se pasa el estado EXPLÍCITO al sembrar el onboarding
      del participante recién resuelto/activado: el closure del render aún no
      refleja la transición y sembrar el estado anterior reabriría el onboarding
      del participante en bucle (lo que provocaba Bug #1). */
  const persistForParticipant = useCallback(
    (id: string, stateToSave?: OnboardingState): Promise<void> => {
      if (!id || id === DEFAULT_ONBOARDING_USER) return Promise.resolve();
      const target = stateToSave ?? latestStateRef.current;
      return serviceRef.current?.save(id, target).catch(() => undefined) ?? Promise.resolve();
    },
    [],
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
