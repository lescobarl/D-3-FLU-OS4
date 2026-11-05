// ============================================================
// SettingsSaveContext — Guardar/Restablecer GLOBAL del configurador
// ------------------------------------------------------------
// Un único botón al pie de "Configuración" confirma TODOS los borradores
// pendientes y restablece todo. Los paneles con borrador (participante,
// buscador, búsqueda web) se registran aquí; los paneles que guardan al
// instante no se registran (no necesitan confirmación).
//
// Una sola ruta: los paneles NO tienen botón local de guardar/restablecer.
// ============================================================
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export interface SettingsSaveHandlers {
    /** Confirma el borrador del panel. */
    commit?: () => void;
    /** Restablece el panel a su estado base. */
    reset?: () => void;
}

interface SettingsSaveRegistry {
    register: (id: string, handlers: SettingsSaveHandlers) => void;
    unregister: (id: string) => void;
    commitAll: () => void;
    resetAll: () => void;
}

const SettingsSaveContext = createContext<SettingsSaveRegistry | null>(null);

export function SettingsSaveProvider({ children }: { children: React.ReactNode }) {
    const handlersRef = useRef<Map<string, SettingsSaveHandlers>>(new Map());

    const register = useCallback((id: string, handlers: SettingsSaveHandlers) => {
        handlersRef.current.set(id, handlers);
    }, []);
    const unregister = useCallback((id: string) => {
        handlersRef.current.delete(id);
    }, []);
    const commitAll = useCallback(() => {
        handlersRef.current.forEach((handlers) => handlers.commit?.());
    }, []);
    const resetAll = useCallback(() => {
        handlersRef.current.forEach((handlers) => handlers.reset?.());
    }, []);

    const value = useMemo(
        () => ({ register, unregister, commitAll, resetAll }),
        [register, unregister, commitAll, resetAll],
    );
    return <SettingsSaveContext.Provider value={value}>{children}</SettingsSaveContext.Provider>;
}

export function useSettingsSave(): SettingsSaveRegistry | null {
    return useContext(SettingsSaveContext);
}

/**
 * Registra el commit/reset de un panel con borrador. Los handlers se leen
 * siempre desde un ref, así el registro no se re-suscribe en cada tecla.
 */
export function useSettingsSaveRegistration(id: string, handlers: SettingsSaveHandlers): void {
    const registry = useSettingsSave();
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        if (!registry) return;
        registry.register(id, {
            commit: () => handlersRef.current.commit?.(),
            reset: () => handlersRef.current.reset?.(),
        });
        return () => registry.unregister(id);
    }, [registry, id]);
}

/**
 * Barra de acciones global del configurador: un único Guardar + Restablecer
 * que aplican a todos los paneles registrados.
 */
export function SettingsSaveBar({ language = 'es' }: { language?: string }) {
    const registry = useSettingsSave();
    const [feedback, setFeedback] = useState('');
    if (!registry) return null;
    const isEn = language === 'en';

    return (
        <div className="flu-settings-image-config__group" style={{ marginTop: 16 }} data-testid="settings-save-bar">
            <div className="flu-settings-row" style={{ gap: 8 }}>
                <button
                    type="button"
                    className="flu-ambientes-panel__create"
                    data-testid="settings-save-all"
                    onClick={() => {
                        registry.commitAll();
                        setFeedback(isEn ? 'Settings saved.' : 'Configuración guardada.');
                    }}
                >
                    {isEn ? 'Save settings' : 'Guardar configuración'}
                </button>
                <button
                    type="button"
                    className="flu-browser-profile__reset"
                    data-testid="settings-reset-all"
                    onClick={() => {
                        registry.resetAll();
                        setFeedback(isEn ? 'Settings restored.' : 'Configuración restablecida.');
                    }}
                >
                    {isEn ? 'Restore settings' : 'Restablecer'}
                </button>
                {feedback ? (
                    <span className="flu-settings-hint" data-testid="settings-save-feedback">{feedback}</span>
                ) : null}
            </div>
        </div>
    );
}
