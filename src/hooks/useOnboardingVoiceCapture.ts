// ============================================================
// useOnboardingVoiceCapture — TAP-TO-TALK + AUTO-REANUDACIÓN en onboarding
// ------------------------------------------------------------
// Modelo híbrido, sin parches:
//  - El micrófono NO se abre solo. `enabled` solo habilita el botón
//    (capture/decision con acceptVoice). El usuario abre el micrófono
//    con el PRIMER CLIC (tap-to-talk).
//  - Tras una transcripción final se entrega la respuesta y el
//    micrófono se CIERRA (one-shot). No se reabre solo.
//  - Mientras FLU habla por los altavoces se SUSPENDE el micrófono
//    (anti-eco) y al terminar el TTS se REANUDA automáticamente para
//    el siguiente paso (auto-reanudación).
//
// - `enabled` true  → habilita el botón (no abre el micrófono).
// - `enabled` false → cierra el micrófono y cancela reintentos.
// - `start()`       → abre el micrófono (primer clic del usuario).
// - `stop()`        → cierra el micrófono y cancela reintentos.
// - `suspend()`     → aborta el reconocimiento (anti-eco) antes de
//                     que FLU hable; no reintenta mientras está
//                     suspendido.
// - `resume()`      → reabre el micrófono tras el TTS de FLU.
//
// `listening` es HONESTO: pasa a true SOLO con onstart real del
// navegador y se apaga en onend/onerror/stop. Nunca es optimista.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acquireSpeechRecognition,
  abortSpeechRecognition,
  bindSpeechRecognition,
  isSpeechRecognitionSupported,
  startSpeechRecognition,
  stopSpeechRecognition,
} from '../voice/lib/speechRecognitionLocal';
import type { SpeechRecognitionLike } from '../types/fluWindow';

export interface UseOnboardingVoiceCaptureOptions {
  /** true solo mientras el paso actual acepta voz (config acceptVoice).
      Habilita el botón; NO abre el micrófono automáticamente. */
  enabled: boolean;
  /** Idioma de reconocimiento ('es' | 'en'). */
  language?: string;
  /** Mismo embudo que el teclado → onboarding.answer(text). */
  onFinal: (text: string) => void;
  /** Telemetría opcional: 'start' | 'final' | 'error' | 'end' | 'suspend' | 'resume'. */
  onEvent?: (event: string, payload?: unknown) => void;
}

export interface UseOnboardingVoiceCaptureResult {
  /** ¿El navegador soporta SpeechRecognition? */
  supported: boolean;
  /** true SOLO con confirmación real del navegador (onstart). */
  listening: boolean;
  /** Transcripción provisional en vivo (interim) de lo que capta el
      micrófono. Vacío cuando no hay nada reconocido aún. Permite al
      usuario VER qué está escuchando el sistema. */
  interim: string;
  /** Tap-to-talk: abre el micrófono (no-op si !enabled o ya activo). */
  start: () => void;
  /** Cierra el micrófono y cancela reintentos. */
  stop: () => void;
  /** Anti-eco: aborta el reconocimiento mientras FLU habla. */
  suspend: () => void;
  /** Reabre el micrófono tras el TTS de FLU (si sigue enabled). */
  resume: () => void;
}

