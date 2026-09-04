// ============================================================
// PaletaEditorForm — Formulario crear/editar/clonar paleta (B4)
// ------------------------------------------------------------
// Componente presentacional controlado por PaletasPanel:
//   - recibe la PLANTILLA base (built-in clonado o dinámico) y los
//     campos editables iniciales (seed)
//   - construye el payload COMPLETO vía buildPaletaPayload
//     (conserva los 13 colores y decoration/cssClass de la plantilla)
//   - muestra el slug de id en vivo (derivado del nombre)
//
// Regla #1: NO HARDCODE — etiquetas de FLU_CONFIG.ui.paletas y las
// claves CSS de PALETTE_COLOR_KEYS (seasonalPalettes).
// ============================================================
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import {
    PALETTE_COLOR_KEYS,
    type PaletteDefinition,
} from '../core/branding/seasonalPalettes';
import {
    buildPaletaPayload,
    slugifyPalette,
    type EditablePaletteFields,
    type PaletteColorKey,
} from '../core/branding/paletaFactory';

export interface PaletaEditorFormProps {
    /** Plantilla base (clonada) para construir el payload completo. */
    template: PaletteDefinition;
    /** Valores iniciales de los campos editables. */
    seed: EditablePaletteFields;
    submitLabel: string;
    cancelLabel: string;
    onCancel: () => void;
    /** Persiste el payload; devuelve mensaje de error o null si guardó. */
    onSubmit: (payload: PaletteDefinition) => Promise<string | null>;
}

export function PaletaEditorForm({
    template,
    seed,
    submitLabel,
    cancelLabel,
    onCancel,
    onSubmit,
}: PaletaEditorFormProps) {
    const ui = (FLU_CONFIG as any).ui?.paletas ?? {};

    const [fields, setFields] = useState<EditablePaletteFields>(() => ({
        ...seed,
        colors: { ...seed.colors },
    }));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const setField = (patch: Partial<EditablePaletteFields>) => {
        setFields((prev) => ({ ...prev, ...patch }));
    };

    const setColor = (key: PaletteColorKey, value: string) => {
        setFields((prev) => ({ ...prev, colors: { ...prev.colors, [key]: value } }));
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy) return;
        if (!slugifyPalette(fields.name)) {
            setError(ui.requiredError || 'El nombre es obligatorio para generar el identificador.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const payload = buildPaletaPayload(template, fields);
            const message = await onSubmit(payload);
            if (message) setError(message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="flu-settings-section" onSubmit={handleSubmit} data-testid="paleta-editor-form">
            <div className="flu-settings-section__body">
                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                    <span>{ui.nombreLabel || 'Nombre'}</span>
                    <input
                        type="text"
                        value={fields.name}
                        onChange={(event) => setField({ name: event.target.value })}
                        placeholder={ui.nombrePlaceholder || 'Ej: Temporada Selva'}
                        data-testid="paleta-editor-name"
                        disabled={busy}
                    />
                </label>
                <p className="flu-settings-image-config__hint">
                    {ui.idLabel || 'Identificador'}:
                    <code className="flu-paletas-editor__slug">
                        {slugifyPalette(fields.name) || '—'}
                    </code>
                </p>

                <h4 className="flu-reminders__heading">{ui.colorsLabel || 'Colores de la paleta'}</h4>
                {PALETTE_COLOR_KEYS.map((key) => (
                    <label
                        key={key}
                        className="flu-settings-image-config__field flu-settings-image-config__field--stacked"
                    >
                        <span>
                            <code>{key}</code>
                        </span>
                        <input
                            type="color"
                            value={fields.colors[key] || '#000000'}
                            onChange={(event) => setColor(key, event.target.value)}
                            aria-label={key}
                            data-testid={`paleta-editor-color-${key.replace(/^--/, '')}`}
                            disabled={busy}
                        />
                    </label>
                ))}

                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                    <span>{ui.decorationLabel || 'Decoración'}</span>
                    <input
                        type="text"
                        value={fields.decoration}
                        onChange={(event) => setField({ decoration: event.target.value })}
                        placeholder={ui.decorationPlaceholder || 'Ej: santa-hat (vacío = sin decoración)'}
                        data-testid="paleta-editor-decoration"
                        disabled={busy}
                    />
                </label>
                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                    <span>{ui.cssClassLabel || 'Clase CSS'}</span>
                    <input
                        type="text"
                        value={fields.cssClass}
                        onChange={(event) => setField({ cssClass: event.target.value })}
                        placeholder={ui.cssClassPlaceholder || 'Ej: seasonal-fall (vacío = sin clase)'}
                        data-testid="paleta-editor-css-class"
                        disabled={busy}
                    />
                </label>

                {error && (
                    <p className="flu-settings-image-config__error" data-testid="paleta-editor-error">
                        {error}
                    </p>
                )}

                <div className="flu-paletas-editor__actions">
                    <button
                        type="submit"
                        className="flu-paletas-editor__submit"
                        data-testid="paleta-editor-submit"
                        disabled={busy || !fields.name.trim()}
                    >
                        {submitLabel}
                    </button>
                    <button
                        type="button"
                        className="flu-paletas-editor__cancel"
                        data-testid="paleta-editor-cancel"
                        disabled={busy}
                        onClick={onCancel}
                    >
                        {cancelLabel}
                    </button>
                </div>
            </div>
        </form>
    );
}
