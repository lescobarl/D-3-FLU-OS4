// @vitest-environment jsdom
// ============================================================
// Tests para VoiceAssistantBarWrapper -- OS3 Local Override
// ------------------------------------------------------------
// Componente de presentacion: recibe status y props de voz y pinta
// los clusters de escucha / participacion / sesion y el bloque de
// error. Se sustituye SOLO la frontera de configuracion mockeando
// fluConfig (etiquetas de botones y wake word) con valores centinela:
// asi cada asercion de texto prueba que el componente lee de la
// config y no tiene literales incrustados.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

vi.mock('../src/voice/lib/fluConfig', () => ({
  FLU_CONFIG: {
    ui: {
      buttons: {
        startConversation: 'BTN_START',
        openListening: 'BTN_OPEN',
        closeListening: 'BTN_CLOSE',
        fluParticipa: 'BTN_FLU',
      },
    },
  },
  getCanonicalWakeWord: () => 'WAKE',
}));

import { VoiceAssistantBarWrapper } from '../src/components/VoiceAssistantBarWrapper';

type Props = Parameters<typeof VoiceAssistantBarWrapper>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    status: 'idle',
    onToggle: vi.fn(),
    onStartConversation: vi.fn(),
    isSupported: true,
    ...overrides,
  };
}

function buttonByText(text: string): HTMLButtonElement {
  return screen.getByText(text) as HTMLButtonElement;
}

