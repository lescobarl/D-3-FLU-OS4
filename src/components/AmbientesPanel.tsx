// ============================================================
// AmbientesPanel — Panel de ambientes (rebranding por oficio) — B5 / 1A
// ------------------------------------------------------------
// Componente presentacional controlado: recibe el catálogo de
// ambientes, el ambiente activo, la acción de activación y los
// manejadores CRUD del catálogo dinámico desde App, y renderiza:
//   - una tarjeta por ambiente (icono, nombre, tagline)
//   - vista previa del tema: swatches con las variables CSS
//     --flu-* del ambiente (inline, sin tocar el tema activo)
//   - pestañas visibles en ese ambiente (desde el catálogo)
//   - botón "Activar" (deshabilitado en el ambiente activo)
//   - built-ins: botón "Clonar" (copia editable con id nuevo)
//   - dinámicos: botones "Editar" / "Eliminar"
//   - botón "Nuevo ambiente" y formulario crear/editar/clonar
//     (AmbienteEditorForm) que sustituye al grid mientras edita
//
// Cumple:
//   - Rule #1: NO HARDCODE — todas las etiquetas vienen de
//     FLU_CONFIG.ui.ambientes y los nombres de pestaña de
//     FLU_CONFIG.ui.tabs.items
//   - B5: tarjetas con vista previa + botón 'Activar' que llama
//     a applyEnvironment(...) (plan Fase B, fila B5)
//   - 1A/A5: gestión de ambientes dinámicos (crear/clonar/editar/
//     borrar) delegada en catalogRegistry vía props de App
//   - Presentacional: sin acceso a stores; App inyecta estado y
//     acciones (mismo patrón que ParticipantsPanel)
// ============================================================
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type {
    RegisterResult,
    UpdateResult,
} from '../core/catalogs/catalogRegistry';
import {
    ENVIRONMENT_TAB_IDS,
    ENVIRONMENTS,
    type EnvironmentCssVarKey,
    type EnvironmentDefinition,
} from '../core/environments/environmentRegistry';
import {
    editableFieldsOfEnvironment,
    emptyEnvironmentEditableFields,
    type EditableAmbienteFields,
} from '../core/environments/ambienteFactory';
import { AmbienteEditorForm } from './AmbienteEditorForm';

export interface AmbientesPanelProps {
    /** Catálogo de ambientes (getAmbientes()). */
    ambientes: readonly EnvironmentDefinition[];
    /** Ambiente activo (useEnvironmentStore.activeAmbienteId). */
    activeAmbienteId: string;
    /** Activa un ambiente (App llama a applyEnvironment + bienvenida). */
    onActivate: (ambienteId: string) => void;
    /** Ids de ambientes dinámicos (editables/borrables). */
    dynamicIds: ReadonlySet<string>;
    /** Registra un ambiente dinámico nuevo (catalogRegistry.register). */
    onRegister: (
        data: EnvironmentDefinition
    ) => Promise<RegisterResult<EnvironmentDefinition>>;
    /** Actualiza un ambiente dinámico (catalogRegistry.update). */
    onUpdate: (
        id: string,
        data: EnvironmentDefinition
    ) => Promise<UpdateResult<EnvironmentDefinition>>;
    /** Elimina un ambiente dinámico (catalogRegistry.remove). */
    onRemove: (id: string) => Promise<void>;
}

interface TabItem {
    id?: string;
    label?: string;
}

type EditorState =
    | {
          mode: 'create';
          template: EnvironmentDefinition;
          seed: EditableAmbienteFields;
      }
    | {
          mode: 'edit';
          id: string;
          template: EnvironmentDefinition;
          seed: EditableAmbienteFields;
      }
    | null;

/** Etiqueta legible de una pestaña desde FLU_CONFIG.ui.tabs.items. */
function tabLabel(tabId: string): string {
    const items = FLU_CONFIG.ui?.tabs?.items as TabItem[] | undefined;
    const match = Array.isArray(items)
        ? items.find((item) => item?.id === tabId)
        : undefined;
    return match?.label ?? tabId;
}

/**
 * Construye un objeto style con las variables --flu-* del tema.
 * CSSProperties no tiene índice de firma, así que se arma como
 * Record<string, string | undefined> y se lanza al tipo esperado.
 */
function buildThemeStyle(vars: Partial<Record<EnvironmentCssVarKey, string>>): CSSProperties {
    const style: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(vars ?? {})) {
        if (value) {
            style[`--${key}`] = value;
        }
    }
    return style as CSSProperties;
}

