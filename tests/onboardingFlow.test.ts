// ============================================================
// Onboarding Flow — Máquina de estados determinista y config-driven
// (Fase 1, D1). Pruebas sobre las funciones puras de onboardingFlow.ts
// usando el config REAL de FLU_CONFIG.onboarding (sin hardcode).
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  normalizeAnswer,
  fillTemplate,
  promptForStep,
  initialSpeech,
  advanceOnboarding,
  finishOnboarding,
  progressInfo,
  nameCaptureKey,
  type OnboardingStep,
} from '../src/core/onboarding/onboardingFlow';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const onboarding = (FLU_CONFIG as any).onboarding as {
  enabled: boolean;
  nameKey: string;
  steps: OnboardingStep[];
};

const steps = onboarding.steps;

describe('onboardingFlow — helpers', () => {
  it('createInitialState empieza en el paso 0, sin completar y sin capturas', () => {
    const state = createInitialState();
    expect(state.stepIndex).toBe(0);
    expect(state.completed).toBe(false);
    expect(state.captured).toEqual({});
    expect(typeof state.startedAt).toBe('number');
  });

  it('normalizeAnswer minúsculas, colapsa espacios y recorta', () => {
    expect(normalizeAnswer('  JuAn   De  la  Rosa ')).toBe('juan de la rosa');
    expect(normalizeAnswer('')).toBe('');
    expect(normalizeAnswer(null as unknown as string)).toBe('');
  });

  it('fillTemplate reemplaza {clave} con los valores capturados', () => {
    expect(fillTemplate('¡{name}, qué bonito nombre!', { name: 'juan' })).toBe(
      '¡juan, qué bonito nombre!',
    );
  });

  it('fillTemplate deja intactos los placeholders desconocidos', () => {
    expect(fillTemplate('Hola {name}, tienes {count} avisos', { name: 'juan' })).toBe(
      'Hola juan, tienes {count} avisos',
    );
  });

  it('promptForStep(undefined) devuelve cadena vacía', () => {
    expect(promptForStep(undefined, 'es', {})).toBe('');
  });

  it('promptForStep localiza es/en y aplica plantillas', () => {
    expect(promptForStep(steps[0], 'es', {})).toBe('¿Cómo te llamas?');
    expect(promptForStep(steps[0], 'en', {})).toBe('What is your name?');
    expect(promptForStep(steps[1], 'es', { name: 'ana' })).toBe('¿Eres niño o adulto?');
    expect(promptForStep(steps[2], 'es', { name: 'ana' })).toBe(
      '¡Listo, ana! Ya estás configurado. Háblame cuando quieras.',
    );
  });

  it('initialSpeech devuelve el prompt del primer paso (captura de nombre)', () => {
    const speech = initialSpeech(steps, 'es');
    expect(speech).toBe('¿Cómo te llamas?');
  });

  it('nameCaptureKey devuelve la clave del primer capture del config real', () => {
    expect(nameCaptureKey(steps)).toBe('name');
    expect(onboarding.nameKey).toBe('flu-user-name');
  });

  it('nameCaptureKey devuelve undefined si no hay paso capture', () => {
    const onlyAck: OnboardingStep[] = [
      { id: 'a', type: 'ack', es: 'Hola', en: 'Hi' },
      { id: 'b', type: 'decision', key: 'x', accept: ['si'], es: '¿Sí?', en: 'Yes?' },
    ];
    expect(nameCaptureKey(onlyAck)).toBeUndefined();
    expect(nameCaptureKey([])).toBeUndefined();
  });
});

