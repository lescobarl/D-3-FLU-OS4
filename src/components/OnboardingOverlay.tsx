// ============================================================
// OnboardingOverlay — Tarjeta de primera configuración (Fase 1, D1)
// ------------------------------------------------------------
// Componente presentacional y no bloqueante: muestra el prompt del
// paso actual, la barra de progreso y el control según el tipo de paso:
//  - ack      → botón "Continuar" (avanza sin escribir).
//  - decision → botones rápidos Sí/No + entrada de texto de respaldo.
//  - capture  → entrada de texto + Enviar.
// Las etiquetas provienen de FLU_CONFIG.onboarding.overlay.
// ============================================================
import { useState } from 'react';
import type { OnboardingStepType } from '../core/onboarding/onboardingFlow';

export interface OnboardingOverlayProps {
  visible: boolean;
  prompt: string;
  stepType?: OnboardingStepType;
  progress: { current: number; total: number };
  skipLabel: string;
  progressLabel: string;
  listeningHint: string;
  /** Hint honesto de escritura para el placeholder (config typingHint). */
  typingHint?: string;
  /** true solo cuando el navegador confirma onstart (captura de voz real). */
  listening?: boolean;
  /** Transcripción provisional en vivo de lo que capta el micrófono.
      Vacío cuando no hay nada reconocido aún. Se muestra junto a la
      etiqueta "Escuchando" para que el usuario vea qué se está captando. */
  interim?: string;
  /** ¿Se puede responder por voz en este paso? (config + soporte del navegador). */
  canVoice?: boolean;
  /** Label del botón de micrófono cuando está apagado (config micLabel). */
  micLabel?: string;
  /** Label del botón de micrófono cuando está escuchando (config stopLabel). */
  stopLabel?: string;
  /** Tap-to-talk: abre el micrófono (primer clic). */
  onVoiceStart?: () => void;
  /** Cierra el micrófono manualmente. */
  onVoiceStop?: () => void;
  submitLabel: string;
  continueLabel?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  accept?: string[];
  reject?: string[];
  /** Opciones para un capture de selección (p. ej. "¿Niño o adulto?") ya
      localizadas como { value, label }. Si existen, el overlay renderiza un
      <select> en lugar del input de texto. */
  stepOptions?: { value: string; label: string }[];
  /** Nombres de usuarios ya existentes (multiusuario). Cuando el paso actual
      es el de captura del nombre (sin options), se muestran como botones para
      que la persona toque su perfil (o lo diga/escriba) en lugar de teclear. */
  userSuggestions?: string[];
  onAnswer: (text: string) => void;
  onSkip: () => void;
}

