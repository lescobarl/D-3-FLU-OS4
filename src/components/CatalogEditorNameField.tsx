/**
 * CatalogEditorNameField — nombre + identificador ÚNICO de un editor de catálogo.
 *
 * Dueño del campo de nombre y de la pista con el slug que repetían los editores
 * de ambiente y paleta.
 */
import { SettingsTextField } from './SettingsTextField'

export interface CatalogEditorNameFieldProps {
  /** Etiqueta del nombre. */
  label: string
  /** Valor del nombre. */
  value: string
  /** Cambio del nombre. */
  onChange: (value: string) => void
  /** Placeholder del nombre. */
  placeholder: string
  /** Test id del input. */
  testId: string
  /** Deshabilita el campo. */
  disabled: boolean
  /** Etiqueta del identificador. */
  idLabel: string
  /** Slug derivado. */
  slug: string
  /** Clase del slug. */
  slugClassName: string
}

/**
 * Renderiza el campo de nombre con su identificador derivado.
 * @param props Nombre, slug y textos.
 * @returns Campo de nombre + pista.
 */
export function CatalogEditorNameField({
  label,
  value,
  onChange,
  placeholder,
  testId,
  disabled,
  idLabel,
  slug,
  slugClassName,
}: CatalogEditorNameFieldProps) {
  return (
    <>
      <SettingsTextField
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        testId={testId}
        disabled={disabled}
      />
      <p className="flu-settings-image-config__hint">
        {idLabel}:
        <code className={slugClassName}>{slug || '—'}</code>
      </p>
    </>
  )
}
