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
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
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

    const [fields, setFields] = useState<EditableAmbienteFields>(() => ({
        ...seed,
        vars: { ...seed.vars },
        tabs: [...seed.tabs],
    }));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const setField = (patch: Partial<EditableAmbienteFields>) => {
        setFields((prev) => ({ ...prev, ...patch }));
    };

    const setVar = (key: string, value: string) => {
        setFields((prev) => ({ ...prev, vars: { ...prev.vars, [key]: value } }));
    };

    const toggleTab = (tabId: string, checked: boolean) => {
        setFields((prev) => ({
            ...prev,
            tabs: checked
                ? [...prev.tabs, tabId as EditableAmbienteFields['tabs'][number]]
                : prev.tabs.filter((id) => id !== tabId),
        }));
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy) return;
        if (!slugifyAmbiente(fields.nombre)) {
            setError(ui.requiredError || 'El nombre es obligatorio para generar el identificador.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const payload = buildAmbientePayload(template, fields);
            const message = await onSubmit(payload);
            if (message) setError(message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="flu-settings-section" onSubmit={handleSubmit} data-testid="ambiente-editor-form">
            <div className="flu-settings-section__body">
                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                    <span>{ui.nombreLabel || 'Nombre'}</span>
                    <input
                        type="text"
                        value={fields.nombre}
                        onChange={(event) => setField({ nombre: event.target.value })}
                        placeholder={ui.nombrePlaceholder || 'Ej: Modo Selva'}
                        data-testid="ambiente-editor-nombre"
                        disabled={busy}
                    />
                </label>
                <p className="flu-settings-image-config__hint">
                    {ui.idLabel || 'Identificador'}:
                    <code className="flu-ambientes-editor__slug">
                        {slugifyAmbiente(fields.nombre) || '—'}
                    </code>
                </p>
                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                    <span>{ui.taglineLabel || 'Frase descriptiva'}</span>
                    <input
                        type="text"
                        value={fields.tagline}
                        onChange={(event) => setField({ tagline: event.target.value })}
                        placeholder={ui.taglinePlaceholder || 'Ej: Convierto tu espacio en una selva de aprendizaje'}
                        data-testid="ambiente-editor-tagline"
                        disabled={busy}
                    />
                </label>
                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                    <span>{ui.iconoLabel || 'Ícono'}</span>
                    <input
                        type="text"
                        value={fields.icono}
                        onChange={(event) => setField({ icono: event.target.value })}
                        placeholder="🦁"
                        data-testid="ambiente-editor-icono"
                        disabled={busy}
                    />
                </label>

                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                    <span>{ui.frasesEsLabel || 'Frases de activación (ES)'}</span>
                    <textarea
                        value={fields.frasesEs}
                        onChange={(event) => setField({ frasesEs: event.target.value })}
                        placeholder={ui.frasesPlaceholder || 'Una frase por línea'}
                        rows={3}
                        data-testid="ambiente-editor-frases-es"
                        disabled={busy}
                    />
                </label>
                <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
                    <span>{ui.frasesEnLabel || 'Frases de activación (EN)'}</span>
                    <textarea
                        value={fields.frasesEn}
                        onChange={(event) => setField({ frasesEn: event.target.value })}
                        placeholder={ui.frasesPlaceholder || 'Una frase por línea'}
                        rows={3}
                        data-testid="ambiente-editor-frases-en"
                        disabled={busy}
                    />
                </label>
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

                {error && (
                    <p className="flu-settings-image-config__error" data-testid="ambiente-editor-error">
                        {error}
                    </p>
                )}

                <div className="flu-ambientes-editor__actions">
                    <button
                        type="submit"
                        className="flu-ambientes-editor__submit"
                        data-testid="ambiente-editor-submit"
                        disabled={busy || !fields.nombre.trim()}
                    >
                        {submitLabel}
                    </button>
                    <button
                        type="button"
                        className="flu-ambientes-editor__cancel"
                        data-testid="ambiente-editor-cancel"
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