describe('onboardingFlow — advanceOnboarding con config real', () => {
  it('el primer paso (capture de nombre) guarda el nombre y pide niño/adulto', () => {
    const result = advanceOnboarding(createInitialState(), steps, 'juan');
    expect(result.state.stepIndex).toBe(1);
    expect(result.state.completed).toBe(false);
    expect(result.state.captured).toEqual({ name: 'juan' });
    expect(result.action).toEqual({ type: 'none' });
    expect(result.speech).toContain('¡juan, qué bonito nombre!');
    expect(result.speech).toContain('¿Eres niño o adulto?');
  });

  it('el capture guarda la clave "name" y avanza al paso niño/adulto', () => {
    const start = { ...createInitialState(), stepIndex: 0 };
    const result = advanceOnboarding(start, steps, 'juan');
    expect(result.state.captured).toEqual({ name: 'juan' });
    expect(result.state.stepIndex).toBe(1);
    expect(result.state.completed).toBe(false);
    expect(result.action).toEqual({ type: 'none' });
    expect(result.speech).toContain('¡juan, qué bonito nombre!');
    expect(result.speech).toContain('¿Eres niño o adulto?');
  });

  it('el capture de "kind" guarda la respuesta y completa con el cierre', () => {
    const start = { ...createInitialState(), stepIndex: 1, captured: { name: 'juan' } };
    const result = advanceOnboarding(start, steps, 'adulto');
    expect(result.state.captured).toEqual({ name: 'juan', kind: 'adulto' });
    expect(result.state.stepIndex).toBe(3);
    expect(result.state.completed).toBe(true);
    expect(result.action).toEqual({ type: 'complete' });
    expect(result.speech).toContain('¡Genial, juan!');
    expect(result.speech).toContain('¡Listo, juan! Ya estás configurado. Háblame cuando quieras.');
  });

  it('una respuesta vacía en capture NO rompe el flujo (deja el placeholder literal)', () => {
    const start = { ...createInitialState(), stepIndex: 0 };
    const result = advanceOnboarding(start, steps, '   ');
    expect(result.state.stepIndex).toBe(1);
    expect(result.state.completed).toBe(false);
    expect(result.state.captured.name).toBeUndefined();
    expect(result.speech).toContain('¡{name}, qué bonito nombre!');
    expect(result.speech).toContain('¿Eres niño o adulto?');
  });

  it('advanceOnboarding sobre un estado completado devuelve action complete', () => {
    const done = { ...createInitialState(), completed: true, stepIndex: steps.length };
    const result = advanceOnboarding(done, steps, 'hola');
    expect(result.state).toBe(done);
    expect(result.speech).toBe('');
    expect(result.action).toEqual({ type: 'complete' });
  });
});

describe('onboardingFlow — borde de pasos (configs personalizados)', () => {
  const twoAcks: OnboardingStep[] = [
    { id: 'a1', type: 'ack', es: 'Uno', en: 'One' },
    { id: 'a2', type: 'ack', es: 'Dos', en: 'Two' },
  ];

  const decisionFlow: OnboardingStep[] = [
    {
      id: 'd',
      type: 'decision',
      key: 'x',
      accept: ['si', 'sí', 'ok'],
      reject: ['no'],
      es: '¿Avisos?',
      en: 'Alerts?',
      ackAccept: { es: '¡Perfecto!', en: 'Perfect!' },
      ackReject: { es: 'Entendido.', en: 'Understood.' },
    },
    { id: 'end', type: 'ack', es: 'Listo.', en: 'Done.' },
  ];

  it('un solo ack al final completa en cuanto se responde', () => {
    const result = advanceOnboarding(createInitialState(), twoAcks, 'ok');
    expect(result.state.completed).toBe(true);
    expect(result.action).toEqual({ type: 'complete' });
    expect(result.speech).toContain('Dos');
  });

  it('un decision seguido de un ack de cierre completa tras aceptar/rechazar', () => {
    // Respuesta neutra → reintenta el mismo paso sin mutar el estado.
    const initial = createInitialState();
    const retry = advanceOnboarding(initial, decisionFlow, 'quizás');
    expect(retry.state).toBe(initial); // estado sin mutar
    expect(retry.state.stepIndex).toBe(0);
    expect(retry.state.completed).toBe(false);
    expect(retry.action).toEqual({ type: 'none' });
    expect(retry.speech).toBe('¿Avisos?');

    // Aceptar (coincidencia parcial) → ack de aceptación + cierre y completa.
    const accepted = advanceOnboarding(createInitialState(), decisionFlow, 'sí claro');
    expect(accepted.accepted).toBe(true);
    expect(accepted.state.completed).toBe(true);
    expect(accepted.action).toEqual({ type: 'complete' });
    expect(accepted.speech).toContain('¡Perfecto!');
    expect(accepted.speech).toContain('Listo.');

    // Rechazar → completa con el ack de rechazo.
    const rejected = advanceOnboarding(createInitialState(), decisionFlow, 'no');
    expect(rejected.accepted).toBe(false);
    expect(rejected.state.completed).toBe(true);
    expect(rejected.action).toEqual({ type: 'complete' });
    expect(rejected.speech).toContain('Entendido.');
    expect(rejected.speech).toContain('Listo.');
  });

  it('sin pasos: el primer advance completa directamente', () => {
    const result = advanceOnboarding(createInitialState(), [], 'hola');
    expect(result.state.completed).toBe(true);
    expect(result.action).toEqual({ type: 'complete' });
  });
});

