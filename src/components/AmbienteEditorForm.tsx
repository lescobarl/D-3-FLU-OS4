// ============================================================
// AmbienteEditorForm — Formulario crear/editar/clonar ambiente (A5)
// ------------------------------------------------------------
// Componente presentacional controlado por AmbientesPanel:
//   - recibe la PLANTILLA base (built-in clonado o dinámico) y los
//     campos editables iniciales (seed)
//   - construye el payload COMPLETO vía buildAmbientePayload
//     (hereda bienvenida/voz/contenido/capVisible de la plantilla)
//   - muestra el slug de id en vivo (derivado del nombre)
//
// Regla #1: NO HARDCODE — etiquetas de FLU_CONFIG.ui.ambientes,
// rangos de environmentRegistry (claves CSS, decoraciones, pestañas)
// y etiquetas de pestaña inyectadas por el padre (tabLabels).
// ============================================================
import { FLU_CONFIG, setGroupedField, useEditableFields, CatalogEditorFormShell } from './catalogEditorKit';
import { useCatalogEditorForm } from '../hooks/useCatalogEditorForm';
import { SettingsTextField } from './SettingsTextField';
import { SettingsTextArea } from './SettingsTextArea';
import { CatalogEditorNameField } from './CatalogEditorNameField';
import {
    ENVIRONMENT_CSS_VAR_KEYS,
    ENVIRONMENT_DECORATIONS,
    ENVIRONMENT_TAB_IDS,
    type EnvironmentDefinition,
} from '../core/environments/environmentRegistry';
import {
    buildAmbientePayload,
    slugifyAmbiente,
    type EditableAmbienteFields,
} from '../core/environments/ambienteFactory';

export interface AmbienteEditorFormProps {
    /** Plantilla base (clonada) para construir el payload completo. */
    template: EnvironmentDefinition;
    /** Valores iniciales de los campos editables. */
    seed: EditableAmbienteFields;
    /** Etiquetas legibles de pestaña (FLU_CONFIG.ui.tabs.items). */
    tabLabels: Record<string, string>;
    submitLabel: string;
    cancelLabel: string;
    onCancel: () => void;
    /** Persiste el payload; devuelve mensaje de error o null si guardó. */
    onSubmit: (payload: EnvironmentDefinition) => Promise<string | null>;
}

