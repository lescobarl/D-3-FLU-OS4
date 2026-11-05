import { useCallback, useEffect, useState } from 'react';
import { logCaughtError } from '../lib/caughtError';

/**
 * Lista recargada desde un servicio, con estado de carga y log de error.
 *
 * Dueño único del patrón "cargar + loading + registrar el fallo" que repetían
 * los hooks de perfiles (navegador y comunicación).
 *
 * @param list Carga completa de la lista (debe ser estable: `useCallback`).
 * @param tag Etiqueta del hook para el log.
 * @returns Lista, bandera de carga y recarga.
 */
export function useListReload<T>(
    list: () => Promise<T[]>,
    tag: string,
): { items: T[]; loading: boolean; refresh: () => Promise<void> } {
    const [items, setItems] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async (): Promise<void> => {
        try {
            setItems(await list());
        } catch (err) {
            logCaughtError(`[${tag}] refresh error`, err);
        } finally {
            setLoading(false);
        }
    }, [list, tag]);

    useEffect(() => {
        refresh().catch((e) => logCaughtError(`[${tag}] refresh`, e));
    }, [refresh, tag]);

    return { items, loading, refresh };
}
