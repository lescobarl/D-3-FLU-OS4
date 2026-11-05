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
import { FLU_CONFIG, setGroupedField, useEditableFields, CatalogEditorFormShell, SettingsTextField } from './catalogEditorKit';
import { useCatalogEditorForm } from '../hooks/useCatalogEditorForm';
import { CatalogEditorNameField } from './CatalogEditorNameField';
import { configChild, configTextMap } from './configText';
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
    const ui = configTextMap(configChild(FLU_CONFIG.ui, 'paletas'));

    const { fields, setFields, setField } = useEditableFields<EditablePaletteFields>(seed, (s) => ({
        ...s,
        colors: { ...s.colors },
    }));

    const setColor = (key: PaletteColorKey, value: string) => setGroupedField(setFields, 'colors', key, value);

    const { busy, error, handleSubmit } = useCatalogEditorForm({
        slug: slugifyPalette(fields.name),
        requiredMessage: ui.requiredError,
        build: () => buildPaletaPayload(template, fields),
        onSubmit,
    });

    return (
        <CatalogEditorFormShell
            testId="paleta-editor-form"
            submitTestId="paleta-editor-submit"
            cancelTestId="paleta-editor-cancel"
            errorTestId="paleta-editor-error"
            submitLabel={submitLabel}
            cancelLabel={cancelLabel}
            busy={busy}
            canSubmit={fields.name.trim().length > 0}
            error={error}
            actionsClassName="flu-paletas-editor__actions"
            submitClassName="flu-paletas-editor__submit"
            cancelClassName="flu-paletas-editor__cancel"
            onSubmit={handleSubmit}
            onCancel={onCancel}
        >
                <CatalogEditorNameField
                    label={ui.nombreLabel || 'Nombre'}
                    value={fields.name}
                    onChange={(value) => setField({ name: value })}
                    placeholder={ui.nombrePlaceholder || 'Ej: Temporada Selva'}
                    testId="paleta-editor-name"
                    disabled={busy}
                    idLabel={ui.idLabel || 'Identificador'}
                    slug={slugifyPalette(fields.name)}
                    slugClassName="flu-paletas-editor__slug"
                />

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

                <SettingsTextField
                    label={ui.decorationLabel || 'Decoración'}
                    value={fields.decoration}
                    onChange={(value) => setField({ decoration: value })}
                    placeholder={ui.decorationPlaceholder || 'Ej: santa-hat (vacío = sin decoración)'}
                    testId="paleta-editor-decoration"
                    disabled={busy}
                />
                <SettingsTextField
                    label={ui.cssClassLabel || 'Clase CSS'}
                    value={fields.cssClass}
                    onChange={(value) => setField({ cssClass: value })}
                    placeholder={ui.cssClassPlaceholder || 'Ej: seasonal-fall (vacío = sin clase)'}
                    testId="paleta-editor-css-class"
                    disabled={busy}
                />
        </CatalogEditorFormShell>
    );
}