export function AmbienteEditorForm({
    template,
    seed,
    tabLabels,
    submitLabel,
    cancelLabel,
    onCancel,
    onSubmit,
}: AmbienteEditorFormProps) {
    const ui = FLU_CONFIG.ui?.ambientes ?? {};

    const { fields, setFields, setField } = useEditableFields<EditableAmbienteFields>(seed, (s) => ({
        ...s,
        vars: { ...s.vars },
        tabs: [...s.tabs],
    }));

    const setVar = (key: string, value: string) => setGroupedField(setFields, 'vars', key, value);

    const toggleTab = (tabId: string, checked: boolean) => {
        setFields((prev) => ({
            ...prev,
            tabs: checked
                ? [...prev.tabs, tabId as EditableAmbienteFields['tabs'][number]]
                : prev.tabs.filter((id) => id !== tabId),
        }));
    };

    const { busy, error, handleSubmit } = useCatalogEditorForm({
        slug: slugifyAmbiente(fields.nombre),
        requiredMessage: ui.requiredError,
        build: () => buildAmbientePayload(template, fields),
        onSubmit,
    });

    return (
        <CatalogEditorFormShell
            testId="ambiente-editor-form"
            submitTestId="ambiente-editor-submit"
            cancelTestId="ambiente-editor-cancel"
            errorTestId="ambiente-editor-error"
            submitLabel={submitLabel}
            cancelLabel={cancelLabel}
            busy={busy}
            canSubmit={fields.nombre.trim().length > 0}
            error={error}
            actionsClassName="flu-ambientes-editor__actions"
            submitClassName="flu-ambientes-editor__submit"
            cancelClassName="flu-ambientes-editor__cancel"
            onSubmit={handleSubmit}
            onCancel={onCancel}
        >
                <CatalogEditorNameField
                    label={ui.nombreLabel || 'Nombre'}
                    value={fields.nombre}
                    onChange={(value) => setField({ nombre: value })}
                    placeholder={ui.nombrePlaceholder || 'Ej: Modo Selva'}
                    testId="ambiente-editor-nombre"
                    disabled={busy}
                    idLabel={ui.idLabel || 'Identificador'}
                    slug={slugifyAmbiente(fields.nombre)}
                    slugClassName="flu-ambientes-editor__slug"
                />
                <SettingsTextField
                    label={ui.taglineLabel || 'Frase descriptiva'}
                    value={fields.tagline}
                    onChange={(value) => setField({ tagline: value })}
                    placeholder={ui.taglinePlaceholder || 'Ej: Convierto tu espacio en una selva de aprendizaje'}
                    testId="ambiente-editor-tagline"
                    disabled={busy}
                />
                <SettingsTextField
                    label={ui.iconoLabel || 'Ícono'}
                    value={fields.icono}
                    onChange={(value) => setField({ icono: value })}
                    placeholder="🦁"
                    testId="ambiente-editor-icono"
                    disabled={busy}
                />

                <SettingsTextArea
                    label={ui.frasesEsLabel || 'Frases de activación (ES)'}
                    value={fields.frasesEs}
                    onChange={(value) => setField({ frasesEs: value })}
                    placeholder={ui.frasesPlaceholder || 'Una frase por línea'}
                    testId="ambiente-editor-frases-es"
                    disabled={busy}
                />
                <SettingsTextArea
                    label={ui.frasesEnLabel || 'Frases de activación (EN)'}
                    value={fields.frasesEn}
                    onChange={(value) => setField({ frasesEn: value })}
                    placeholder={ui.frasesPlaceholder || 'Una frase por línea'}
                    testId="ambiente-editor-frases-en"
                    disabled={busy}
                />
                <p className="flu-settings-image-config__hint">{ui.frasesHint || ''}</p>

                <h4 className="flu-reminders__heading">{ui.varsLabel || 'Variables del tema'}</h4>
                {ENVIRONMENT_CSS_VAR_KEYS.map((key) => (
                    <label
                        key={key}
                        className="flu-settings-image-config__field flu-settings-image-config__field--stacked"
                    >
                        <span>
                            <code>--{key}</code>
                        </span>
                        <input
                            type="text"
                            value={fields.vars[key] ?? ''}
                            onChange={(event) => setVar(key, event.target.value)}
                            placeholder={ui.varsPlaceholder || 'Vacío = no inyectar'}
                            data-testid={`ambiente-editor-var-${key}`}
                            disabled={busy}
                        />
                    </label>
                ))}

                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                    <span>{ui.decoracionLabel || 'Decoración'}</span>
                    <select
                        value={fields.decoracion ?? ''}
                        onChange={(event) =>
                            setField({
                                decoracion: (event.target.value || null) as EditableAmbienteFields['decoracion'],
                            })
                        }
                        aria-label={ui.decoracionLabel || 'Decoración'}
                        data-testid="ambiente-editor-decoracion"
                        disabled={busy}
                    >
                        <option value="">{ui.decoracionNone || '— Sin decoración —'}</option>
                        {ENVIRONMENT_DECORATIONS.map((decoracion) => (
                            <option key={decoracion} value={decoracion}>
                                {decoracion}
                            </option>
                        ))}
                    </select>
                </label>

                <h4 className="flu-reminders__heading">{ui.tabsLabel || 'Pestañas visibles'}</h4>
                {ENVIRONMENT_TAB_IDS.map((tabId) => (
                    <label
                        key={tabId}
                        className="flu-settings-image-config__field flu-settings-image-config__field--inline"
                    >
                        <input
                            type="checkbox"
                            checked={fields.tabs.includes(tabId)}
                            onChange={(event) => toggleTab(tabId, event.target.checked)}
                            data-testid={`ambiente-editor-tab-${tabId}`}
                            disabled={busy}
                        />
                        <span>{tabLabels[tabId] ?? tabId}</span>
                    </label>
                ))}

        </CatalogEditorFormShell>
    );
}