export function AmbientesPanel({
    ambientes,
    activeAmbienteId,
    onActivate,
    dynamicIds,
    onRegister,
    onUpdate,
    onRemove,
}: AmbientesPanelProps) {
    const ui = FLU_CONFIG.ui?.ambientes ?? {};
    const [editor, setEditor] = useState<EditorState>(null);

    const tabLabels = useMemo(() => {
        const labels: Record<string, string> = {};
        for (const id of ENVIRONMENT_TAB_IDS) {
            labels[id] = tabLabel(id);
        }
        return labels;
    }, []);

    const mapReason = (
        reason:
            | Extract<RegisterResult<EnvironmentDefinition>, { ok: false }>['reason']
            | Extract<UpdateResult<EnvironmentDefinition>, { ok: false }>['reason']
    ): string => {
        switch (reason) {
            case 'duplicate':
                return ui.duplicateError || 'Ya existe un ambiente con ese identificador.';
            case 'reserved':
                return ui.reservedError || 'Ese identificador está reservado por el sistema.';
            case 'not-found':
                return ui.notFoundError || 'El ambiente ya no existe.';
            default:
                return ui.invalidError || 'El formulario contiene datos inválidos.';
        }
    };

    const startCreate = () => {
        const template = structuredClone(ENVIRONMENTS[0]);
        setEditor({ mode: 'create', template, seed: emptyEnvironmentEditableFields(template) });
    };

    const startClone = (builtin: EnvironmentDefinition) => {
        const seed = editableFieldsOfEnvironment(builtin);
        seed.nombre = `${builtin.nombre}${ui.cloneNameSuffix || ' (copia)'}`;
        setEditor({ mode: 'create', template: builtin, seed });
    };

    const startEdit = (ambiente: EnvironmentDefinition) => {
        setEditor({
            mode: 'edit',
            id: ambiente.id,
            template: ambiente,
            seed: editableFieldsOfEnvironment(ambiente),
        });
    };

    const handleEditorSubmit = async (payload: EnvironmentDefinition): Promise<string | null> => {
        if (!editor) return ui.invalidError || 'No se puede guardar sin contexto.';
        if (editor.mode === 'create') {
            const result = await onRegister(payload);
            if (result.ok) {
                setEditor(null);
                return null;
            }
            return mapReason(result.reason);
        }
        const result = await onUpdate(editor.id, payload);
        if (result.ok) {
            setEditor(null);
            return null;
        }
        return mapReason(result.reason);
    };

    const handleRemove = async (ambiente: EnvironmentDefinition) => {
        await onRemove(ambiente.id);
    };

    return (
        <details className="flu-settings-image-config">
            <summary className="flu-settings-image-config__summary">
                {ui.panelTitle || 'Ambientes (rebranding por oficio)'}
            </summary>
            <div className="flu-settings-image-config__group">
                {editor ? (
                    <AmbienteEditorForm
                        template={editor.template}
                        seed={editor.seed}
                        tabLabels={tabLabels}
                        submitLabel={
                            editor.mode === 'create'
                                ? ui.createLabel || 'Crear ambiente'
                                : ui.saveLabel || 'Guardar cambios'
                        }
                        cancelLabel={ui.cancelLabel || 'Cancelar'}
                        onCancel={() => setEditor(null)}
                        onSubmit={handleEditorSubmit}
                    />
                ) : (
                    <>
                        <p className="flu-ambientes-panel__hint">
                            {ui.panelHint ||
                                'FLU se rebrandea según el oficio: identidad, tema visual, avatar, voz y pestañas.'}
                        </p>
                        <button
                            type="button"
                            className="flu-ambientes-panel__create"
                            data-testid="ambiente-create"
                            onClick={startCreate}
                        >
                            {ui.createLabel || 'Nuevo ambiente'}
                        </button>
                        <div className="flu-ambientes-grid">
                            {ambientes.map((ambiente) => {
                                const isActive = ambiente.id === activeAmbienteId;
                                const isFixed = !dynamicIds.has(ambiente.id);
                                return (
                                    <article
                                        key={ambiente.id}
                                        className={`flu-ambientes-card${isActive ? ' is-active' : ''}`}
                                        data-testid={`ambiente-card-${ambiente.id}`}
                                        style={buildThemeStyle(ambiente.tema.vars)}
                                    >
                                        <div
                                            className="flu-ambientes-card__preview"
                                            aria-label={ui.preview || 'Vista previa'}
                                        >
                                            <span className="flu-ambientes-card__swatch flu-ambientes-card__swatch--bg" />
                                            <span className="flu-ambientes-card__swatch flu-ambientes-card__swatch--bg-card" />
                                            <span className="flu-ambientes-card__swatch flu-ambientes-card__swatch--accent" />
                                            <span className="flu-ambientes-card__swatch flu-ambientes-card__swatch--accent-soft" />
                                        </div>
                                        <div className="flu-ambientes-card__body">
                                            <h4 className="flu-ambientes-card__title">
                                                <span className="flu-ambientes-card__icon" aria-hidden="true">
                                                    {ambiente.icono}
                                                </span>
                                                <span>{ambiente.nombre}</span>
                                            </h4>
                                            <p className="flu-ambientes-card__tagline">{ambiente.tagline}</p>
                                            <p className="flu-ambientes-card__tabs">
                                                {ambiente.pestanas.mostrar.map(tabLabel).join(' · ')}
                                            </p>
                                        </div>
                                        <div className="flu-ambientes-card__actions">
                                            <button
                                                type="button"
                                                className="flu-ambientes-card__activate"
                                                data-testid={`ambiente-activate-${ambiente.id}`}
                                                disabled={isActive}
                                                onClick={() => onActivate(ambiente.id)}
                                            >
                                                {isActive ? ui.active || 'Activo' : ui.activate || 'Activar'}
                                            </button>
                                            {isFixed ? (
                                                <button
                                                    type="button"
                                                    className="flu-ambientes-card__clone"
                                                    data-testid={`ambiente-clone-${ambiente.id}`}
                                                    onClick={() => startClone(ambiente)}
                                                >
                                                    {ui.cloneLabel || 'Clonar'}
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="flu-ambientes-card__edit"
                                                        data-testid={`ambiente-edit-${ambiente.id}`}
                                                        onClick={() => startEdit(ambiente)}
                                                    >
                                                        {ui.editLabel || 'Editar'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="flu-ambientes-card__remove"
                                                        data-testid={`ambiente-remove-${ambiente.id}`}
                                                        onClick={() => handleRemove(ambiente)}
                                                    >
                                                        {ui.removeLabel || 'Eliminar'}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </details>
    );
}
