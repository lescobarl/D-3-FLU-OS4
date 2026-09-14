// ============================================================
// PaletasPanel — Panel de temporadas (rebranding por paleta) — B4 / 1B
// ------------------------------------------------------------
// Componente presentacional controlado: recibe el catálogo de
// paletas fusionado, la temporada activa, la acción de activación
// y los manejadores CRUD del catálogo dinámico desde App, y
// renderiza:
//   - una tarjeta por paleta (nombre e id canónico)
//   - vista previa de colores: swatches inline con los 6 primeros
//     colores de la paleta (sin tocar el tema activo)
//   - botón "Activar" (deshabilitado en la temporada activa)
//   - built-ins: botón "Clonar" (copia editable con id nuevo)
//   - dinámicos: botones "Editar" / "Eliminar"
//   - botón "Nueva temporada" y formulario crear/editar/clonar
//     (PaletaEditorForm) que sustituye al grid mientras edita
//
// Cumple:
//   - Rule #1: NO HARDCODE — todas las etiquetas vienen de
//     FLU_CONFIG.ui.paletas
//   - B4: "Mis temporadas" (plan Fase B, fila B4 + UI transversal)
//   - 1B: gestión de paletas dinámicas (crear/clonar/editar/
//     borrar) delegada en catalogRegistry vía props de App
//   - Presentacional: sin acceso a stores; App inyecta estado y
//     acciones (mismo patrón que AmbientesPanel)
// ============================================================
import { useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { configChild, configTextMap } from './configText';
import type {
    RegisterResult,
    UpdateResult,
} from '../core/catalogs/catalogRegistry';
import {
    builtinPaletteEntries,
    type PaletteDefinition,
} from '../core/branding/seasonalPalettes';
import {
    editableFieldsOf,
    emptyEditableFields,
    type EditablePaletteFields,
} from '../core/branding/paletaFactory';
import { PaletaEditorForm } from './PaletaEditorForm';

export interface PaletasPanelProps {
    /** Catálogo de paletas fusionado (getAllPalettes()). */
    paletas: readonly PaletteDefinition[];
    /** Temporada activa (branding.config.activeSeason). */
    activeSeason: string;
    /** Activa una temporada (App llama a setMode + setActiveSeason). */
    onActivate: (paletaId: string) => void;
    /** Ids de paletas dinámicas (editables/borrables). */
    dynamicIds: ReadonlySet<string>;
    /** Registra una paleta dinámica nueva (catalogRegistry.register). */
    onRegister: (
        data: PaletteDefinition
    ) => Promise<RegisterResult<PaletteDefinition>>;
    /** Actualiza una paleta dinámica (catalogRegistry.update). */
    onUpdate: (
        id: string,
        data: PaletteDefinition
    ) => Promise<UpdateResult<PaletteDefinition>>;
    /** Elimina una paleta dinámica (catalogRegistry.remove). */
    onRemove: (id: string) => Promise<void>;
}

type EditorState =
    | {
          mode: 'create';
          template: PaletteDefinition;
          seed: EditablePaletteFields;
      }
    | {
          mode: 'edit';
          id: string;
          template: PaletteDefinition;
          seed: EditablePaletteFields;
      }
    | null;

export function PaletasPanel({
    paletas,
    activeSeason,
    onActivate,
    dynamicIds,
    onRegister,
    onUpdate,
    onRemove,
}: PaletasPanelProps) {
    const ui = configTextMap(configChild(FLU_CONFIG.ui, 'paletas'));
    const [editor, setEditor] = useState<EditorState>(null);

    const mapReason = (
        reason:
            | Extract<RegisterResult<PaletteDefinition>, { ok: false }>['reason']
            | Extract<UpdateResult<PaletteDefinition>, { ok: false }>['reason']
    ): string => {
        switch (reason) {
            case 'duplicate':
                return ui.duplicateError || 'Ya existe una temporada con ese identificador.';
            case 'reserved':
                return ui.reservedError || 'Ese identificador está reservado por el sistema.';
            case 'not-found':
                return ui.notFoundError || 'La temporada ya no existe.';
            default:
                return ui.invalidError || 'El formulario contiene datos inválidos.';
        }
    };

    const startCreate = () => {
        const template = structuredClone(builtinPaletteEntries()[0]);
        setEditor({ mode: 'create', template, seed: emptyEditableFields(template) });
    };

    const startClone = (builtin: PaletteDefinition) => {
        const seed = editableFieldsOf(builtin);
        seed.name = `${builtin.name}${ui.cloneNameSuffix || ' (copia)'}`;
        setEditor({ mode: 'create', template: builtin, seed });
    };

    const startEdit = (paleta: PaletteDefinition) => {
        setEditor({
            mode: 'edit',
            id: paleta.id,
            template: paleta,
            seed: editableFieldsOf(paleta),
        });
    };

    const handleEditorSubmit = async (payload: PaletteDefinition): Promise<string | null> => {
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

    const handleRemove = async (paleta: PaletteDefinition) => {
        await onRemove(paleta.id);
    };

    return (
        <details className="flu-settings-image-config">
            <summary className="flu-settings-image-config__summary">
                {ui.panelTitle || 'Mis temporadas (paletas dinámicas)'}
            </summary>
            <div className="flu-settings-image-config__group">
                {editor ? (
                    <PaletaEditorForm
                        template={editor.template}
                        seed={editor.seed}
                        submitLabel={
                            editor.mode === 'create'
                                ? ui.createLabel || 'Crear temporada'
                                : ui.saveLabel || 'Guardar temporada'
                        }
                        cancelLabel={ui.cancelLabel || 'Cancelar'}
                        onCancel={() => setEditor(null)}
                        onSubmit={handleEditorSubmit}
                    />
                ) : (
                    <>
                        <p className="flu-paletas-panel__hint">
                            {ui.panelHint ||
                                'FLU se rebrandea por temporada: crea tus propias paletas de colores y actívalas manualmente.'}
                        </p>
                        <button
                            type="button"
                            className="flu-paletas-panel__create"
                            data-testid="paleta-create"
                            onClick={startCreate}
                        >
                            {ui.createLabel || 'Nueva temporada'}
                        </button>
                        <div className="flu-paletas-grid">
                            {paletas.map((paleta) => {
                                const isActive = paleta.id === activeSeason;
                                const isFixed = !dynamicIds.has(paleta.id);
                                return (
                                    <article
                                        key={paleta.id}
                                        className={`flu-paletas-card${isActive ? ' is-active' : ''}`}
                                        data-testid={`paleta-card-${paleta.id}`}
                                    >
                                        <div
                                            className="flu-paletas-card__preview"
                                            aria-label={ui.preview || 'Vista previa'}
                                        >
                                            {Object.entries(paleta.colors)
                                                .slice(0, 6)
                                                .map(([key, color]) => (
                                                    <span
                                                        key={key}
                                                        className="flu-paletas-card__swatch"
                                                        title={key}
                                                        style={{ background: color }}
                                                    />
                                                ))}
                                        </div>
                                        <div className="flu-paletas-card__body">
                                            <h4 className="flu-paletas-card__title">
                                                {paleta.name}
                                            </h4>
                                            <p className="flu-paletas-card__meta">
                                                <code>{paleta.id}</code>
                                            </p>
                                        </div>
                                        <div className="flu-paletas-card__actions">
                                            <button
                                                type="button"
                                                className="flu-paletas-card__activate"
                                                data-testid={`paleta-activate-${paleta.id}`}
                                                disabled={isActive}
                                                onClick={() => onActivate(paleta.id)}
                                            >
                                                {isActive
                                                    ? ui.active || 'Activa'
                                                    : ui.activate || 'Activar'}
                                            </button>
                                            {isFixed ? (
                                                <button
                                                    type="button"
                                                    className="flu-paletas-card__clone"
                                                    data-testid={`paleta-clone-${paleta.id}`}
                                                    onClick={() => startClone(paleta)}
                                                >
                                                    {ui.cloneLabel || 'Clonar'}
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="flu-paletas-card__edit"
                                                        data-testid={`paleta-edit-${paleta.id}`}
                                                        onClick={() => startEdit(paleta)}
                                                    >
                                                        {ui.editLabel || 'Editar'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="flu-paletas-card__remove"
                                                        data-testid={`paleta-remove-${paleta.id}`}
                                                        onClick={() => handleRemove(paleta)}
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