export function OnboardingOverlay({
  visible,
  prompt,
  stepType,
  progress,
  skipLabel,
  progressLabel,
  listeningHint,
  typingHint,
  listening = false,
  interim = '',
  canVoice = false,
  micLabel,
  stopLabel,
  onVoiceStart,
  onVoiceStop,
  submitLabel,
  continueLabel = 'Continuar',
  acceptLabel = 'Sí',
  rejectLabel = 'No',
  accept,
  reject,
  onAnswer,
  onSkip,
  stepOptions,
  userSuggestions,
}: OnboardingOverlayProps) {
  const [value, setValue] = useState('');
  const [choice, setChoice] = useState('');

  if (!visible) return null;

  const total = Math.max(progress.total, 1);
  const current = Math.min(Math.max(progress.current, 1), total);
  const label = progressLabel
    .replace('{current}', String(current))
    .replace('{total}', String(total));

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    onAnswer(text);
    setValue('');
  };

  // Valores canónicos para los botones rápidos de una decisión
  // (la máquina decide contra accept[]/reject[]).
  const acceptValue = accept?.[0]?.trim() || '';
  const rejectValue = reject?.[0]?.trim() || '';

  // Placeholder HONESTO: siempre invita a escribir (nunca afirma "Escucho…"
  // sin micrófono activado). El label de escucha es un badge vivo aparte.
  const typingPlaceholder = typingHint || listeningHint;
  const inputForm = (
    <form className="flu-onboarding__form" onSubmit={handleSubmit}>
      <input
        className="flu-onboarding__input"
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={typingPlaceholder}
        aria-label={typingPlaceholder}
        data-testid="onboarding-input"
      />
      <button
        className="flu-onboarding__submit"
        type="submit"
        disabled={!value.trim()}
        data-testid="onboarding-submit"
      >
        {submitLabel}
      </button>
    </form>
  );
  const selectForm = (
    <form
      className="flu-onboarding__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!choice) return;
        onAnswer(choice);
        setChoice('');
      }}
    >
      <select
        className="flu-onboarding__input"
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
        aria-label={typingPlaceholder}
        data-testid="onboarding-options"
      >
        <option value="">{typingPlaceholder}</option>
        {stepOptions?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        className="flu-onboarding__submit"
        type="submit"
        disabled={!choice}
        data-testid="onboarding-submit"
      >
        {submitLabel}
      </button>
    </form>
  );

  const controls =
    stepType === 'ack' ? (
      <button
        className="flu-onboarding__continue"
        type="button"
        onClick={() => onAnswer('')}
        data-testid="onboarding-continue"
      >
        {continueLabel}
      </button>
    ) : stepType === 'decision' ? (
      <>
        {(acceptValue || rejectValue) && (
          <div className="flu-onboarding__quick">
            {acceptValue && (
              <button
                className="flu-onboarding__quick-btn"
                type="button"
                onClick={() => onAnswer(acceptValue)}
                data-testid="onboarding-quick-accept"
              >
                {acceptLabel}
              </button>
            )}
            {rejectValue && (
              <button
                className="flu-onboarding__quick-btn"
                type="button"
                onClick={() => onAnswer(rejectValue)}
                data-testid="onboarding-quick-reject"
              >
                {rejectLabel}
              </button>
            )}
          </div>
        )}
        {inputForm}
      </>
    ) : stepType === 'capture' && stepOptions && stepOptions.length > 0 ? (
      selectForm
    ) : (
      inputForm
    );

  return (
    <>
      {/* §1: modal REAL. Bloquea la interacción detrás mientras el onboarding
          está abierto para que no choquen la escucha del onboarding y la del
          motor principal (dos SpeechRecognition). */}
      <div className="flu-onboarding__backdrop" data-testid="onboarding-backdrop" aria-hidden="true" />
      <aside className="flu-onboarding" role="dialog" aria-modal="true" aria-label={label}>
        <div className="flu-onboarding__header">
        <span className="flu-onboarding__dots" aria-hidden="true">
          {Array.from({ length: total }, (_, index) => (
            <span
              key={index}
              className={
                index < current
                  ? 'flu-onboarding__dot flu-onboarding__dot--active'
                  : 'flu-onboarding__dot'
              }
            />
          ))}
        </span>
        <span className="flu-onboarding__progress">{label}</span>
      </div>

      <p className="flu-onboarding__prompt">{prompt}</p>

      {/* Tap-to-talk: UN solo botón de micrófono que alterna entre
          "Hablar" (abre el micrófono con el primer clic) y "Detener"
          (lo cierra manualmente). Solo en pasos que aceptan voz. */}
      {canVoice && stepType !== 'ack' && onVoiceStart && (
        <button
          className={`flu-onboarding__mic${listening ? ' flu-onboarding__mic--listening' : ''}`}
          type="button"
          onClick={listening ? onVoiceStop : onVoiceStart}
          data-testid="onboarding-mic"
          aria-pressed={listening}
        >
          {listening ? stopLabel || 'Detener' : micLabel || 'Hablar'}
        </button>
      )}

      {/* Lista de usuarios existentes: en el paso de captura del nombre (un
          capture SIN options → texto libre) se muestran los perfiles ya dados
          de alta como botones, para que la persona toque el suyo (o lo diga /
          escriba) en lugar de teclear el nombre desde cero. */}
      {stepType === 'capture' &&
        (!stepOptions || stepOptions.length === 0) &&
        userSuggestions &&
        userSuggestions.length > 0 && (
          <div className="flu-onboarding__users" data-testid="onboarding-user-suggestions">
            {userSuggestions.map((userName) => (
              <button
                key={userName}
                className="flu-onboarding__user"
                type="button"
                onClick={() => onAnswer(userName)}
                data-testid={`onboarding-user-${userName}`}
              >
                {userName}
              </button>
            ))}
          </div>
        )}

      {controls}

      {/* Fila inferior: etiqueta "Escuchando" + transcripción en vivo a la
          altura de "Omitir". Solo aparece con onstart real del navegador. */}
      <div className="flu-onboarding__footer">
        {canVoice && listening && stepType !== 'ack' && (
          <span className="flu-onboarding__listening" role="status" aria-live="polite">
            {listeningHint}
            {interim ? <span className="flu-onboarding__interim">“{interim}”</span> : null}
          </span>
        )}
        <button
          className="flu-onboarding__skip"
          type="button"
          onClick={onSkip}
          data-testid="onboarding-skip"
        >
          {skipLabel}
        </button>
      </div>
      </aside>
    </>
  );
}
