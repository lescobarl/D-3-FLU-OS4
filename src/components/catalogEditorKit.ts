/**
 * catalogEditorKit — dependencias compartidas de los editores de catálogo.
 *
 * Dueño único del conjunto de imports que repetían los formularios de ambiente
 * y paleta. Los formularios conservan sus campos y su lógica propia.
 */
export { useState } from 'react'
export type { FormEvent } from 'react'
export { FLU_CONFIG } from '../voice/api/config'
export { setGroupedField, useEditableFields } from '../hooks/useEditableFields'
export { submitCatalogEditor } from './editorSubmit'
export { CatalogEditorFormShell } from './CatalogEditorFormShell'
export { SettingsTextField } from './SettingsTextField'
