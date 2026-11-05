/**
 * editorSubmit.ts — DUEÑO ÚNICO del envío de un formulario de editor de catálogo.
 *
 * AmbienteEditorForm y PaletaEditorForm tenían el MISMO `handleSubmit` (mismo
 * esqueleto, solo cambiaban `slugify*` y `build*Payload`): P9.28. Aquí vive una sola
 * vez la secuencia: corta la reentrada, exige el nombre, construye el payload y
 * propaga el mensaje de error del padre.
 */

/** Datos que un editor de catálogo aporta a su envío. */
export interface EditorSubmitSpec<T> {
    /** Verdadero si ya hay un envío en curso (guardia de reentrada). */
    busy: boolean;
    setBusy: (busy: boolean) => void;
    setError: (message: string | null) => void;
    /** Identificador derivado del nombre; vacío = falta el nombre. */
    slug: string;
    /** Mensaje cuando falta el nombre. */
    requiredMessage: string;
    build: () => T;
    onSubmit: (payload: T) => Promise<string | null>;
}

/**
 * Envía el formulario del editor (un solo dueño para los dos formularios).
 * @param event evento de submit del formulario (`preventDefault` incluido)
 * @param spec datos del editor
 */
export async function submitCatalogEditor<T>(
    event: { preventDefault: () => void },
    spec: EditorSubmitSpec<T>,
): Promise<void> {
    event.preventDefault();
    if (spec.busy) return;
    if (!spec.slug) {
        spec.setError(spec.requiredMessage);
        return;
    }
    spec.setBusy(true);
    spec.setError(null);
    try {
        const message = await spec.onSubmit(spec.build());
        if (message) spec.setError(message);
    } finally {
        spec.setBusy(false);
    }
}
