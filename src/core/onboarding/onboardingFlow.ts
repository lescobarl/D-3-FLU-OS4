// ============================================================
// Onboarding Flow — Primera configuración asistida por voz (Fase 1, D1)
// ------------------------------------------------------------
// Máquina de estados determinista y config-driven (FLU_CONFIG.onboarding).
// Tipos de paso:
//  - ack      : afirmación; su texto se habla al hacerse actual y avanza solo.
//  - capture  : la respuesta del usuario se guarda en captured[key].
//  - decision : la respuesta se decide contra accept[]/reject[].
// ============================================================

export type OnboardingStepType = 'ack' | 'capture' | 'decision';

export interface OnboardingStep {
  id: string;
  type: OnboardingStepType;
  /** Para capture/decision: clave donde se guarda el valor capturado. */
  key?: string;
  accept?: string[];
  reject?: string[];
  es: string;
  en: string;
  ack?: { es: string; en: string };
  ackAccept?: { es: string; en: string };
  ackReject?: { es: string; en: string };
  /** true → el paso acepta captura por VOZ además de texto (config-driven). */
  acceptVoice?: boolean;
  /** Opciones para un capture de selección (p. ej. "¿Niño o adulto?").
      El overlay renderiza un <select> con estos choices. */
  options?: { value: string; es: string; en: string }[];
}

export interface OnboardingOverlayLabels {
  skipLabel: string;
  progressLabel: string;
  listeningHint: string;
  submitLabel?: string;
  continueLabel?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  /** Tap-to-talk: label del botón de micrófono apagado (config micLabel). */
  micLabel?: string;
  /** Tap-to-talk: label del botón de micrófono escuchando (config stopLabel). */
  stopLabel?: string;
}

export interface OnboardingConfig {
  enabled: boolean;
  nameKey: string;
  overlay: OnboardingOverlayLabels;
  steps: OnboardingStep[];
}

export interface OnboardingState {
  stepIndex: number;
  completed: boolean;
  captured: Record<string, string>;
  startedAt: number;
}

export type OnboardingAction =
  | { type: 'none' }
  | { type: 'requestNotifications' }
  | { type: 'complete' };

export interface AdvanceResult {
  state: OnboardingState;
  speech: string;
  action: OnboardingAction;
  accepted?: boolean;
}

export function createInitialState(): OnboardingState {
  return { stepIndex: 0, completed: false, captured: {}, startedAt: Date.now() };
}

