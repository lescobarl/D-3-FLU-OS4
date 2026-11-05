import { useEffect, useRef, useState } from 'react';
import { useThinkingIndicator } from '../hooks/useThinkingIndicator';

/**
 * Indicador visual de procesamiento de FLU.
 *
 * Se muestra cuando el integrationStore marca `isThinking === true`
 * (una solicitud a la IA está en curso). Es un pill no bloqueante
 * (`pointer-events: none`) con un spinner y el texto "FLU está pensando...",
 * posicionado cerca de la parte inferior central de la pantalla.
 *
 * UX: se introduce un pequeño retraso de entrada (150ms) para evitar
 * parpadeos en solicitudes muy rápidas (p. ej. detección de solicitud simple
 * o consulta local), y se desmonta inmediatamente al resolver.
 *
 * Animación: las keyframes se definen localmente (self-contained) para no
 * acoplarse al CSS global de la app.
 */
export function ThinkingIndicator() {
    const { isThinking } = useThinkingIndicator();
    const [visible, setVisible] = useState(false);
    const showTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (isThinking) {
            if (showTimerRef.current === null) {
                showTimerRef.current = window.setTimeout(() => {
                    showTimerRef.current = null;
                    setVisible(true);
                }, 150);
            }
        } else {
            if (showTimerRef.current !== null) {
                window.clearTimeout(showTimerRef.current);
                showTimerRef.current = null;
            }
            setVisible(false);
        }
        return () => {
            if (showTimerRef.current !== null) {
                window.clearTimeout(showTimerRef.current);
                showTimerRef.current = null;
            }
        };
    }, [isThinking]);

    if (!visible) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            aria-label="FLU está pensando"
            className="thinking-indicator"
        >
            <span
                aria-hidden="true"
                className="thinking-indicator__spinner"
            />
            <span>FLU está pensando...</span>
            <style>{`
                @keyframes flu-thinking-spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes flu-thinking-pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.75; }
                }
            `}</style>
        </div>
    );
}
