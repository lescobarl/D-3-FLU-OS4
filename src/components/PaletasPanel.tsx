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
import { CatalogCardShell } from './CatalogCardShell';
import { CatalogCardActions } from './CatalogCardActions';
import { CatalogPanelShell } from './CatalogPanelShell';
import { useCatalogPanel } from '../hooks/useCatalogPanel';
import { FLU_CONFIG } from '../voice/api/config';
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
import { cloneSeedEntry } from './panelUtils';
import {
    catalogCreateValue,
    catalogEditValue,
    mapCatalogReason,
    catalogPanelSave,
    catalogEditorProps,
    type CatalogEditorState,
    type CatalogReason,
} from './catalogPanelEditors';

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

type PaletaEditorState = CatalogEditorState<PaletteDefinition, EditablePaletteFields>;

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

    const mapReason = (reason: CatalogReason<PaletteDefinition>): string =>
        mapCatalogReason(reason, ui, {
            duplicate: 'Ya existe una temporada con ese identificador.',
            notFound: 'La temporada ya no existe.',
        });

    const { editor, open: setEditor, cancel, submit } = useCatalogPanel<
        PaletaEditorState,
        PaletteDefinition
    >({
        save: catalogPanelSave(onRegister, onUpdate, mapReason),
    });

    const startCreate = () =>
        setEditor(catalogCreateValue(structuredClone(builtinPaletteEntries()[0]), emptyEditableFields));

    const startClone = (builtin: PaletteDefinition) =>
        setEditor({ mode: 'create', ...cloneSeedEntry(builtin, editableFieldsOf, 'name', builtin.name, ui.cloneNameSuffix) });

    const startEdit = (paleta: PaletteDefinition) =>
        setEditor(catalogEditValue(paleta, editableFieldsOf));

    const handleEditorSubmit = (payload: PaletteDefinition): Promise<string | null> =>
        submit(payload);

    const handleRemove = async (paleta: PaletteDefinition) => {
        await onRemove(paleta.id);
    };

    return (
        <CatalogPanelShell
            title={ui.panelTitle || 'Mis temporadas (paletas dinámicas)'}
            editor={editor ? (
                    <PaletaEditorForm
                        {...catalogEditorProps(
                            editor,
                            ui,
                            { create: 'Crear temporada', save: 'Guardar temporada' },
                            cancel,
                            handleEditorSubmit,
                        )}
                    />
            ) : null}
            hint={ui.panelHint ||
                                'FLU se rebrandea por temporada: crea tus propias paletas de colores y actívalas manualmente.'}
            hintClassName="flu-paletas-panel__hint"
            createLabel={ui.createLabel || 'Nueva temporada'}
            createClassName="flu-paletas-panel__create"
            createTestId="paleta-create"
            onCreate={startCreate}
            gridClassName="flu-paletas-grid"
        >
                            {paletas.map((paleta) => {
                                const isActive = paleta.id === activeSeason;
                                const isFixed = !dynamicIds.has(paleta.id);
                                return (
                                    <CatalogCardShell
                                        key={paleta.id}
                                        kind="paletas"
                                        id={paleta.id}
                                        active={isActive}
                                        previewAria={ui.preview || 'Vista previa'}
                                        preview={<>
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
                                        </>}
                                        actions={<CatalogCardActions
                                            kind="paletas"
                                            id={paleta.id}
                                            active={isActive}
                                            fixed={isFixed}
                                            labels={{ active: ui.active, activate: ui.activate, clone: ui.cloneLabel, edit: ui.editLabel, remove: ui.removeLabel }}
                                            onActivate={() => onActivate(paleta.id)}
                                            onClone={() => startClone(paleta)}
                                            onEdit={() => startEdit(paleta)}
                                            onRemove={() => handleRemove(paleta)}
                                        />}
                                    >
<h4 className="flu-paletas-card__title">
                                                {paleta.name}
                                            </h4>
                                            <p className="flu-paletas-card__meta">
                                                <code>{paleta.id}</code>
                                            </p>
                                    </CatalogCardShell>
                                );
                            })}
                        </CatalogPanelShell>
    );
}