/** Normaliza una respuesta de voz (minúsculas, colapsa espacios, recorta). */
export function normalizeAnswer(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rellena placeholders {clave} con los valores capturados. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

function localized(entry: { es: string; en: string } | undefined, lang: 'es' | 'en'): string {
  return entry ? (lang === 'en' ? entry.en : entry.es) : '';
}

/** Texto (localizado y con plantillas) de un paso dado. */
export function promptForStep(
  step: OnboardingStep | undefined,
  lang: 'es' | 'en',
  captured: Record<string, string>,
): string {
  if (!step) return '';
  return fillTemplate(lang === 'en' ? step.en : step.es, captured);
}

/**
 * Clave capturada que representa el nombre del usuario: el primer paso
 * de tipo capture con key definida. Se usa para persistir el nombre en
 * STORAGE_KEYS.USER_NAME (vía config.nameKey) sin hardcodear 'name'.
 */
export function nameCaptureKey(steps: OnboardingStep[]): string | undefined {
  const step = steps.find((s) => s.type === 'capture' && s.key);
  return step?.key;
}

/** Texto de inicio del onboarding: el prompt del primer paso. */
export function initialSpeech(
  steps: OnboardingStep[],
  lang: 'es' | 'en',
  captured: Record<string, string> = {},
): string {
  return promptForStep(steps[0], lang, captured);
}

function decides(candidates: string[] | undefined, normalized: string): boolean {
  if (!Array.isArray(candidates) || !normalized) return false;
  const pool = candidates.map((c) => normalizeAnswer(c));
  if (pool.includes(normalized)) return true;
  return pool.some((c) => normalized.startsWith(c) && normalized.length <= c.length + 12);
}

/**
 * ¿La respuesta normalizada coincide con una de las opciones de un capture
 * de selección (p. ej. "¿Niño o adulto?")? Compara contra el value canónico
 * y contra las etiquetas localizadas (es/en), normalizadas.
 */
function matchesOption(
  options: { value: string; es: string; en: string }[] | undefined,
  normalized: string,
): boolean {
  if (!Array.isArray(options) || !normalized) return false;
  return options.some((opt) => {
    const candidates = [opt.value, opt.es, opt.en].map((c) => normalizeAnswer(c));
    if (candidates.includes(normalized)) return true;
    return candidates.some((c) => normalized.startsWith(c) && normalized.length <= c.length + 12);
  });
}

/**
 * Avanza la máquina con la respuesta de voz del usuario.
 * Devuelve el nuevo estado, el discurso a hablar (ack + siguiente prompt)
 * y la acción derivada (requestNotifications al aceptar notificaciones,
 * complete al terminar).
 */
export function advanceOnboarding(
  state: OnboardingState,
  steps: OnboardingStep[],
  answer: string,
  lang: 'es' | 'en' = 'es',
): AdvanceResult {
  if (state.completed) {
    return { state, speech: '', action: { type: 'complete' } };
  }
  const step = steps[state.stepIndex];
  if (!step) {
    return { state: { ...state, completed: true }, speech: '', action: { type: 'complete' } };
  }

  let nextState: OnboardingState = { ...state, captured: { ...state.captured } };
  let action: OnboardingAction = { type: 'none' };
  let accepted: boolean | undefined;
  let prefix = '';

  if (step.type === 'ack') {
    // La afirmación ya fue hablada al hacerse actual; cualquier respuesta avanza.
    nextState = { ...nextState, stepIndex: state.stepIndex + 1 };
  } else if (step.type === 'capture') {
    const value = normalizeAnswer(answer);
    // Capture de selección (p. ej. "¿Niño o adulto?"): la respuesta debe
    // coincidir con una opción. Si no, se vuelve a preguntar y NO se avanza
    // (mismo patrón que la rama decision con accept/reject).
    if (step.options && step.options.length > 0 && !matchesOption(step.options, value)) {
      return { state, speech: promptForStep(step, lang, state.captured), action: { type: 'none' } };
    }
    if (step.key && value) nextState.captured[step.key] = value;
    prefix = fillTemplate(localized(step.ack, lang), nextState.captured);
    nextState = { ...nextState, stepIndex: state.stepIndex + 1 };
  } else if (step.type === 'decision') {
    const normalized = normalizeAnswer(answer);
    const isAccept = decides(step.accept, normalized);
    const isReject = decides(step.reject, normalized);
    if (!isAccept && !isReject) {
      return { state, speech: promptForStep(step, lang, state.captured), action: { type: 'none' } };
    }
    accepted = isAccept;
    prefix = fillTemplate(localized(isAccept ? step.ackAccept : step.ackReject, lang), nextState.captured);
    if (isAccept && step.key === 'notifications') action = { type: 'requestNotifications' };
    nextState = { ...nextState, stepIndex: state.stepIndex + 1 };
  }

  const nextStep = steps[nextState.stepIndex];

  // Sin más pasos: cerrar el onboarding.
  if (nextState.stepIndex >= steps.length) {
    nextState = { ...nextState, completed: true };
    if (action.type === 'none') action = { type: 'complete' };
    return { state: nextState, speech: prefix, action, accepted };
  }

  // El siguiente paso es el cierre (último ack): se habla y se completa.
  if (nextStep.type === 'ack' && nextState.stepIndex === steps.length - 1) {
    const closing = promptForStep(nextStep, lang, nextState.captured);
    nextState = { ...nextState, stepIndex: steps.length, completed: true };
    if (action.type === 'none') action = { type: 'complete' };
    return {
      state: nextState,
      speech: [prefix, closing].filter(Boolean).join(' '),
      action,
      accepted,
    };
  }

  const nextPrompt = promptForStep(nextStep, lang, nextState.captured);
  return {
    state: nextState,
    speech: [prefix, nextPrompt].filter(Boolean).join(' '),
    action,
    accepted,
  };
}

/** Marca el onboarding como completado (skip o reset desde ajustes). */
export function finishOnboarding(state: OnboardingState): OnboardingState {
  return { ...state, stepIndex: Math.max(state.stepIndex, 0), completed: true };
}

/** Progreso {current, total} para la barra del overlay. */
export function progressInfo(
  state: OnboardingState,
  steps: OnboardingStep[],
): { current: number; total: number } {
  const total = Math.max(steps.length, 1);
  const current = Math.min(Math.max(state.stepIndex + 1, 1), total);
  return { current, total };
}
