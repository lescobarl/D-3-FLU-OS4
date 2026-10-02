/**
 * useServiceRef — crea el servicio UNA vez y lo mantiene estable entre renders.
 *
 * DUENO UNICO (auditoria de codigo 2026-10-02): el patron "servicio en un ref ANTES
 * de cualquier useState" (con su comentario sobre la zona muerta temporal) estaba
 * copiado en 10 hooks, cada uno con su `serviceRef` y su `const service = ...`.
 * Vive aqui una sola vez: quien lo use no necesita acordarse de por que el ref va
 * antes del estado ni de repetir el comentario.
 *
 * @param factory Fabrica del servicio (se invoca como maximo una vez por montaje).
 * @returns El mismo servicio en todos los renders del montaje.
 */
import { useRef } from 'react';

export function useServiceRef<T>(factory: () => T): T {
    const ref = useRef<T | null>(null);
    if (!ref.current) ref.current = factory();
    return ref.current;
}