describe('onboardingFlow — finishOnboarding y progressInfo', () => {
  it('finishOnboarding marca completado conservando el paso', () => {
    const state = { ...createInitialState(), stepIndex: 2 };
    const finished = finishOnboarding(state);
    expect(finished.completed).toBe(true);
    expect(finished.stepIndex).toBe(2);
  });

  it('finishOnboarding no deja stepIndex negativo', () => {
    const finished = finishOnboarding({ ...createInitialState(), stepIndex: -3 });
    expect(finished.stepIndex).toBe(0);
    expect(finished.completed).toBe(true);
  });

  it('progressInfo calcula current/total sobre el config real', () => {
    const first = progressInfo(createInitialState(), steps);
    expect(first.current).toBe(1);
    expect(first.total).toBe(3);

    const mid = progressInfo({ ...createInitialState(), stepIndex: 2 }, steps);
    expect(mid).toEqual({ current: 3, total: 3 });

    const done = progressInfo({ ...createInitialState(), stepIndex: steps.length }, steps);
    expect(done).toEqual({ current: 3, total: 3 });
  });

  it('progressInfo con lista vacía usa total mínimo 1', () => {
    expect(progressInfo(createInitialState(), [])).toEqual({ current: 1, total: 1 });
  });
});

describe('onboardingFlow — coherencia con FLU_CONFIG', () => {
  it('el config real está habilitado, tiene 3 pasos y usa keys name/kind', () => {
    expect(onboarding.enabled).toBe(true);
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.type)).toEqual(['capture', 'capture', 'ack']);
    expect(steps[0].key).toBe('name');
    expect(steps[1].key).toBe('kind');
  });

  it('los templates de cierre usan {name} y coinciden con la clave capturada', () => {
    const closingAck = steps[2].ack?.es ?? steps[2].es;
    expect(closingAck).toContain('{name}');
    expect(nameCaptureKey(steps)).toBe('name');
  });

  it('el paso "kind" ofrece niño/adulto y kindToRole los mapea a Estudiante/Familiar', () => {
    const kindStep = steps[1];
    expect(kindStep.type).toBe('capture');
    expect(kindStep.key).toBe('kind');
    expect(kindStep.acceptVoice).toBe(true);
    const options = kindStep.options || [];
    expect(options.map((o) => o.value)).toEqual(['niño', 'adulto']);
    const kindToRole = (FLU_CONFIG as any).multiuser?.kindToRole || {};
    expect(kindToRole['niño']).toBe('Estudiante');
    expect(kindToRole['adulto']).toBe('Familiar');
  });

  it('el paso capture acepta voz y el overlay define typingHint y labels tap-to-talk', () => {
    const captureStep = steps.find((s) => s.type === 'capture');
    expect(captureStep?.acceptVoice).toBe(true);
    const overlay = (FLU_CONFIG as any).onboarding?.overlay || {};
    expect(typeof overlay.typingHint).toBe('string');
    expect((overlay.typingHint || '').length).toBeGreaterThan(0);
    expect(typeof overlay.micLabel).toBe('string');
    expect((overlay.micLabel || '').length).toBeGreaterThan(0);
    expect(typeof overlay.stopLabel).toBe('string');
    expect((overlay.stopLabel || '').length).toBeGreaterThan(0);
  });
});