describe('VoiceAssistantBarWrapper -- barra de voz (OS3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Bloque: estructura y botones de sesion ----

  it('la seccion raiz lleva la clase de la barra y el status recibido', () => {
    const { container, rerender } = render(<VoiceAssistantBarWrapper {...props({ status: 'idle' })} />);
    const root = container.querySelector('section.flu-voice-bar');
    expect(root).not.toBeNull();
    expect(root?.className).toContain('flu-voice-bar');
    expect(root?.className).toContain('idle');

    rerender(<VoiceAssistantBarWrapper {...props({ status: 'listening' })} />);
    expect(container.querySelector('section.flu-voice-bar')?.className).toContain('listening');
  });

  it('el boton iniciar conversacion usa la etiqueta de config, dispara onStartConversation y se desactiva sin soporte', () => {
    const onStartConversation = vi.fn();
    const { rerender } = render(<VoiceAssistantBarWrapper {...props({ onStartConversation })} />);

    fireEvent.click(buttonByText('BTN_START'));
    expect(onStartConversation).toHaveBeenCalledTimes(1);

    rerender(<VoiceAssistantBarWrapper {...props({ onStartConversation, isSupported: false })} />);
    expect(buttonByText('BTN_START').disabled).toBe(true);
  });

  it('el boton toggle en reposo usa openListening, la clase toggle y llama onToggle', () => {
    const onToggle = vi.fn();
    render(<VoiceAssistantBarWrapper {...props({ status: 'idle', onToggle })} />);

    const toggle = buttonByText('BTN_OPEN');
    expect(toggle.className).toContain('flu-btn--toggle');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('el boton toggle en escucha usa closeListening y la clase danger', () => {
    render(<VoiceAssistantBarWrapper {...props({ status: 'listening' })} />);

    const toggle = buttonByText('BTN_CLOSE');
    expect(toggle.className).toContain('flu-btn--danger');
    expect(screen.queryByText('BTN_OPEN')).toBeNull();
  });

  it('processing desactiva el toggle pero no iniciar; sin soporte desactiva ambos', () => {
    const { rerender } = render(<VoiceAssistantBarWrapper {...props({ status: 'processing' })} />);
    expect(buttonByText('BTN_OPEN').disabled).toBe(true);
    expect(buttonByText('BTN_START').disabled).toBe(false);

    rerender(<VoiceAssistantBarWrapper {...props({ status: 'idle', isSupported: false })} />);
    expect(buttonByText('BTN_START').disabled).toBe(true);
    expect(buttonByText('BTN_OPEN').disabled).toBe(true);
  });

  // ---- Bloque: chips de escucha (ack y paridad) ----

  it('con listeningAck pinta el chip con su texto y aria-label de escucha', () => {
    const { container } = render(<VoiceAssistantBarWrapper {...props({ listeningAck: 'Escuchando ahora' })} />);

    expect(screen.getByText('Escuchando ahora')).toBeTruthy();
    const cluster = container.querySelector('[aria-label="Estado de escucha"]');
    expect(cluster).not.toBeNull();
    expect(cluster?.querySelector('.flu-status-chip--ack')).not.toBeNull();
  });

  it('con ack y listenParity warn anade el chip de captura desincronizada con su titulo', () => {
    const { container } = render(
      <VoiceAssistantBarWrapper
        {...props({ listeningAck: 'Escuchando', listenParity: { level: 'warn', message: 'MSJ_PARIDAD' } })}
      />,
    );

    const warn = container.querySelector('.flu-status-chip--parity-warn');
    expect(warn).not.toBeNull();
    expect(warn?.getAttribute('title')).toBe('MSJ_PARIDAD');
    expect(screen.getByText('Captura desincronizada')).toBeTruthy();
  });

  it('sin ack el cluster de escucha solo aparece si hay paridad warn', () => {
    const { container, rerender } = render(<VoiceAssistantBarWrapper {...props()} />);
    expect(container.querySelector('[aria-label="Estado de escucha"]')).toBeNull();

    rerender(<VoiceAssistantBarWrapper {...props({ listenParity: { level: 'warn', message: 'MSJ' } })} />);
    expect(container.querySelector('.flu-status-chip--parity-warn')).not.toBeNull();
  });

  // ---- Bloque: chip de participacion de Flu ----

  it('oculta el cluster de Flu si participantEnabled es false, la presentacion es null o show=false', () => {
    const { container, rerender } = render(
      <VoiceAssistantBarWrapper
        {...props({ participantEnabled: false, fluParticipantPresentation: { label: 'Listo', show: true } })}
      />,
    );
    expect(container.querySelector('.flu-voice-bar__cluster--flu')).toBeNull();

    rerender(<VoiceAssistantBarWrapper {...props({ participantEnabled: true, fluParticipantPresentation: null })} />);
    expect(container.querySelector('.flu-voice-bar__cluster--flu')).toBeNull();

    rerender(
      <VoiceAssistantBarWrapper {...props({ participantEnabled: true, fluParticipantPresentation: { label: 'Listo', show: false } })} />,
    );
    expect(container.querySelector('.flu-voice-bar__cluster--flu')).toBeNull();
  });

  it('muestra el cluster de Flu con su label y boton; el boton se desactiva sin handler o sin soporte', () => {
    const onFluParticipa = vi.fn();
    const presentation = { label: 'Turno de Flu', show: true };

    const { container, rerender } = render(
      <VoiceAssistantBarWrapper {...props({ participantEnabled: true, fluParticipantPresentation: presentation, onFluParticipa })} />,
    );
    expect(container.querySelector('.flu-voice-bar__cluster--flu')).not.toBeNull();
    expect(screen.getByText('Turno de Flu')).toBeTruthy();
    const fluBtn = buttonByText('BTN_FLU');
    expect(fluBtn.disabled).toBe(false);
    fireEvent.click(fluBtn);
    expect(onFluParticipa).toHaveBeenCalledTimes(1);

    rerender(
      <VoiceAssistantBarWrapper {...props({ participantEnabled: true, fluParticipantPresentation: presentation })} />,
    );
    expect(buttonByText('BTN_FLU').disabled).toBe(true);

    rerender(
      <VoiceAssistantBarWrapper {...props({ participantEnabled: true, fluParticipantPresentation: presentation, onFluParticipa, isSupported: false })} />,
    );
    expect(buttonByText('BTN_FLU').disabled).toBe(true);
  });

  it('la clase del chip de Flu depende del tone de la presentacion', () => {
    const { container, rerender } = render(
      <VoiceAssistantBarWrapper
        {...props({ participantEnabled: true, fluParticipantPresentation: { label: 'L', tone: 'raised' } })}
      />,
    );
    expect(container.querySelector('.flu-status-chip--flu-hand-raised')).not.toBeNull();

    rerender(
      <VoiceAssistantBarWrapper
        {...props({ participantEnabled: true, fluParticipantPresentation: { label: 'L', tone: 'evaluating' } })}
      />,
    );
    expect(container.querySelector('.flu-status-chip--flu-hand-evaluating')).not.toBeNull();

    rerender(
      <VoiceAssistantBarWrapper
        {...props({ participantEnabled: true, fluParticipantPresentation: { label: 'L', tone: 'other' } })}
      />,
    );
    expect(container.querySelector('.flu-status-chip--flu-hand-idle')).not.toBeNull();
  });

  it('fluParticipantCanGrant marca el boton como ready y su titulo incluye la wake word canonica', () => {
    const { rerender } = render(
      <VoiceAssistantBarWrapper
        {...props({
          participantEnabled: true,
          fluParticipantPresentation: { label: 'L', show: true },
          onFluParticipa: vi.fn(),
          fluParticipantCanGrant: true,
        })}
      />,
    );
    const ready = buttonByText('BTN_FLU');
    expect(ready.className).toContain('flu-btn--participant-ready');
    expect(ready.getAttribute('title')).toContain('WAKE');

    rerender(
      <VoiceAssistantBarWrapper
        {...props({
          participantEnabled: true,
          fluParticipantPresentation: { label: 'L', show: true },
          onFluParticipa: vi.fn(),
          fluParticipantCanGrant: false,
        })}
      />,
    );
    const idle = buttonByText('BTN_FLU');
    expect(idle.className).not.toContain('flu-btn--participant-ready');
    expect(idle.getAttribute('title')).not.toContain('WAKE');
  });

  // ---- Bloque: bloque de error de Gemini ----

  it('geminiError.show pinta message, hint y detail; omite detail repetido y hint ausente', () => {
    const { container, rerender } = render(
      <VoiceAssistantBarWrapper
        {...props({ geminiError: { show: true, message: 'ERR_MSG', hint: 'ERR_HINT', detail: 'ERR_DETAIL' } })}
      />,
    );
    expect(container.querySelector('.flu-error-block')).not.toBeNull();
    expect(screen.getByText('ERR_MSG')).toBeTruthy();
    expect(screen.getByText('ERR_HINT')).toBeTruthy();
    expect(screen.getByText('ERR_DETAIL')).toBeTruthy();

    rerender(
      <VoiceAssistantBarWrapper
        {...props({ geminiError: { show: true, message: 'MISMO', detail: 'MISMO' } })}
      />,
    );
    expect(container.querySelectorAll('.flu-error-detail')).toHaveLength(0);
    expect(container.querySelectorAll('.flu-error-hint')).toHaveLength(0);
  });

  it('sin geminiError o con show=false no pinta el bloque de error', () => {
    const { container, rerender } = render(<VoiceAssistantBarWrapper {...props()} />);
    expect(container.querySelector('.flu-error-block')).toBeNull();

    rerender(
      <VoiceAssistantBarWrapper {...props({ geminiError: { show: false, message: 'oculto' } })} />,
    );
    expect(container.querySelector('.flu-error-block')).toBeNull();
    expect(screen.queryByText('oculto')).toBeNull();
  });
});