export function useOnboardingVoiceCapture({
  enabled,
  language = 'es',
  onFinal,
  onEvent,
}: UseOnboardingVoiceCaptureOptions): UseOnboardingVoiceCaptureResult {
  const supported = isSpeechRecognitionSupported();
  const [listening, setListening] = useState(false);
  // Transcripción provisional en vivo (interim) para que el usuario vea
  // qué está captando el micrófono mientras habla.
  const [interim, setInterim] = useState('');

  // Refs para leer los valores más recientes dentro de callbacks async.
  const enabledRef = useRef(enabled);
  const languageRef = useRef(language);
  const onFinalRef = useRef(onFinal);
  const onEventRef = useRef(onEvent);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const suspendedRef = useRef(false);
  // One-shot: tras entregar una respuesta final, el micrófono se cierra y
  // NO se reabre solo. Solo `resume()` (tras el TTS de FLU) lo reabre.
  const deliveredRef = useRef(false);

  enabledRef.current = enabled;
  languageRef.current = language;
  onFinalRef.current = onFinal;
  onEventRef.current = onEvent;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearRestartTimer();
    activeRef.current = false;
    suspendedRef.current = false;
    deliveredRef.current = false;
    setListening(false);
    setInterim('');
    if (recognitionRef.current) stopSpeechRecognition(recognitionRef.current);
  }, [clearRestartTimer]);

  // Reintento suave para no-speech/aborted/network/audio-capture. Solo
  // reintenta si la sesión sigue ACTIVA, NO está suspendida (FLU hablando)
  // y NO se entregó ya una respuesta (one-shot).
  const restartAfter = useCallback(
    (delay: number) => {
      clearRestartTimer();
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        const recognition = recognitionRef.current;
        if (!activeRef.current || suspendedRef.current || deliveredRef.current || !recognition) return;
        // onstart confirmará listening; nada optimista aquí.
        startSpeechRecognition(recognition);
      }, delay);
    },
    [clearRestartTimer],
  );

  // Tap-to-talk: abre el micrófono SOLO por llamada explícita (primer clic).
  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!enabledRef.current || !recognition || activeRef.current) return;
    activeRef.current = true;
    suspendedRef.current = false;
    deliveredRef.current = false;
    setInterim('');
    startSpeechRecognition(recognition);
  }, []);

  // Anti-eco: aborta el reconocimiento antes de que FLU hable. Al llegar
  // onend, como suspendedRef es true, NO se reintenta (evita auto-eco).
  const suspend = useCallback(() => {
    clearRestartTimer();
    if (!activeRef.current) return;
    suspendedRef.current = true;
    setListening(false);
    setInterim('');
    onEventRef.current?.('suspend');
    const recognition = recognitionRef.current;
    if (recognition) {
      // §9.1: aborta y libera el lock central para que el motor principal
      // pueda volver a escuchar sin doble captura.
      abortSpeechRecognition(recognition);
    }
  }, [clearRestartTimer]);

  // Reabre el micrófono tras el TTS de FLU (si la sesión sigue activa).
  // Reinicia el one-shot para que el siguiente paso vuelva a escuchar.
  const resume = useCallback(() => {
    if (!activeRef.current) return;
    suspendedRef.current = false;
    deliveredRef.current = false;
    onEventRef.current?.('resume');
    const recognition = recognitionRef.current;
    if (recognition) startSpeechRecognition(recognition);
  }, []);

  // Crea la instancia una sola vez (perezosamente, si hay soporte).
  useEffect(() => {
    if (!supported) return;
    const recognition = acquireSpeechRecognition(languageRef.current, '');
    if (!recognition) return;
    recognitionRef.current = recognition;

    bindSpeechRecognition(recognition, {
      onStart: () => {
        setListening(true);
        onEventRef.current?.('start');
      },
      onResult: (event: SpeechRecognitionEvent) => {
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result?.isFinal) {
            const transcript = result[0]?.transcript?.trim();
            if (transcript) finalText += transcript + ' ';
          } else {
            // Resultado provisional: se muestra en vivo para que el usuario
            // vea qué está captando el micrófono mientras habla.
            const transcript = result[0]?.transcript?.trim();
            if (transcript) interimText += transcript + ' ';
          }
        }
        const clean = finalText.trim();
        // Actualiza la transcripción provisional en vivo (puede estar vacía
        // mientras el reconocimiento aún no produce texto).
        setInterim(interimText.trim());
        if (!clean) return;
        onEventRef.current?.('final', clean);
        // One-shot: entrega la respuesta y cierra el micrófono. El siguiente
        // paso se reabre con `resume()` tras el TTS de FLU.
        deliveredRef.current = true;
        setInterim('');
        onFinalRef.current(clean);
      },
      onError: (event: SpeechRecognitionErrorEvent) => {
        const name = String(event?.error || event?.message || '').toLowerCase();
        onEventRef.current?.('error', name);
        if (name === 'not-allowed' || name === 'service-not-allowed') {
          // Permiso denegado: no reintentar en bucle.
          stop();
          return;
        }
        // no-speech / aborted / network / audio-capture → reintento
        // suave SOLO si la sesión sigue activa, no está suspendida y no
        // se entregó ya una respuesta (one-shot).
        setListening(false);
        setInterim('');
        restartAfter(400);
      },
      onEnd: () => {
        onEventRef.current?.('end');
        if (activeRef.current && !suspendedRef.current && !deliveredRef.current) {
          // La sesión sigue activa, FLU no habla y aún no se entregó una
          // respuesta: reintenta (tap-to-talk sigue abierto).
          restartAfter(250);
        } else {
          setListening(false);
          setInterim('');
        }
      },
    });

    return () => {
      clearRestartTimer();
      activeRef.current = false;
      suspendedRef.current = false;
      deliveredRef.current = false;
      setListening(false);
      setInterim('');
      if (recognitionRef.current === recognition) {
        stopSpeechRecognition(recognition);
        recognitionRef.current = null;
      }
    };
  }, [supported, clearRestartTimer, restartAfter, stop]);

  // `enabled` solo habilita el botón; NO abre el micrófono (tap-to-talk).
  // Al desactivarse el paso (o cerrarse el onboarding) se cierra el micrófono.
  useEffect(() => {
    if (!enabled) {
      stop();
    }
  }, [enabled, stop]);

  return { supported, listening, interim, start, stop, suspend, resume };
}
